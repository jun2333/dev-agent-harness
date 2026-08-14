#!/usr/bin/env node

/**
 * gate-check.js — 阶段门禁校验（exit 2 阻塞阶段推进）
 *
 * 注册：PostToolUse 匹配 Write|Edit（写产出物后立即校验）+ Stop（任务收尾终检）
 * 校验：
 *   1. 当前阶段产出物存在（checkpoint.json 的 current_stage 对应的 output 文件）
 *   2. 产出物包含模板必含区块（## Summary for downstream）
 *   3. testing / reviewing 阶段必须存在 verify 证据（verification-result.json 且 passed）
 * 失败：PostToolUse 时 exit 2 + stderr 列出缺失项，CLI 拦截并反馈给 LLM 补齐；
 *       Stop 时只发提醒不阻塞（避免用户中途退出会话被卡住）
 * 容错：不在 harness 任务中（无 checkpoint）→ exit 0，不打扰普通开发；
 *       checkpoint.json 自身写入跳过校验（阶段切换时先写 checkpoint 再产出文件，顺序自由）
 */

const fs = require('fs');
const path = require('path');
const { readStdin, findHarnessRoot, emitReminder, exitBlock, exitOk } = require('./lib.js');

// 阶段 -> 产出物文件（与 workflows/*.yaml 的 output 对应）
const STAGE_OUTPUTS = {
  designing: 'design.md',
  'task-planning': 'task-plan.md',
  implementing: 'changes.md',
  testing: 'test-report.md',
  reviewing: 'review-report.md',
  reflecting: 'lessons-draft.md',
};

const REQUIRED_SECTIONS = ['## Summary for downstream'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 从 Write/Edit 的 file_path 解析 task-id（.harness/workspace/{task-id}/{file}） */
function taskIdFromPath(root, filePath) {
  if (!filePath) return null;
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  const m = rel.match(/^(?:\.harness\/)?workspace\/([^/]+)\/[^/]+$/);
  return m ? m[1] : null;
}

/** 找 workspace 下最新修改的 checkpoint.json */
function latestCheckpoint(root) {
  const workspaceDir = path.join(root, '.harness', 'workspace');
  if (!fs.existsSync(workspaceDir)) return null;
  let latest = null;
  let latestMtime = 0;
  for (const entry of fs.readdirSync(workspaceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cp = path.join(workspaceDir, entry.name, 'checkpoint.json');
    if (!fs.existsSync(cp)) continue;
    const mtime = fs.statSync(cp).mtimeMs;
    if (mtime > latestMtime) {
      latestMtime = mtime;
      latest = cp;
    }
  }
  return latest;
}

function checkStage(root, taskDir, checkpoint) {
  const stage = checkpoint.current_stage;
  const output = checkpoint.stage_outputs && checkpoint.stage_outputs[stage] || STAGE_OUTPUTS[stage];
  if (!output) return []; // 未知阶段（如 git-operations / 复盘），不做硬校验

  const failures = [];
  const outputPath = path.join(root, '.harness', 'workspace', taskDir, output);

  if (!fs.existsSync(outputPath)) {
    failures.push(`产出物缺失：${path.join('workspace', taskDir, output)}`);
    return failures;
  }

  const content = fs.readFileSync(outputPath, 'utf8');
  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      failures.push(`产出物缺少必含区块：${section}（${path.join('workspace', taskDir, output)}）`);
    }
  }

  // testing / reviewing 阶段必须有 verify 证据链
  if (stage === 'testing' || stage === 'reviewing') {
    const verifyReport = path.join(root, '.harness', 'workspace', taskDir, 'verify', 'verification-result.json');
    const verifyData = readJson(verifyReport);
    if (!verifyData) {
      failures.push(
        `缺少 verify 证据：${path.join('workspace', taskDir, 'verify', 'verification-result.json')} 不存在。` +
        '测试必须通过 `node .harness/tools/verify.js run` 执行，结果才会落盘为证据。'
      );
    } else if (verifyData.overall_status !== 'passed') {
      failures.push(`verify 证据显示未通过：overall_status = ${verifyData.overall_status}`);
    }
  }

  return failures;
}

function main() {
  const input = readStdin();
  const root = findHarnessRoot(input && input.cwd);
  if (!root) exitOk();

  const workspaceDir = path.join(root, '.harness', 'workspace');
  const event = input && input.hook_event_name;
  let taskId = null;

  if (event === 'PostToolUse' && (input.tool_name === 'Write' || input.tool_name === 'Edit')) {
    // Write 的 tool_input 是 {file_path} 对象；部分 CLI 的 Edit 直接传路径字符串，两种都兼容
    const ti = input.tool_input;
    const filePath = typeof ti === 'string' ? ti : ti && ti.file_path;
    // checkpoint.json 自身写入跳过校验：阶段切换可以先行写 checkpoint，再产出该阶段文件
    if (filePath && path.basename(filePath) === 'checkpoint.json') exitOk();
    taskId = taskIdFromPath(root, filePath);
  } else if (event === 'Stop') {
    const cp = latestCheckpoint(root);
    if (cp) taskId = path.basename(path.dirname(cp));
  }

  if (!taskId) exitOk();

  const taskDir = path.join(workspaceDir, taskId);
  const checkpoint = readJson(path.join(taskDir, 'checkpoint.json'));
  if (!checkpoint) exitOk();

  const failures = checkStage(root, taskId, checkpoint);
  if (failures.length > 0) {
    const detail = failures.map(f => `- ${f}`).join('\n');
    if (event === 'Stop') {
      // Stop 只提醒不阻塞，避免用户中途退出会话被卡住
      emitReminder(
        'Stop',
        `[harness gate] 收尾终检未通过（提醒，不阻塞）：\n${detail}\n建议补齐证据后再结束会话。`
      );
    } else {
      exitBlock(
        `[harness gate] 阶段「${checkpoint.current_stage}」校验未通过：\n${detail}\n请补齐上述证据后再继续。`
      );
    }
  }
  exitOk();
}

main();
