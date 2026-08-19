#!/usr/bin/env node

/**
 * review-brief.js — 审核简报生成器（机械投影，无 LLM 判断）
 *
 * 目标：把「人类审核心智负担」降到最低——审核者只看一页简报，
 *      需要细节时再点开对应产物。简报全部由真实状态机械合成：
 *
 *   - 变更文件表   ← git diff（对比 checkpoint.git_commit_before_task，任务基线提交）
 *   - 各阶段结论   ← 各产出物的 `## Summary for downstream` 区块（原样提取）
 *   - 验证证据     ← verification-result.json（overall_status / 命令 / config_source）
 *   - 审查发现     ← review-report.md 的审查概览计数（Critical/Warning/Suggestion/P0/P1/P2）
 *   - 人工复查清单 ← review-report.md 的 `## 建议人工复查清单` 区块（原样引用）
 *
 * 用法：
 *   node .harness/tools/review-brief.js --task-id task-002 [--root <项目根>] [--output <path>]
 *
 * 原则：简报不生成任何新内容，只聚合既有事实；缺失的产物标注「（缺失）」而非编造。
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 工具函数

function getArg(args, name) {
  const eq = args.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] !== undefined) return args[idx + 1];
  return null;
}

function findHarnessRoot(startDir) {
  let current = path.resolve(startDir || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, '.harness'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 提取某个产出物的 Summary for downstream 区块（到下一个 ## 为止），超长截断 */
function extractSummary(filePath, maxLines = 4, maxChars = 320) {
  if (!fs.existsSync(filePath)) return '（缺失）';
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const start = lines.findIndex(l => l.startsWith('## Summary for downstream'));
  if (start === -1) return '（无 Summary 区块）';
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const block = lines.slice(start + 1, end === -1 ? undefined : end);
  // 去掉空行后截断：最多 maxLines 行、maxChars 字符
  const trimmed = block.filter(l => l.trim() !== '').slice(0, maxLines);
  let text = trimmed.join('\n');
  if (text.length > maxChars) text = text.slice(0, maxChars) + '…';
  const full = lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
  const isTruncated = full.length > text.replace('…', '').length || full.split('\n').length > maxLines;
  return text + (isTruncated ? '\n…（摘要已截断，详情见产出物）' : '');
}

/** 从 review-report 提取审查概览计数（兼容 审查概览 与 问题统计 两种表头） */
function extractCounts(reviewPath) {
  if (!fs.existsSync(reviewPath)) return null;
  const content = fs.readFileSync(reviewPath, 'utf8');
  const counts = {};
  const re = /\|\s*(Critical|Warning|Suggestion|UI\/UX P0|UI\/UX P1|UI\/UX P2|Info)\s*\|\s*(\d+)\s*\|/gi;
  let m;
  while ((m = re.exec(content)) !== null) counts[m[1].toUpperCase()] = parseInt(m[2], 10);
  return counts;
}

/** 从 review-report 提取 建议人工复查清单 区块 */
function extractHumanReviewList(reviewPath) {
  if (!fs.existsSync(reviewPath)) return null;
  const lines = fs.readFileSync(reviewPath, 'utf8').split('\n');
  const start = lines.findIndex(l => l.startsWith('## 建议人工复查清单'));
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** git diff numstat：任务基线提交 → 工作区（排除 .harness 自身） */
function diffNumstat(root, baseCommit) {
  try {
    const range = baseCommit ? `${baseCommit}` : 'HEAD';
    const out = execSync(
      `git diff --numstat ${range} -- . ':(exclude).harness' ':(exclude)node_modules'`,
      { encoding: 'utf8', cwd: root, maxBuffer: 10 * 1024 * 1024 }
    );
    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [add, del, file] = line.split('\t');
        return { file, add: add === '-' ? '-' : parseInt(add, 10), del: del === '-' ? '-' : parseInt(del, 10) };
      });
  } catch {
    return null;
  }
}

function runGit(root, args) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', cwd: root }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 主流程

