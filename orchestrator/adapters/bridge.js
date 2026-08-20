#!/usr/bin/env node

/**
 * bridge.adapter.js — 默认执行形态（LLM 中转）
 *
 * 生成"阶段指令 → 子代理 prompt"的翻译文本，主 agent 照抄进 Agent 工具。
 * 状态和校验仍在编排器程序里，主 agent 只是桥：不修改指令字段、不生成参数。
 */

/**
 * 生成阶段子代理的完整 prompt（桥形态：主 agent 照抄进 Agent 工具）。
 * @param {object} ins  阶段指令（buildStageInstruction 输出）
 * @param {object} ctx  { root, taskId, workflow }
 * @returns {string}
 */
function buildSubagentPrompt(ins, ctx) {
  const verifyLine = ins.require_verify
    ? `4. 若为 testing/reviewing：用 node .harness/tools/verify.js run 产出证据（命令来自 knowledge/verify.config.json，禁止 --commands 自选），证据落盘 .harness/workspace/${ctx.taskId}/verify/verification-result.json`
    : '';
  // 技能路径：显式相对项目根（.harness/ 或 knowledge/）直接用；隐式 skills/... 加 .harness 前缀。
  // 子代理 cwd 是项目根，用相对路径。
  const explicit = ins.skill_path.startsWith('.harness/') || ins.skill_path.startsWith('knowledge/');
  const skillRef = explicit ? ins.skill_path : `.harness/${ins.skill_path}`;
  return [
    `你是 harness 任务「${ctx.taskId}」的「${ins.stage}」阶段代理（工作流 ${ins.workflow}）。`,
    `工作目录：${ctx.root}`,
    `1. 先读取并遵循技能（相对项目根）：${skillRef}（若不存在，尝试 .harness/${ins.skill_path}）`,
    `2. 阶段输入文件（存在则读）：${(ins.input_files || []).join('、') || '（无）'}`,
    `3. 必须写出的产出物：.harness/workspace/${ctx.taskId}/${ins.output_file}（遵守对应模板的必含区块，见技能）`,
    verifyLine,
    `5. 完成后，把 JSON 摘要写入 .harness/workspace/${ctx.taskId}/stage-result.json（用 Write 工具落盘），格式固定：`,
    '```json',
    `{ "stage": "${ins.stage}", "output_file": "${ins.output_file}", "sections_ok": true, "verify_evidence": "workspace/${ctx.taskId}/verify/verification-result.json", "notes": "..." }`,
    '```',
    'sections_ok 必须如实填写（编排器会独立机械检查产出物，不采信此字段）。',
    `6. 读取范围限制（任务隔离）：只允许读取 本任务目录（.harness/workspace/${ctx.taskId}/）、项目源码、.harness/skills/、.harness/workflows/；禁止读取 .harness/workspace/ 下其他任务目录（如 task-001/、其他 task-id 目录）——跨任务读取会造成污染`,
    `7. **禁止运行 skill-log.js**（node .harness/tools/...）：编排器会在阶段推进时程序化执行记账（skill-logs），子代理不需要也不应该自己运行，避免路径/格式冲突`,
  ].filter(Boolean).join('\n');
}

/**
 * 生成用户确认提示（桥形态：主 agent 用 AskUserQuestion）。
 */
function buildApprovalPrompt(stage, ctx) {
  return `阶段「${stage.name || stage}」产出已通过机械校验，是否确认进入下一阶段？（确认后执行 approve --task-id ${ctx.taskId} --stage ${stage.name || stage}）`;
}

module.exports = { buildSubagentPrompt, buildApprovalPrompt };
