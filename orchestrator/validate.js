#!/usr/bin/env node

/**
 * validate.js — 阶段交卷校验（编排器数据级门禁）
 *
 * 两层校验（见 docs/orchestrator-design.md §6）：
 *   - 结构层：stage-result.json 字段名/类型（固定协议），stage 必须等于 checkpoint 的 current_stage
 *   - 规则层：调 tools/stage-check.js 的 checkStage 做机械检查
 *     （产出物存在性 + sections 内容匹配 + require_verify 证据对账）
 *   ★ sections_ok 是子代理自报字段，validate 不采信——通过与否以 checkStage 结果为准
 *
 * 参数全部从文件读（全局约束：禁止 LLM 传参）：
 *   - checkpoint.json        → current_stage / workflow / stage_outputs
 *   - stage-result.json      → 子代理落盘的 JSON 摘要
 *   - workflow 插件包定义     → loadWorkflowDefinition
 */

const path = require('path');
const { readJson, checkStage } = require('../tools/stage-check.js');
const { loadWorkflowDefinition, resolveVerifyCommands } = require('../tools/workflow-lib.js');

const RESULT_FIELDS = ['stage', 'output_file', 'sections_ok', 'verify_evidence', 'notes'];

/**
 * 结构层校验：字段存在性 + 类型（固定协议）。
 * @param {any} result stage-result.json 内容
 * @returns {string[]} 失败原因列表
 */
function validateStructure(result) {
  const failures = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return ['stage-result.json 不是合法的 JSON 对象'];
  }
  const missing = RESULT_FIELDS.filter((k) => !(k in result));
  if (missing.length > 0) {
    failures.push(`stage-result.json 缺少字段：${missing.join(', ')}（协议固定：${RESULT_FIELDS.join('/')}）`);
  }
  if (typeof result.stage !== 'string') failures.push('stage 必须是 string');
  if (typeof result.output_file !== 'string') failures.push('output_file 必须是 string');
  if (typeof result.sections_ok !== 'boolean') failures.push('sections_ok 必须是 boolean');
  if (result.verify_evidence !== null && typeof result.verify_evidence !== 'string') {
    failures.push('verify_evidence 必须是 string 或 null');
  }
  return failures;
}

/**
 * 阶段交卷校验（结构层 + 规则层）。
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} opts.taskId
 * @returns {{ ok: boolean, failures: string[], stage: string|null }}
 */
function validate({ root, taskId }) {
  const checkpoint = readJson(path.join(root, '.harness', 'workspace', taskId, 'checkpoint.json'));
  if (!checkpoint) return { ok: false, failures: ['checkpoint.json 不存在'], stage: null };
  const stage = checkpoint.current_stage;

  const result = readJson(path.join(root, '.harness', 'workspace', taskId, 'stage-result.json'));
  if (!result) {
    return { ok: false, failures: [`stage-result.json 不存在（子代理未落盘结果，见 workspace/${taskId}/）`], stage };
  }

  const failures = validateStructure(result);
  if (result.stage && result.stage !== stage) {
    failures.push(`stage 不匹配：stage-result.json=${result.stage}，checkpoint.current_stage=${stage}`);
  }
  if (failures.length > 0) return { ok: false, failures, stage };

  // 规则层：机械检查（不采信 result.sections_ok）
  const wfDef = loadWorkflowDefinition(root, checkpoint.workflow);
  let verifyCommands = null;
  if (wfDef) {
    try {
      verifyCommands = resolveVerifyCommands(root, wfDef);
    } catch (e) {
      failures.push(`verify 手段解析失败：${e.message}`);
    }
  }
  const st = wfDef && wfDef.stages[stage];
  const output = (checkpoint.stage_outputs && checkpoint.stage_outputs[stage]) || (st && st.output);
  failures.push(...checkStage({ root, taskId, stage, wfDef, output, verifyCommands }));

  return { ok: failures.length === 0, failures, stage };
}

module.exports = { validate, validateStructure };
