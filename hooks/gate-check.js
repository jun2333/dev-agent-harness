#!/usr/bin/env node

/**
 * gate-check.js — 阶段门禁校验（按工作流插件包定义，PreToolUse exit 2 阻断工具调用）
 *
 * 注册：PreToolUse 匹配 Write|Edit（写产出物前校验，阻断不合规写入）+ Stop（任务收尾终检）
 *       （Claude Code 等宿主注册在 PostToolUse，脚本双事件兼容）
 * 设计依据：
 *   - 产出物要求（sections/require_verify）**不再硬编码**，从工作流插件包
 *     .harness/workflows/{workflow}/workflow.yaml 加载（workflow-plugin 机制，单一真相源）
 *   - WorkBuddy/CodeBuddy 契约中 PostToolUse exit 2 不阻断，仅 PreToolUse 能真正阻止写入
 * 校验：
 *   1. 当前阶段产出物包含该阶段必含区块（来自插件包定义的 sections）
 *   2. testing / reviewing 阶段（require_verify）必须存在 verify 证据
 *      （verification-result.json 且 passed），且证据命令与工作流 verify 声明解析出的
 *      命令集对账（他证）：命令必须来自工作流 verify checks（内置 check / 项目命令池），
 *      配置命令全量执行、无配置外命令
 * 失败：PreToolUse 时 exit 2 + stderr 列出缺失项，阻断写入并反馈给 LLM 补齐；
 *       Stop 时只发提醒不阻塞（避免用户中途退出会话被卡住）
 * 容错：不在 harness 任务中（无 checkpoint）→ exit 0；工作流插件包缺失 → 降级不阻塞（stderr 提示）；
 *       checkpoint.json 自身写入跳过校验
 */

const fs = require('fs');
const path = require('path');
const { readStdin, findHarnessRoot, emitReminder, exitBlock, exitOk } = require('./lib.js');
const { loadWorkflowDefinition, resolveVerifyCommands, listWorkflows } = require('../tools/workflow-lib.js');
// 产出物机械检查的单一真相源（gate-check 与编排器 validate 共用）
const { checkStage, checkVerifyEvidence, readJson } = require('../tools/stage-check.js');

/** 从 Write/Edit 的 file_path 解析 task-id（.harness/workspace/{task-id}/{file}） */
function taskIdFromPath(root, filePath) {
  if (!filePath) return null;
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  const m = rel.match(/^(?:\.harness\/)?workspace\/([^/]+)\/[^/]+$/);
  return m ? m[1] : null;
}

