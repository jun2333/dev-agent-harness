#!/usr/bin/env node

/**
 * post-tool-log.js — 工具调用自动记账（async hook，不阻塞）
 *
 * 注册：PostToolUse 全量工具
 * 行为：每次工具调用后追加一行 JSON 到 .harness/workspace/tool-actions.log
 *       （会话级最小执行日志，替代 LLM 事后自述的 execution-log）
 * 失败策略：日志 hook 永远 exit 0，任何异常都不影响主流程
 */

const fs = require('fs');
const path = require('path');
const { readStdin, findHarnessRoot, exitOk } = require('./lib.js');

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

  const logDir = path.join(root, '.harness', 'workspace');
  const logFile = path.join(logDir, 'tool-actions.log');

  const record = {
    ts: new Date().toISOString(),
    session_id: input.session_id || null,
    tool_use_id: input.tool_use_id || null,
    event: input.hook_event_name || null,
    tool: input.tool_name || null,
    input: input.tool_name ? summarizeToolInput(input.tool_name, input.tool_input) : null,
    cwd: input.cwd || null,
  };

  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // 日志失败不影响主流程
  }
  exitOk();
}

main();
