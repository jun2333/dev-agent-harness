#!/usr/bin/env node

/**
 * post-tool-log.js — 工具调用自动记账（async hook，不阻塞）
 *
 * 注册：PostToolUse 全量工具
 * 行为：每次工具调用后追加一行 JSON 到全局按日日志：
 *       .harness/workspace/tool-actions/{YYYY-MM-DD}.log
 *       每条记录带 task_id（从编排器维护的 .harness/workspace/.active-task.json 读取；
 *       非任务状态时为 null）。
 * 目的：确定性记录 agent 实际工具调用（审计 + context-snapshot 已读清单数据源），
 *       日志全局记录 + 按日归档便于清理；按 task_id 过滤查询不耗 token。
 * 失败策略：日志 hook 永远 exit 0，任何异常都不影响主流程
 */

const fs = require('fs');
const path = require('path');
const { readStdin, findHarnessRoot, exitOk } = require('./lib.js');

/** 读编排器维护的全局任务状态（.active-task.json），返回 task_id 或 null */
function readActiveTask(root) {
  const stateFile = path.join(root, '.harness', 'workspace', '.active-task.json');
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return state && state.status === 'active' && state.task_id ? state.task_id : null;
  } catch {
    return null;
  }
}

function summarizeToolInput(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return String(toolInput || '');
  if (toolInput.command) return String(toolInput.command);
  if (toolInput.file_path) return String(toolInput.file_path);
  if (toolInput.old_string || toolInput.new_string) {
    return `${toolInput.file_path || ''} (edit)`;
  }
  const json = JSON.stringify(toolInput);
  return json.length > 500 ? json.slice(0, 500) + '...' : json;
}

function main() {
  const input = readStdin();
  const root = findHarnessRoot(input && input.cwd);
  if (!root) exitOk();

  const logDir = path.join(root, '.harness', 'workspace', 'tool-actions');
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const logFile = path.join(logDir, `${day}.log`);

  const record = {
    ts: new Date().toISOString(),
    session_id: input.session_id || null,
    tool_use_id: input.tool_use_id || null,
    event: input.hook_event_name || null,
    tool: input.tool_name || null,
    input: input.tool_name ? summarizeToolInput(input.tool_name, input.tool_input) : null,
    cwd: input.cwd || null,
    task_id: readActiveTask(root), // 编排器维护的当前任务；非任务状态为 null
  };

  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // 日志失败不影响主流程
  }
  exitOk();
}

module.exports = { readActiveTask };

main();
