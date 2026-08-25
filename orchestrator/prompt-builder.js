#!/usr/bin/env node

/**
 * prompt-builder.js — 阶段指令组装（编排器核心的一部分）
 *
 * 把工作流 stage 定义转成"阶段指令"（结构化数据），adapter 据此生成
 * 子代理 prompt（bridge：主 agent 照抄进 Agent 工具；headless：拼进 spawn 命令）。
 *
 * 全局约束：阶段指令由脚本生成，LLM 不传参、不修改字段。
 */

/**
 * 组装单个阶段的执行指令。
 * @param {object} opts
 * @param {string} opts.taskId      workspace 目录名
 * @param {object} opts.wfDef       工作流定义（loadWorkflowDefinition 结果）
 * @param {string} opts.stageName   阶段名
 * @param {number} opts.stageNo     阶段序号（1-based）
 * @param {number} opts.total       阶段总数
 * @returns {object} 阶段指令 JSON
 */
function buildStageInstruction({ taskId, wfDef, stageName, stageNo, total }) {
  const stage = wfDef.stages[stageName];
  if (!stage) {
    throw new Error(`工作流 ${wfDef.name} 无阶段 ${stageName}`);
  }
  const inputs = Array.isArray(stage.input) ? stage.input : stage.input ? [stage.input] : [];
  return {
    stage: stageName,
    stage_no: stageNo,
    total,
    workflow: wfDef.name,
    skill_path: stage.skill,
    sub_command: stage.sub_command || null,
    input_files: inputs.map((f) => `.harness/workspace/${taskId}/${f}`),
    output_file: stage.output,
    gate: stage.gate || 'none',
    require_verify: !!stage.require_verify,
    optional: !!stage.optional,
    executor: stage.executor || 'inline', // inline=主 agent 直接执行（默认，hook 生效）；subagent=派独立子代理（隔离，需显式配置）
    // 阶段完成后主 agent 的推进步骤（bridge 形态下，含用户交互的阶段由主 agent 亲自执行时按此收尾；
    // 若已派子代理执行，则子代理已按 bridge prompt 落盘 stage-result.json，只需 validate/advance）
    after_stage: [
      `写产出摘要到 .harness/workspace/${taskId}/stage-result.json（Write 工具落盘，schema：{"stage":"${stageName}","output_file":"${stage.output}","sections_ok":true,"verify_evidence":null,"notes":"..."}；非 testing/reviewing 阶段 verify_evidence 填 null）`,
      `校验：node .harness/orchestrator/core.js validate --task-id ${taskId}`,
      stage.gate === 'user_approval'
        ? `人工确认：validate 通过后用 AskUserQuestion 让用户确认，再执行 node .harness/orchestrator/core.js approve --task-id ${taskId} --stage ${stageName} --code <确认码>`
        : null,
      `推进：node .harness/orchestrator/core.js advance --task-id ${taskId}`,
    ].filter(Boolean),
  };
}

module.exports = { buildStageInstruction };
