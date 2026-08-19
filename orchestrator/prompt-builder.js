#!/usr/bin/env node

/**
 * prompt-builder.js — 阶段指令组装（编排器核心的一部分）
 *
 * 把插件包 stage 定义转成"阶段指令"（结构化数据），adapter 据此生成
 * 子代理 prompt（bridge：主 agent 照抄进 Agent 工具；headless：拼进 spawn 命令）。
 *
 * 全局约束：阶段指令由脚本生成，LLM 不传参、不修改字段。
 */

/**
 * 组装单个阶段的执行指令。
 * @param {object} opts
 * @param {string} opts.taskId      workspace 目录名
 * @param {object} opts.wfDef       插件包定义（loadWorkflowDefinition 结果）
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
  };
}

module.exports = { buildStageInstruction };
