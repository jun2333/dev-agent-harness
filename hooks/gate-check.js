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
const { loadWorkflowDefinition, resolveVerifyCommands } = require('../tools/workflow-lib.js');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

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

function checkStage(root, taskDir, checkpoint, wfDef, contentOverride, verifyCommands) {
  const stage = checkpoint.current_stage;
  const st = wfDef && wfDef.stages[stage];
  const output = (checkpoint.stage_outputs && checkpoint.stage_outputs[stage]) || (st && st.output);
  // 未知阶段 / 无插件包定义 / 未声明 sections → 不做硬校验（兼容旧任务与 optional 阶段）
  if (!st || !Array.isArray(st.sections)) return [];

  const failures = [];
  const outputPath = path.join(root, '.harness', 'workspace', taskDir, output);

  // contentOverride：PreToolUse 时由 tool_input 提供的待写入内容（文件尚未落盘）
  let content = contentOverride;
  if (content === null || content === undefined) {
    if (!fs.existsSync(outputPath)) {
      failures.push(`产出物缺失：${path.join('workspace', taskDir, output)}`);
      return failures;
    }
    content = fs.readFileSync(outputPath, 'utf8');
  }

  for (const group of st.sections) {
    if (!Array.isArray(group) || group.length === 0) continue;
    if (!group.some((sec) => content.includes(sec))) {
      failures.push(
        `产出物缺少必含区块（${path.join('workspace', taskDir, output)}）：${group.join(' 或 ')}`
      );
    }
  }

  // require_verify 阶段必须有 verify 证据链（他证）
  if (st.require_verify) {
    failures.push(...checkVerifyEvidence(root, taskDir, verifyCommands));
  }

  return failures;
}

/** verify 证据校验：报告存在 + passed + 命令与工作流 verify 解析命令集对账（他证） */
function checkVerifyEvidence(root, taskDir, verifyCommands) {
  const failures = [];
  const verifyReport = path.join(root, '.harness', 'workspace', taskDir, 'verify', 'verification-result.json');
  const verifyData = readJson(verifyReport);
  if (!verifyData) {
    failures.push(
      `缺少 verify 证据：${path.join('workspace', taskDir, 'verify', 'verification-result.json')} 不存在。` +
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

  const wfDef = loadWorkflowDefinition(root, checkpoint.workflow);
  if (!wfDef && checkpoint.workflow) {
    process.stderr.write(
      `[harness gate] 未找到工作流插件包定义：.harness/workflows/${checkpoint.workflow}/workflow.yaml（已降级，不阻塞）\n`
    );
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

  const failures = checkStage(root, taskId, checkpoint, wfDef, contentOverride, verifyCommands);
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
  taskIdFromPath,
  latestCheckpoint,
  checkStage,
  checkVerifyEvidence,
};

if (require.main === module) main();