/** 找 workspace 下最新修改的 checkpoint.json */
function latestCheckpoint(root) {
  const workspaceDir = path.join(root, '.harness', 'workspace');
  if (!fs.existsSync(workspaceDir)) return null;
  let latest = null;
  let latestMtime = 0;
  for (const entry of fs.readdirSync(workspaceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cp = path.join(workspaceDir, entry.name, 'checkpoint.json');
    if (!fs.existsSync(cp)) continue;
    const mtime = fs.statSync(cp).mtimeMs;
    if (mtime > latestMtime) {
      latestMtime = mtime;
      latest = cp;
    }
  }
  return latest;
}

function main() {
  const input = readStdin();
  const root = findHarnessRoot(input && input.cwd);
  if (!root) exitOk();

  const workspaceDir = path.join(root, '.harness', 'workspace');
  const event = input && input.hook_event_name;
  let taskId = null;
  let contentOverride = null;

  if ((event === 'PreToolUse' || event === 'PostToolUse') && (input.tool_name === 'Write' || input.tool_name === 'Edit')) {
    const ti = input.tool_input;
    const filePath = typeof ti === 'string' ? ti : ti && ti.file_path;
    if (filePath && path.basename(filePath) === 'checkpoint.json') exitOk();
    taskId = taskIdFromPath(root, filePath);

    if (event === 'PreToolUse' && taskId) {
      // 只对"当前阶段产出物文件"做内容校验；写其他文件不干预
      const cp = readJson(path.join(workspaceDir, taskId, 'checkpoint.json'));
      const wfDef = cp && loadWorkflowDefinition(root, cp.workflow);
      const st = cp && wfDef && wfDef.stages[cp.current_stage];
      const output = cp && cp.stage_outputs ? cp.stage_outputs[cp.current_stage] : (st && st.output);
      const outputPath = output && path.join(workspaceDir, taskId, output);
      if (!outputPath || path.resolve(outputPath) !== path.resolve(filePath)) exitOk();

      if (input.tool_name === 'Write' && ti && typeof ti.content === 'string') {
        contentOverride = ti.content;
      } else if (input.tool_name === 'Edit' && ti) {
        const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        const os = typeof ti.old_string === 'string' ? ti.old_string : '';
        const ns = typeof ti.new_string === 'string' ? ti.new_string : '';
        contentOverride = os ? existing.split(os).join(ns) : existing;
      }
    }
  } else if (event === 'Stop') {
    const cp = latestCheckpoint(root);
    if (cp) taskId = path.basename(path.dirname(cp));
  }

  if (!taskId) exitOk();

  const taskDir = path.join(workspaceDir, taskId);
  const checkpoint = readJson(path.join(taskDir, 'checkpoint.json'));
  if (!checkpoint) exitOk();

  let wfDef = null;
  try {
    wfDef = loadWorkflowDefinition(root, checkpoint.workflow);
  } catch (e) {
    // 插件缺失时降级不阻塞写入（gate-check 是兜底，避免旧任务/未复制插件时卡死）
    process.stderr.write(`[harness gate] 工作流插件包加载失败：${e.message}（已降级，不阻塞写入）\n`);
  }

  // 解析 verify 命令集（require_verify 阶段用）；解析失败按门禁失败处理
  let verifyCommands = null;
  if (wfDef) {
    try {
      verifyCommands = resolveVerifyCommands(root, wfDef);
    } catch (e) {
      if (event !== 'Stop') {
        exitBlock(`[harness gate] verify 手段解析失败：${e.message}`);
      }
      exitOk();
    }
  }

  const stage = checkpoint.current_stage;
  const st = wfDef && wfDef.stages[stage];
  const output = (checkpoint.stage_outputs && checkpoint.stage_outputs[stage]) || (st && st.output);
  const failures = checkStage({ root, taskId, stage, wfDef, output, contentOverride, verifyCommands });

  // 强制编排（过渡期软提示）：Stop 时若任务非编排器驱动（checkpoint 无 executor: orchestrator），提醒改走编排器
  if (event === 'Stop' && checkpoint.executor !== 'orchestrator') {
    emitReminder(
      'Stop',
      '[harness] 此任务未走编排器（checkpoint 缺 executor: orchestrator）。编排器是任务驱动的目标路径（流程状态机在程序里），建议改用编排器；CLI 版仅限简单任务。见 docs/orchestrator-design.md「强制进编排层」。'
    );
  }

  if (failures.length > 0) {
    const detail = failures.map((f) => `- ${f}`).join('\n');
    if (event === 'Stop') {
      emitReminder(
        'Stop',
        `[harness gate] 收尾终检未通过（提醒，不阻塞）：\n${detail}\n建议补齐证据后再结束会话。`
      );
    } else {
      exitBlock(
        `[harness gate] 阶段「${checkpoint.current_stage}」校验未通过：\n${detail}\n` +
          '请重做该阶段的产出工作（补齐证据/区块后重新验证），而不是只修补报告文件。'
      );
    }
  }
  exitOk();
}

module.exports = {
  loadWorkflowDefinition,
  resolveVerifyCommands,
  listWorkflows,
  taskIdFromPath,
  latestCheckpoint,
  checkStage,        // 从 tools/stage-check.js 再导出（共享单一真相源）
  checkVerifyEvidence,
  readJson,
};

if (require.main === module) main();