function main() {
  const args = process.argv.slice(2);
  const taskId = getArg(args, 'task-id');
  const rootArg = getArg(args, 'root');
  const outputArg = getArg(args, 'output');
  const baseArg = getArg(args, 'base');

  if (!taskId) {
    console.error('Usage: node review-brief.js --task-id=<id> [--root=<dir>] [--base=<commit>] [--output=<path>]');
    process.exit(1);
  }

  const root = findHarnessRoot(rootArg || process.cwd());
  if (!root) {
    console.error(`未找到 .harness：${rootArg || process.cwd()}`);
    process.exit(1);
  }

  const ws = path.join(root, '.harness', 'workspace', taskId);
  const checkpoint = readJson(path.join(ws, 'checkpoint.json'));
  if (!checkpoint) {
    console.error(`checkpoint 缺失：${path.join(ws, 'checkpoint.json')}`);
    process.exit(1);
  }

  const baseCommit = baseArg || checkpoint.git_commit_before_task || null;
  if (!baseCommit) {
    console.error(`提示：checkpoint 未记录 git_commit_before_task（阶段推进时可能被覆盖），diff 将退化为对 HEAD 的比较；可用 --base <commit> 指定任务基线提交。`);
  }
  const taskTitle = (() => {
    // 优先 task.md 的 H1 标题；编排器模式下任务描述在 manifest，无 task.md 时用它兜底
    const p = path.join(ws, 'task.md');
    if (fs.existsSync(p)) {
      const first = fs.readFileSync(p, 'utf8').split('\n').find(l => /^# /.test(l));
      if (first) return first.replace(/^# /, '');
    }
    return checkpoint.task_desc || taskId;
  })();

  // 变更文件（机械）
  const diff = diffNumstat(root, baseCommit);

  // 各阶段 Summary：从 checkpoint.stage_outputs 读真实产物映射（而非硬编码 feature 工作流）
  // 顺序 = 阶段完成顺序（stage_outputs 的插入序）
  const stageSummaries = Object.entries(checkpoint.stage_outputs || {}).map(([stage, file]) => ({
    stage,
    summary: extractSummary(path.join(ws, file)),
  }));

  // 验证证据
  const verify = readJson(path.join(ws, 'verify', 'verification-result.json'));
  const verifyLine = verify
    ? `${verify.overall_status}（命令来自 ${verify.config_source}；` +
      verify.commands.map(c => `${c.command}→${c.status}`).join('、') + '）'
    : '（无验证证据）';

  // 审查计数 + 复查清单
  const counts = extractCounts(path.join(ws, 'review-report.md'));
  const countsLine = counts
    ? Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' / ')
    : '（无法解析审查计数）';
  const humanList = extractHumanReviewList(path.join(ws, 'review-report.md'));
  const humanListBlock = humanList
    ? humanList
    : '（review-report 未包含建议人工复查清单——请 review 阶段按模板生成）';

  // 组装简报
  const lines = [];
  lines.push(`# 审核简报：${taskTitle}`);
  lines.push('');
  lines.push(`- 任务：${taskId} ｜ 工作流：${checkpoint.workflow ?? '?'} ｜ 基线提交：${baseCommit ?? '?'}`);
  lines.push(`- 阶段：${(checkpoint.completed_stages || []).join(' → ') || '?'}`);
  lines.push('');
  lines.push('## 变更文件（机械，git diff vs 任务基线提交）');
  lines.push('');
  if (diff && diff.length > 0) {
    lines.push('| 文件 | + | - |');
    lines.push('|------|---|---|');
    for (const d of diff) lines.push(`| ${d.file} | ${d.add} | ${d.del} |`);
  } else {
    lines.push('（无变更或 diff 不可用——确认基线提交与工作区状态）');
  }
  lines.push('');
  lines.push('## 各阶段结论（Summary 原样提取）');
  lines.push('');
  const hasAnySummary = stageSummaries.some((s) => !s.summary.startsWith('（无') && s.summary !== '（缺失）');
  if (!hasAnySummary) {
    lines.push('（本工作流产出物无 `## Summary for downstream` 区块——该区块是代码流程产物的交接约定，需求/非代码流程无此区块属正常）');
    lines.push('');
  } else {
    for (const s of stageSummaries) {
      lines.push(`### ${s.stage}`);
      lines.push(s.summary.split('\n').map(l => (l.trim().startsWith('-') ? l : `> ${l}`)).join('\n'));
      lines.push('');
    }
  }
  lines.push('## 验证证据');
  lines.push('');
  lines.push(verifyLine);
  lines.push('');
  lines.push('## 审查发现');
  lines.push('');
  lines.push(countsLine);
  lines.push('');
  lines.push(humanListBlock);
  lines.push('');

  const brief = lines.join('\n');
  if (outputArg) {
    fs.mkdirSync(path.dirname(path.resolve(root, outputArg)), { recursive: true });
    fs.writeFileSync(path.resolve(root, outputArg), brief, 'utf8');
    console.log(`审核简报已生成：${path.resolve(root, outputArg)}`);
  } else {
    console.log(brief);
  }
}

main();
