#!/usr/bin/env node

/**
 * harness hooks 共享库
 *
 * 三个 CLI（QoderCLI / Claude Code / Codex）的 hook 协议同源：
 * - stdin 传入事件 JSON（session_id / cwd / hook_event_name / tool_name / tool_input）
 * - exit 0 = 成功；exit 2 = 阻塞（stderr 作为 reason）；其他 = 非阻塞警告
 * - stdout 输出 JSON（decision / reason / hookSpecificOutput.hookEventName + additionalContext）
 *
 * 跨 CLI 兼容约束（Codex 对 stdout 严格校验未知字段）：
 * 提醒只输出 hookSpecificOutput 交集字段，拦截统一 exit 2 + stderr。
 */

const fs = require('fs');
const path = require('path');

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 从 hook 输入或 cwd 向上查找 .harness 目录（项目根） */
function findHarnessRoot(startDir) {
  const candidates = [];
  if (startDir) candidates.push(startDir);
  candidates.push(process.cwd());
  for (const dir of candidates) {
    let current = path.resolve(dir);
    while (true) {
      if (fs.existsSync(path.join(current, '.harness'))) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}

/** 输出提醒 JSON：hookSpecificOutput 交集字段，三个 CLI 都认 */
function emitReminder(hookEventName, message) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext: message,
    },
  }));
}

/** 输出阻塞 JSON（备用通道；默认推荐 exit 2 + stderr） */
function emitBlock(reason) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: {
      hookEventName: process.env.HARNESS_HOOK_EVENT || 'PostToolUse',
      additionalContext: reason,
    },
  }));
}

function exitOk() {
  process.exit(0);
}

function exitBlock(reason) {
  process.stderr.write(reason);
  process.exit(2);
}

module.exports = {
  readStdin,
  findHarnessRoot,
  emitReminder,
  emitBlock,
  exitOk,
  exitBlock,
};
