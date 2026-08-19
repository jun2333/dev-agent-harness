#!/usr/bin/env node

/**
 * stage-check.js — 阶段产出物机械检查（gate-check 与编排器 validate 共享的单一真相源）
 *
 * 从 hooks/gate-check.js 提取：产出物必含区块（sections）+ verify 证据校验。
 * stage 参数可注入：
 *   - gate-check（写入时）：从 checkpoint 填 stage/output
 *   - orchestrator validate（交卷时）：从命令行/checkpoint 填 stage，从 stage-result.json 填 output
 * 两处消费同一份代码 + 同一份插件包定义（workflow.yaml），杜绝实现漂移。
 *
 * 纯字符串匹配 + 文件 IO，无 LLM 参与。
 */

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 校验单个阶段的产出物。
 * @param {object} opts
 * @param {string} opts.root        项目根
 * @param {string} opts.taskId      任务目录名
 * @param {string} opts.stage       阶段名（gate 从 checkpoint 填，validate 从命令行填）
 * @param {object|null} opts.wfDef  插件包定义（loadWorkflowDefinition 结果）
 * @param {string} opts.output      产出物文件名（相对 workspace/{taskId}/）
 * @param {string|null} opts.contentOverride  待写入内容（PreToolUse 用，文件未落盘）；null 则读实际文件
 * @param {string[]|null} opts.verifyCommands 工作流 verify 解析出的命令集（require_verify 阶段对账用）
 * @returns {string[]} 失败原因列表，空数组 = 通过
 */
function checkStage({ root, taskId, stage, wfDef, output, contentOverride, verifyCommands }) {
  const st = wfDef && wfDef.stages[stage];
  // 未知阶段 / 无插件包定义 / 未声明 sections → 不做硬校验（兼容旧任务与 optional 阶段）
  if (!st || !Array.isArray(st.sections)) return [];

  const failures = [];
  const outputPath = path.join(root, '.harness', 'workspace', taskId, output);

  // contentOverride：PreToolUse 时由 tool_input 提供的待写入内容（文件尚未落盘）
  let content = contentOverride;
  if (content === null || content === undefined) {
    if (!fs.existsSync(outputPath)) {
      failures.push(`产出物缺失：${path.join('workspace', taskId, output)}`);
      return failures;
    }
    content = fs.readFileSync(outputPath, 'utf8');
  }

  for (const group of st.sections) {
    if (!Array.isArray(group) || group.length === 0) continue;
    if (!group.some((sec) => content.includes(sec))) {
      failures.push(
        `产出物缺少必含区块（${path.join('workspace', taskId, output)}）：${group.join(' 或 ')}`
      );
    }
  }

  // require_verify 阶段必须有 verify 证据链（他证）
  if (st.require_verify) {
    failures.push(...checkVerifyEvidence({ root, taskId, verifyCommands }));
  }

  return failures;
}

/**
 * verify 证据校验：报告存在 + passed + 命令与工作流 verify 解析命令集对账（他证）。
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} opts.taskId
 * @param {string[]|null} opts.verifyCommands 工作流 verify 解析出的命令集
 * @returns {string[]} 失败原因列表
 */
function checkVerifyEvidence({ root, taskId, verifyCommands }) {
  const failures = [];
  const verifyReport = path.join(root, '.harness', 'workspace', taskId, 'verify', 'verification-result.json');
  const verifyData = readJson(verifyReport);
  if (!verifyData) {
    failures.push(
      `缺少 verify 证据：${path.join('workspace', taskId, 'verify', 'verification-result.json')} 不存在。` +
        '验证必须通过 `node .harness/tools/verify.js run` 执行（命令来自工作流 verify 声明），结果才会落盘为证据。'
    );
    return failures;
  }
  if (verifyData.overall_status !== 'passed') {
    failures.push(`verify 证据显示未通过：overall_status = ${verifyData.overall_status}`);
  }

  if (verifyCommands) {
    const reportCommands = (verifyData.commands || [])
      .map((c) => (typeof c === 'string' ? c : c && c.command))
      .filter(Boolean);

    const ran = new Set(reportCommands);
    const notRun = verifyCommands.filter((c) => !ran.has(c));
    if (notRun.length > 0) {
      failures.push(
        `verify 证据未覆盖工作流声明的命令：${notRun.join(', ')}（声明命令必须全量执行，不允许只跑部分）`
      );
    }
    const extra = reportCommands.filter((c) => !verifyCommands.includes(c));
    if (extra.length > 0) {
      failures.push(
        `verify 证据包含工作流声明外的命令：${extra.join(', ')}（命令只能来自工作流 verify checks，如需新增请修改 workflow.yaml）`
      );
    }
  }

  if (!verifyData.config_source) {
    failures.push(
      'verify 证据缺少 config_source 字段：请使用新版 `node .harness/tools/verify.js run`（命令来自工作流声明/项目配置）重新生成证据。'
    );
  }

  return failures;
}

module.exports = { checkStage, checkVerifyEvidence, readJson };
