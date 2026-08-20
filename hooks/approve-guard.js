#!/usr/bin/env node

/**
 * approve-guard.js — approve 命令确认码门禁（PreToolUse 拦截无码审批）
 *
 * 注册：PreToolUse 匹配 Bash
 * 行为：检测到 `core.js approve` 命令缺少 `--code` 参数时 exit 2 阻断，
 *       强制审批必须携带一次性确认码（由 run-stage / advance 生成）。
 *
 * 定位：这是"流程凭证"机制，不是安全墙——
 *   - 确认码让"批准"动作在 checkpoint 留下可追踪凭证（何时、用何码批准）
 *   - 无码 approve 被拦，防止主 agent 顺手跳过审批、流程短路
 *   - 真正的用户确认发生在 AskUserQuestion 交互（用户可见、可拒），
 *     确认码只是该确认的落盘凭证；主 agent 若有心，文件系统可绕
 *     （读码/改 checkpoint），故本机制不承担"防内鬼"职责。
 *
 * 判定（确定性，字符串匹配）：
 *   - 命令含 orchestrator/core.js(或 core.js) 且子命令为 approve
 *   - 若同时含 --code(=xxx 或空格分隔) → 放行（core.js 内部还会校验码匹配）
 *   - 无 --code → 阻断
 */

const { readStdin, findHarnessRoot, exitBlock, exitOk } = require('./lib.js');

// 匹配 `node .../core.js approve`（子命令 approve 出现）
const APPROVE_RE = /(?:core\.js|orchestrator)\s+approve\b/i;
// 匹配 --code=<val> 或 --code <val>
const CODE_RE = /--code(?:\s*=\s*[^\s]+|\s+[^\s]+)/i;

function main() {
  const input = readStdin();
  if (!input || input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') {
    exitOk();
  }
  if (!findHarnessRoot(input.cwd)) exitOk();

  const command = input.tool_input && input.tool_input.command;
  if (!command || !APPROVE_RE.test(command)) exitOk();

  if (CODE_RE.test(command)) exitOk(); // 带确认码：放行（core.js 内部校验匹配）

  exitBlock(
    '[harness] approve 命令缺少确认码（--code <code>）：审批需留凭证。\n' +
      '流程：run-stage（或 advance）会生成一次性确认码 → 向用户展示产出并获取确认（AskUserQuestion）→ ' +
      '执行 `node .harness/orchestrator/core.js approve --task-id <id> --stage <name> --code <code>`。\n' +
      '确认码是审批流程的落盘凭证，无码 approve 会被拒绝（防流程短路）。'
  );
}

main();
