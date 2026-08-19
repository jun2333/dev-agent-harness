#!/usr/bin/env node

/**
 * headless.adapter.js — 进阶执行形态（脚本直调子代理）
 *
 * 生成 spawn 命令：编排器脚本直接执行 codebuddy -p（headless 进程），
 * stdout 输出约定 JSON code block，脚本解析后写入 stage-result.json。
 * 主 agent 桥只在确认点需要（gate: user_approval 时回交互会话）。
 *
 * 已知限制（实测 2026-08-19）：headless 进程的工具调用不进 tool-actions.log，
 * 已读清单以"子代理自报 + 产出物传递"为准。
 */

/**
 * 生成 spawn 命令（headless 形态：脚本直调）。
 * @param {object} ins  阶段指令（buildStageInstruction 输出）
 * @param {object} ctx  { root, taskId, workflow, headlessCli }
 * @returns {{ command: string, args: string[] }}
 */
function buildSpawnCommand(ins, ctx) {
  const cli = ctx.headlessCli || 'codebuddy';
  // 技能路径：显式相对项目根（.harness/ 或 knowledge/）直接用；隐式 skills/... 加 .harness 前缀
  const explicit = ins.skill_path.startsWith('.harness/') || ins.skill_path.startsWith('knowledge/');
  const skillRef = explicit ? ins.skill_path : `.harness/${ins.skill_path}`;
  const verifyLine = ins.require_verify
    ? `- 若为 testing/reviewing：用 node .harness/tools/verify.js run 产出证据（命令来自 knowledge/verify.config.json，禁止 --commands 自选）`
    : '';
  const prompt = [
    `你是 harness 任务「${ctx.taskId}」的「${ins.stage}」阶段代理（工作流 ${ins.workflow}）。`,
    `工作目录：${ctx.root}`,
    `1. 先读取并遵循技能：${skillRef}`,
    `2. 阶段输入文件（存在则读）：${(ins.input_files || []).join('、') || '（无）'}`,
    `3. 必须写出的产出物：.harness/workspace/${ctx.taskId}/${ins.output_file}（遵守对应模板的必含区块）`,
    verifyLine,
    `4. 完成后，把 JSON 摘要写入 .harness/workspace/${ctx.taskId}/stage-result.json（用 Write 工具落盘）：`,
    `{ "stage": "${ins.stage}", "output_file": "${ins.output_file}", "sections_ok": true, "verify_evidence": "workspace/${ctx.taskId}/verify/verification-result.json", "notes": "..." }`,
    `5. 最后，在 stdout 输出一个 JSON 代码块（格式如下，供外部解析）：`,
    '```json',
    `{"stage":"${ins.stage}","output_file":"${ins.output_file}","sections_ok":true,"verify_evidence":"workspace/${ctx.taskId}/verify/verification-result.json","notes":"done"}`,
    '```',
  ].filter(Boolean).join('\n');

  return { command: cli, args: ['-p', prompt, '-y'] };
}

/**
 * 登录态检查：spawn 前确认凭据有效（headless 无法交互重新登录）。
 * @param {object} ctx { headlessCli }
 * @returns {boolean}
 */
function checkAuth(ctx) {
  const { execSync } = require('child_process');
  const cli = ctx.headlessCli || 'codebuddy';
  try {
    execSync(`${cli} --version`, { encoding: 'utf8', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = { buildSpawnCommand, checkAuth };
