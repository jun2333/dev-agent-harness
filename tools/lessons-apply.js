#!/usr/bin/env node

/**
 * lessons-apply.js — 经验记账工具（确定性）
 *
 * 职责：解析任务产出 task-plan.md 的 `## Lessons Applied` 区块，对其中**结构化声明**
 * 命中的 lessons 文件递增 use_count 并更新 last_used。
 *
 * 分工（避免上次"agent 既判断又改文件、又被告知别改文件"的冲突）：
 *   - 判断（是否用上）由 LLM（task-planning 阶段）做：在 task-plan.md 声明命中经验的文件名
 *   - 记账（递增计数）由本工具做：机械、确定性、不依赖 LLM 自觉
 *
 * 防重复：已记账的经验记录在 workspace/{task-id}/lessons-applied.json，rework 重跑不会重复计数。
 *
 * 用法：node lessons-apply.js --task-id <id>
 * 运行位置：task-planning 阶段 post_stage（由 orchestrator/core.js 调用）
 */

const fs = require('fs');
const path = require('path');

function findHarnessRoot(startDir) {
  let current = path.resolve(startDir || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, '.harness'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function getArg(args, name) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  const root = findHarnessRoot(process.cwd());
  if (!root) { console.error('[lessons-apply] 未找到 .harness 目录'); process.exit(1); }
  const taskId = getArg(process.argv.slice(2), 'task-id');
  if (!taskId) { console.error('Usage: node lessons-apply.js --task-id <id>'); process.exit(1); }

  const taskPlanPath = path.join(root, '.harness', 'workspace', taskId, 'task-plan.md');
  if (!fs.existsSync(taskPlanPath)) {
    console.log(`[lessons-apply] 无 task-plan.md（${taskId}），跳过`);
    return;
  }
  const content = fs.readFileSync(taskPlanPath, 'utf8');

  // 提取 ## Lessons Applied 区块（到下一个 ## 或文件尾）
  const section = content.match(/## Lessons Applied([\s\S]*?)(?=\n## |$)/);
  if (!section || !section[1].trim()) {
    console.log(`[lessons-apply] ${taskId} 无 Lessons Applied 区块，跳过`);
    return;
  }
  const sec = section[1];

  // 匹配 lessons 文件名引用：`NN-slug.md`（容忍 knowledge/lessons/ 或 lessons/ 前缀）
  const refs = new Set();
  for (const m of sec.matchAll(/(?:knowledge\/lessons\/|lessons\/)?([0-9]+-[a-z0-9-]+\.md)/g)) {
    refs.add(m[1]);
  }
  if (refs.size === 0) {
    console.log(`[lessons-apply] ${taskId} 的 Lessons Applied 无 lessons 文件名引用，跳过`);
    return;
  }

  // 已记账集合（防 rework 重复计数）
  const appliedFile = path.join(root, '.harness', 'workspace', taskId, 'lessons-applied.json');
  let applied = new Set();
  if (fs.existsSync(appliedFile)) {
    try { applied = new Set(JSON.parse(fs.readFileSync(appliedFile, 'utf8'))); } catch { applied = new Set(); }
  }

  const lessonsDir = path.join(root, 'knowledge', 'lessons');
  const changed = [];
  for (const ref of refs) {
    if (applied.has(ref)) continue;
    const lp = path.join(lessonsDir, ref);
    if (!fs.existsSync(lp)) {
      console.log(`[lessons-apply] 跳过不存在的 lessons 文件：${ref}`);
      continue;
    }
    const orig = fs.readFileSync(lp, 'utf8');
    if (!/^use_count:/m.test(orig)) {
      console.log(`[lessons-apply] ${ref} 无 use_count 字段，跳过`);
      continue;
    }
    let updated = orig.replace(/^use_count:\s*(\d+)/m, (m, n) => `use_count: ${Number(n) + 1}`);
    if (/^last_used:/m.test(updated)) {
      updated = updated.replace(/^last_used:.*$/m, `last_used: ${today()}`);
    } else {
      updated = updated.replace(/^(use_count:\s*\d+)/m, `$1\nlast_used: ${today()}`);
    }
    fs.writeFileSync(lp, updated);
    applied.add(ref);
    changed.push(ref);
  }

  if (changed.length > 0) {
    fs.writeFileSync(appliedFile, JSON.stringify([...applied], null, 2));
  }
  console.log(`[lessons-apply] ${taskId} 记账完成：${changed.length > 0 ? changed.join(', ') : '无新增'}`);
}

main();
