#!/usr/bin/env node

/**
 * check-verify.js — 绕过验证检测（只提醒，不拦截）
 *
 * 注册：PostToolUse 匹配 Bash
 * 行为：检测到 LLM 直接跑测试/构建命令（npm test / pnpm build 等）时，
 *       提醒改用 verify 通道，否则结果不计入证据链、gate 不放行。
 * 设计：命令变体无限，hook 是概率性提醒；否决权全部交给 gate-check 的证据校验。
 */

const { readStdin, findHarnessRoot, emitReminder, exitOk } = require('./lib.js');

// 直接执行测试/构建/检查类命令的模式
const VERIFY_COMMAND_RE = /(^|\s)(npm|pnpm|yarn|bun|npx)\s+(run\s+)?(test|build|lint|typecheck|type-check|tsc|check)(\s|$)/i;

function main() {
  const input = readStdin();
  if (!input || input.hook_event_name !== 'PostToolUse' || input.tool_name !== 'Bash') {
    exitOk();
  }
  if (!findHarnessRoot(input.cwd)) exitOk();

  const command = input.tool_input && input.tool_input.command;
  if (!command || !VERIFY_COMMAND_RE.test(command)) exitOk();

  emitReminder(
    'PostToolUse',
    `[harness] 检测到直接执行验证命令：${command}\n` +
      '测试/构建结果只有通过 verify 通道（`node .harness/tools/verify.js run`，命令来自项目配置 ' +
      'knowledge/verify.config.json）执行才会写入 verification-result.json，阶段 gate 校验只认这份证据。请改用 verify 工具重新执行。'
  );
  exitOk();
}

main();
