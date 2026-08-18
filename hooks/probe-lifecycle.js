#!/usr/bin/env node

/**
 * hooks/probe-lifecycle.js — 生命周期探针（仅用于验证宿主是否真实触发 hook）
 *
 * 宿主在 hook 事件发生时通过 stdin 传入 JSON payload。本脚本：
 *   - 解析 payload，按「事件名 + 时间戳 + 关键字段」追加写入日志文件
 *   - 永远 exit 0（非阻塞），绝不拦截宿主正常运行
 *
 * 日志位置：默认 ~/.workbuddy/hook-probe.log，可用环境变量 HOOK_PROBE_LOG 覆盖。
 *
 * 用法（手动注册到宿主 settings 验证触发）：
 *   PostToolUse / Stop 等事件 -> node /abs/path/hooks/probe-lifecycle.js
 * 验证：在目标项目跑一次真实任务，然后 `cat ~/.workbuddy/hook-probe.log`
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG = process.env.HOOK_PROBE_LOG || path.join(os.homedir(), '.workbuddy', 'hook-probe.log');

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (e) {
    raw = '';
  }
  const ts = new Date().toISOString();

  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (e) {
    payload = { _parseError: e.message };
  }

  const event = payload.hook_event_name || 'UNKNOWN';
  const fields = [];
  if (payload.session_id) fields.push('session=' + payload.session_id);
  if (payload.cwd) fields.push('cwd=' + payload.cwd);
  if (payload.tool_name) fields.push('tool=' + payload.tool_name);
  if (payload.prompt) fields.push('prompt=' + String(payload.prompt).slice(0, 60));
  if (payload.source) fields.push('source=' + payload.source);

  const line = `[${ts}] ${event} ${fields.join(' ')}\n`;

  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, line, 'utf8');
  } catch (e) {
    // 探针自身失败绝不能影响宿主：写 stderr 但不阻塞
    process.stderr.write('[probe] 写日志失败: ' + e.message + '\n');
  }
  process.exit(0);
}

main();
