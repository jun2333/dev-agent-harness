#!/usr/bin/env node

/**
 * core.js — 编排器状态机 CLI（start/next/validate/advance/approve/status）
 *
 * 全局约束（docs/orchestrator-design.md「全局约束」）：参数禁止 LLM 生成——
 *   start     读 task.manifest.json（启动会话落盘）
 *   next      无参数，读 checkpoint
 *   validate  读 checkpoint（stage）+ 读 stage-result.json（result）
 *   advance   读同一份 checkpoint + stage-result.json；approved 由 approve 命令落盘
 *   approve   记录人工批准到 checkpoint
 *   status    无参数，自动找最新活跃 checkpoint（未传 task-id 时）
 *
 * 退出码：0=成功 1=校验失败/错误 2=需要用户确认（CONFIRM_REQUIRED）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');
const { readJson } = require('../tools/stage-check.js');
const { loadWorkflowDefinition, resolveVerifyCommands } = require('../tools/workflow-lib.js');
const { validate } = require('./validate.js');
const { buildStageInstruction } = require('./prompt-builder.js');

const MAX_REWORK_DEFAULT = 2;

function findHarnessRoot(startDir) {
  let current = path.resolve(startDir || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, '.harness'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function taskDir(root, taskId) {
  return path.join(root, '.harness', 'workspace', taskId);
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function stageNames(wfDef) {
  return Object.keys(wfDef.stages);
}

/** 读编排器配置（orchestrator/config.json），缺失返回默认值 */
function loadConfig(root) {
  return readJson(path.join(root, '.harness', 'orchestrator', 'config.json')) || {};
}

/** 单阶段失败重做上限（默认 2，可配置） */
function maxRework(root) {
  const cfg = loadConfig(root);
  const n = Number(cfg.max_rework);
  return Number.isFinite(n) && n > 0 ? n : MAX_REWORK_DEFAULT;
}

/** 加载 checkpoint，缺失返回 null */
function loadCheckpoint(root, taskId) {
  return readJson(path.join(taskDir(root, taskId), 'checkpoint.json'));
}

// ---- 全局任务状态（post-tool-log 据此标注日志的 task_id） ----

const activeTaskFile = (root) => path.join(root, '.harness', 'workspace', '.active-task.json');

/** 标记当前活跃任务（start 时写；中断/恢复保留，任务完成才清除） */
function setActiveTask(root, taskId) {
  try {
    fs.writeFileSync(activeTaskFile(root),
      JSON.stringify({ task_id: taskId, started_at: new Date().toISOString(), status: 'active' }, null, 2));
  } catch { /* 状态文件失败不影响流程 */ }
}

/** 清除当前活跃任务（任务 done 时） */
function clearActiveTask(root) {
  try {
    fs.rmSync(activeTaskFile(root), { force: true });
  } catch { /* 忽略 */ }
}

// harness 工具目录（core.js 在 .harness/orchestrator/，工具在 .harness/tools/——用 __dirname 相对定位）
const HARNESS_TOOLS = path.join(__dirname, '..', 'tools');

/**
 * 程序化执行 workflow 的 pre_task 动作（不需要 hook，编排器直接跑命令）。
 * 支持映射：
 *   state-checkpoint init → 编排器已创建 checkpoint（跳过）
 *   env-check run        → node env-check.js run
 */
function execPreTask(root, taskId, wfDef) {
  for (const act of wfDef.pre_task || []) {
    const skill = act.skill || '';
    const action = act.action || '';
    try {
      if (skill.includes('state-checkpoint')) continue; // 编排器已创建 checkpoint
      if (skill.includes('env-check')) {
        execSync(`node ${path.join(HARNESS_TOOLS, 'env-check.js')} run --task-id ${taskId}`, { cwd: root, encoding: 'utf8' });
      } else {
        // 未映射的 pre_task 动作：跳过（编排器模式不接受自定义动作，避免任意执行）
      }
    } catch { /* 环境检查失败不阻塞启动（env-check 已输出原因）*/ }
  }
}

/**
 * 程序化执行阶段后动作（advance 推进时调用）。
 * 内置记账每阶段无条件执行（一致性，不依赖 workflow 声明）：
 *   - skill-log            编排器写 skill-logs/{stage}.md（格式对齐 skill-log.js）
 *   - state-checkpoint     由编排器 checkpoint 更新替代（不执行）
 * workflow 声明的 post_stage 作为文档性声明（可读），实际执行统一走内置记账。
 *
 * 注：context-snapshot（context-ledger）已移除（2026-08-20 用户要求）：
 * 使用 subagent 隔离后子代理上下文可控，主代理工具调用由 post-tool-log.js 记账，
 * 已读清单是重复劳动。
 */
function execPostStage(root, taskId, stageName, stage) {
  // 内置记账（无条件）
  writeSkillLog(root, taskId, stageName, stage);
  // 声明的 post_stage 动作已由内置记账覆盖（state-checkpoint/skill-log），
  // 未映射的自定义动作跳过（编排器模式不接受任意执行）
}

/** 写阶段 skill 执行日志（格式对齐 tools/skill-log.js，路径对齐 .harness/workspace/{id}/） */
function writeSkillLog(root, taskId, stageName, stage) {
  const logDir = path.join(taskDir(root, taskId), 'skill-logs');
  fs.mkdirSync(logDir, { recursive: true });
  const ts = new Date().toISOString();
  const inputs = Array.isArray(stage.input) ? stage.input.join(', ') : (stage.input || '');
  const content = `# ${stageName} 执行记录

## ${ts}
- **Skill**: ${stage.skill}
- **Task ID**: ${taskId}
- **Started At**: ${ts}
- **Completed At**: ${ts}
- **Input Files**: ${inputs}
- **Output File**: ${stage.output}
- **执行结果**: [x] 顺利
- **问题描述**: （编排器模式自动记录）
- **改进建议**: （未填）
`;
  fs.writeFileSync(path.join(logDir, `${stageName}.md`), content);
}

// ---------------------------------------------------------------- start

function cmdStart(root, taskId, code) {
  const tdir = taskDir(root, taskId);
  const manifest = readJson(path.join(tdir, 'task.manifest.json'));
  if (!manifest || !manifest.workflow) {
    console.error(`[orchestrator] 缺少 ${path.join('workspace', taskId, 'task.manifest.json')}：请先走启动会话（确认工作流 + task-id/task-desc 后落盘 manifest）`);
    process.exit(1);
  }

  // 提前建 checkpoint（幂等），用于存放 start 的一次性确认码
  let cp = loadCheckpoint(root, taskId);
  if (!cp) {
    let gitCommit = 'HEAD';
    try {
      gitCommit = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
    } catch { /* 非 git 项目 */ }
    cp = {
      task_id: taskId,
      workflow: manifest.workflow,
      task_desc: manifest.task_desc || '',
      current_stage: null,
      completed_stages: [],
      stage_outputs: {},
      approved_stages: [],
      rework_count: 0,
      started_at: new Date().toISOString(),
      git_commit_before_task: gitCommit,
      executor: 'orchestrator', // 强制标记：本任务由编排器驱动（gate-check 据此识别）
    };
    writeJson(path.join(tdir, 'checkpoint.json'), cp);
  }

  // 启动参数（task-id / task-desc）禁止自动生成：未确认则生成一次性确认码并拒绝（exit 2）
  if (!manifest.user_confirmed) {
    if (!cp.pending_confirm || cp.pending_confirm.stage !== 'start') {
      cp.pending_confirm = { code: generateConfirmCode(), stage: 'start', created_at: new Date().toISOString() };
      writeJson(path.join(tdir, 'checkpoint.json'), cp);
    }
    out({
      ok: false,
      confirm_required: true,
      confirm_code: cp.pending_confirm.code,
      task_id: taskId,
      message:
        `任务启动参数必须由用户提供，禁止 agent/脚本自动生成。当前 task-id=${taskId}、task-desc=「${manifest.task_desc || '(空)'}」未经用户确认。` +
        `请用 AskUserQuestion 让用户提供/确认 task-id 与 task-desc（用用户原文），` +
        `将 workspace/${taskId}/task.md 与 task.manifest.json 的 task_id/task_desc 更新为用户原文、user_confirmed 置为 true，` +
        `再执行 core.js start --task-id ${taskId} --code ${cp.pending_confirm.code}（确认码一次性）。`,
    });
    process.exit(2); // CONFIRM_REQUIRED
  }

  // 已确认：必须携带与 pending_confirm 匹配的一次性确认码（防 agent 跳过 AskUserQuestion 直接改 manifest）
  const pc = cp.pending_confirm;
  if (pc && pc.stage === 'start') {
    if (!code || pc.code !== code) {
      out({
        ok: false,
        confirm_required: true,
        confirm_code: pc.code,
        message:
          `确认码不匹配或缺失：start 需要 --code ${pc.code}（该确认码只能经 AskUserQuestion 用户确认后取得，` +
          `证明 task-id/task-desc 已由用户确认）。`,
      });
      process.exit(2);
    }
    cp.pending_confirm = null; // 一次性：使用后清除
    writeJson(path.join(tdir, 'checkpoint.json'), cp);
  }
  // 无 pending_confirm（历史任务）且 user_confirmed 已置位：兼容放行

  let wfDef;
  try {
    wfDef = loadWorkflowDefinition(root, manifest.workflow);
  } catch (e) {
    console.error(`[orchestrator] ${e.message}`);
    process.exit(1);
  }

  // 初始阶段 = 第一个非 optional 阶段
  const names = stageNames(wfDef);
  const first = names.find((n) => !wfDef.stages[n].optional) || names[0];
  if (!cp.current_stage) {
    cp.current_stage = first;
    writeJson(path.join(tdir, 'checkpoint.json'), cp);
  }

  // 程序化执行 pre_task（env-check 等，state-checkpoint init 已由编排器替代）
  execPreTask(root, taskId, wfDef);

  // 标记全局活跃任务（post-tool-log 据此把日志标注为当前任务）
  setActiveTask(root, taskId);

  out({ ok: true, task_id: taskId, workflow: manifest.workflow, current_stage: cp.current_stage, message: '任务已初始化' });
}

// ---------------------------------------------------------------- next

function buildInstruction(root, taskId, cp, wfDef) {
  const names = stageNames(wfDef);
  const idx = names.indexOf(cp.current_stage);
  const ins = buildStageInstruction({
    taskId, wfDef,
    stageName: cp.current_stage,
    stageNo: idx + 1,
    total: names.length,
  });
  ins.completed = cp.completed_stages;

  // 附加 adapter 生成的子代理 prompt / spawn 命令（默认 bridge）
  const config = readJson(path.join(root, '.harness', 'orchestrator', 'config.json')) || {};
  const adapterName = config.subagent === 'headless' ? 'headless' : 'bridge';
  const adapter = require(path.join(__dirname, 'adapters', `${adapterName}.js`));
  const ctx = { root, taskId, workflow: cp.workflow, headlessCli: config.headless_cli };
  if (adapterName === 'headless') {
    ins.spawn = adapter.buildSpawnCommand(ins, ctx);
  } else {
    ins.prompt_template = adapter.buildSubagentPrompt(ins, ctx);
  }
  return ins;
}

function cmdNext(root, taskId) {
  const cp = loadCheckpoint(root, taskId);
  if (!cp) { console.error(`[orchestrator] checkpoint 不存在：${taskId}（先 start）`); process.exit(1); }
  let wfDef;
  try {
    wfDef = loadWorkflowDefinition(root, cp.workflow);
  } catch (e) {
    console.error(`[orchestrator] ${e.message}`);
    process.exit(1);
  }
  out(buildInstruction(root, taskId, cp, wfDef));
}

// ---------------------------------------------------------------- validate

function cmdValidate(root, taskId) {
  const res = validate({ root, taskId });
  if (!res.ok) {
    out({ ok: false, failures: res.failures, stage: res.stage });
    process.exit(1);
  }
  out({ ok: true, stage: res.stage });
}

// ---------------------------------------------------------------- advance

function cmdAdvance(root, taskId) {
  const cp = loadCheckpoint(root, taskId);
  if (!cp) { console.error(`[orchestrator] checkpoint 不存在：${taskId}（先 start）`); process.exit(1); }
  let wfDef;
  try {
    wfDef = loadWorkflowDefinition(root, cp.workflow);
  } catch (e) {
    console.error(`[orchestrator] ${e.message}`);
    process.exit(1);
  }
  const names = stageNames(wfDef);
  const stageName = cp.current_stage;

  // 任务已完成：advance 幂等返回（避免 current_stage=null 时崩）
  if (!stageName) {
    clearActiveTask(root); // 任务已完成，清除全局活跃状态
    out({ ok: true, done: true, task_id: taskId, completed_stages: cp.completed_stages, message: '任务已完成' });
    return;
  }
  const stage = wfDef.stages[stageName];

  // 1. 交卷校验（不校验不推进）
  const res = validate({ root, taskId });
  if (!res.ok) {
    const limit = maxRework(root);
    // on_fail 回退：testing/reviewing 失败 → 回到 on_fail 阶段重做（有上限）
    if (stage.on_fail && names.includes(stage.on_fail) && cp.rework_count < limit) {
      cp.current_stage = stage.on_fail;
      cp.rework_count += 1;
      writeJson(path.join(taskDir(root, taskId), 'checkpoint.json'), cp);
      out({
        ok: false,
        rework: true,
        from: stageName,
        to: stage.on_fail,
        rework_left: limit - cp.rework_count,
        failures: res.failures,
      });
      process.exit(1);
    }
    // 重做次数耗尽：停等人工介入（不自动回退）
    if (stage.on_fail && cp.rework_count >= limit) {
      out({
        ok: false,
        rework_exhausted: true,
        stage: stageName,
        failures: res.failures,
        message: `阶段「${stageName}」重做次数已耗尽（上限 ${limit} 次），需人工介入：修正产出后重新 validate/advance，或调整 orchestrator/config.json 的 max_rework`,
      });
      process.exit(1);
    }
    out({ ok: false, stage: stageName, failures: res.failures });
    process.exit(1);
  }

  // 2. gate: user_approval 必须已 approve（approved_stages 含当前阶段）——必须携带一次性确认码
  if (stage.gate === 'user_approval') {
    const isApproved = cp.approved_stages.includes(stageName);
    if (!isApproved) {
      // 无待确认码则生成一个(与 run-stage 同源,保证 approve 有码可校验)
      if (!cp.pending_confirm || cp.pending_confirm.stage !== stageName) {
        cp.pending_confirm = { code: generateConfirmCode(), stage: stageName, created_at: new Date().toISOString() };
        writeJson(path.join(taskDir(root, taskId), 'checkpoint.json'), cp);
      }
      out({
        ok: true,
        confirm_required: true,
        confirm_code: cp.pending_confirm.code,
        stage: stageName,
        message: `阶段「${stageName}」产出已通过校验，需人工确认后才能进入下一阶段。请先执行 approve --task-id ${taskId} --stage ${stageName} --code <确认码>（确认码：${cp.pending_confirm.code}，经 AskUserQuestion 用户确认后落盘），再 advance。`,
      });
      process.exit(2);
    }
  }

  // 3. 推进
  cp.completed_stages = [...cp.completed_stages.filter((s) => s !== stageName), stageName];
  cp.stage_outputs[stageName] = stage.output;

  // 找下一个非 optional 阶段
  const idx = names.indexOf(stageName);
  let next = null;
  for (let i = idx + 1; i < names.length; i++) {
    if (!wfDef.stages[names[i]].optional) { next = names[i]; break; }
  }
  if (!next) {
    cp.current_stage = null;
    cp.completed_at = new Date().toISOString();
    writeJson(path.join(taskDir(root, taskId), 'checkpoint.json'), cp);

    // 执行最后阶段的 post_stage（skill-log，checkpoint complete 已由编排器替代）
    execPostStage(root, taskId, stageName, stage);

    // 任务完成：自动生成审核简报（通用最后流程，机械合成不编造）
    // review-brief.js 与 core.js 同在 .harness submodule 内，用 __dirname 相对定位
    let reviewBrief = null;
    const briefFile = `.harness/workspace/${taskId}/review-brief.md`;
    const reviewBriefJs = path.join(__dirname, '..', 'tools', 'review-brief.js');
    try {
      execSync(
        `node ${reviewBriefJs} --task-id ${taskId} --output ${briefFile}`,
        { cwd: root, encoding: 'utf8' }
      );
      reviewBrief = briefFile;
    } catch {
      reviewBrief = null; // 简报生成失败不影响任务完成
    }

    // 任务完成：清除全局活跃状态（post-tool-log 后续日志 task_id 恢复为 null）
    clearActiveTask(root);

    out({
      ok: true, done: true, task_id: taskId, completed_stages: cp.completed_stages,
      review_brief: reviewBrief,
      message: '任务完成。如需沉淀经验，可执行 reflecting collect 收集 lessons（人工审核后写入 knowledge/lessons/）',
    });
    return;
  }

  cp.current_stage = next;
  writeJson(path.join(taskDir(root, taskId), 'checkpoint.json'), cp);

  // 程序化执行当前阶段的 post_stage（skill-log，checkpoint save 已由编排器替代）
  execPostStage(root, taskId, stageName, stage);

  out({ ok: true, stage: stageName, next_stage: next, instruction: buildInstruction(root, taskId, cp, wfDef) });
}

// ---------------------------------------------------------------- run-stage

/** 从子代理 stdout 提取最后一个 JSON code block(容错:去围栏、容忍尾逗号) */
function extractJsonFromStdout(stdout) {
  if (!stdout) return null;
  // 优先取 ```json ... ``` 块
  const blocks = [...stdout.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1][1].trim() : null;
  const candidate = lastBlock || stdout.trim();
  try {
    // 容忍尾逗号
    return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
  } catch {
    return null;
  }
}

/** 生成一次性确认码(6 位大写字母数字) */
function generateConfirmCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

/**
 * run-stage — 程序化执行当前阶段(headless 形态:脚本直调子代理)
 *
 * 流程:生成 spawn 命令 → 登录态检查 → spawnSync 执行子代理 →
 *      解析 stdout JSON → 写入 stage-result.json → validate 校验。
 * user_approval 阶段 validate 通过后生成一次性确认码落盘并暂停(exit 2)。
 */
function cmdRunStage(root, taskId) {
  const cp = loadCheckpoint(root, taskId);
  if (!cp) { console.error(`[orchestrator] checkpoint 不存在：${taskId}（先 start）`); process.exit(1); }
  const stageName = cp.current_stage;
  if (!stageName) {
    clearActiveTask(root);
    out({ ok: true, done: true, task_id: taskId, message: '任务已完成，无需执行阶段' });
    return;
  }
  let wfDef;
  try {
    wfDef = loadWorkflowDefinition(root, cp.workflow);
  } catch (e) {
    console.error(`[orchestrator] ${e.message}`);
    process.exit(1);
  }
  const stage = wfDef.stages[stageName];
  if (!stage) {
    console.error(`[orchestrator] 工作流 ${cp.workflow} 无阶段 ${stageName}`);
    process.exit(1);
  }

  const ins = buildInstruction(root, taskId, cp, wfDef);
  if (!ins.spawn) {
    console.error('[orchestrator] 当前配置非 headless 形态（config.subagent != "headless"），run-stage 需要脚本直调子代理。请改 orchestrator/config.json');
    process.exit(1);
  }
  const config = readJson(path.join(root, '.harness', 'orchestrator', 'config.json')) || {};
  const headless = require(path.join(__dirname, 'adapters', 'headless.js'));
  const ctx = { root, taskId, workflow: cp.workflow, headlessCli: config.headless_cli };

  // 登录态检查:headless 无法交互重新登录
  if (!headless.checkAuth(ctx)) {
    console.error('[orchestrator] headless CLI 登录态失效：请先在交互会话登录后重试（headless 无法自动重新登录）');
    process.exit(1);
  }

  // 执行子代理(独立进程)
  const spawnCfg = ins.spawn;
  const timeoutMs = Number(config.stage_timeout_ms) || 600000;
  // 命令可能带前缀参数(如 "node .harness/test/mock-headless.js" 或 "codebuddy --debug"),
  // 拆分首词为可执行文件,其余并入 args
  const cmdTokens = String(spawnCfg.command).trim().split(/\s+/);
  const exe = cmdTokens.shift();
  const spawnArgs = [...cmdTokens, ...spawnCfg.args];
  const run = spawnSync(exe, spawnArgs, {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
  });

  // 执行日志(原始 stdout 留痕,失败排查用)
  const runLogDir = path.join(taskDir(root, taskId), 'stage-runs');
  fs.mkdirSync(runLogDir, { recursive: true });
  const runLogFile = path.join(runLogDir, `${stageName}-${Date.now()}.log`);
  fs.writeFileSync(runLogFile,
    `Command: ${spawnCfg.command} ${spawnCfg.args.join(' ')}\nExit: ${run.status}${run.error ? ' / ' + run.error.message : ''}\n\n--- STDOUT ---\n${run.stdout || ''}\n\n--- STDERR ---\n${run.stderr || ''}\n`);

  if (run.error || run.status !== 0) {
    console.error(`[orchestrator] 子代理执行失败（exit ${run.status}）：${(run.error && run.error.message) || '非零退出码'}。执行日志：${runLogFile}`);
    process.exit(1);
  }

  // 解析 stdout JSON 摘要 → 写入 stage-result.json
  const summary = extractJsonFromStdout(run.stdout || '');
  if (!summary) {
    console.error(`[orchestrator] 子代理 stdout 未输出可解析的 JSON 摘要（约定 JSON code block）。执行日志：${runLogFile}`);
    process.exit(1);
  }
  writeJson(path.join(taskDir(root, taskId), 'stage-result.json'), summary);

  // validate(机械校验,不采信子代理自报)
  const res = validate({ root, taskId });
  if (!res.ok) {
    out({ ok: false, stage: res.stage, failures: res.failures, run_log: runLogFile, message: '阶段产出未通过校验' });
    process.exit(1);
  }

  // user_approval:生成一次性确认码落盘,暂停等人工确认
  if (stage.gate === 'user_approval') {
    if (!cp.pending_confirm || cp.pending_confirm.stage !== stageName) {
      cp.pending_confirm = { code: generateConfirmCode(), stage: stageName, created_at: new Date().toISOString() };
      writeJson(path.join(taskDir(root, taskId), 'checkpoint.json'), cp);
    }
    out({
      ok: true,
      stage: stageName,
      confirm_required: true,
      confirm_code: cp.pending_confirm.code,
      run_log: runLogFile,
      message: `阶段「${stageName}」产出已通过校验，需人工确认。请向用户展示产出并获取确认码（${cp.pending_confirm.code}），然后执行 approve --task-id ${taskId} --stage ${stageName} --code <确认码>`,
    });
    process.exit(2); // CONFIRM_REQUIRED
  }

  out({ ok: true, stage: stageName, run_log: runLogFile, message: '阶段执行完成且校验通过。可执行 advance 推进（或继续下一阶段）' });
}

// ---------------------------------------------------------------- approve

function cmdApprove(root, taskId, stageName, code) {
  const cp = loadCheckpoint(root, taskId);
  if (!cp) { console.error(`[orchestrator] checkpoint 不存在：${taskId}`); process.exit(1); }
  if (cp.current_stage !== stageName) {
    console.error(`[orchestrator] 当前阶段 ${cp.current_stage}，不是 ${stageName}`);
    process.exit(1);
  }
  // 确认码强校验:必须匹配 pending_confirm(一次性),无码/错码拒绝
  const pc = cp.pending_confirm;
  if (!pc || pc.stage !== stageName || pc.code !== code || !code) {
    console.error(
      `[orchestrator] 确认码不匹配或缺失：approve 必须携带与当前阶段匹配的一次性确认码。` +
        `请先执行 run-stage（或 advance）获取确认码，再 approve --code <确认码>`
    );
    process.exit(1);
  }
  cp.approved_stages = [...cp.approved_stages.filter((s) => s !== stageName), stageName];
  cp.pending_confirm = null; // 一次性:使用后清除
  writeJson(path.join(taskDir(root, taskId), 'checkpoint.json'), cp);
  out({ ok: true, approved: stageName, message: `阶段「${stageName}」已确认，可 advance` });
}

// ---------------------------------------------------------------- status

function cmdStatus(root, taskId) {
  const cp = loadCheckpoint(root, taskId);
  if (!cp) { console.error(`[orchestrator] checkpoint 不存在：${taskId}`); process.exit(1); }
  out({
    task_id: cp.task_id,
    workflow: cp.workflow,
    current_stage: cp.current_stage,
    completed_stages: cp.completed_stages,
    approved_stages: cp.approved_stages,
    rework_count: cp.rework_count,
    started_at: cp.started_at,
    completed_at: cp.completed_at || null,
  });
}

// ---------------------------------------------------------------- CLI 入口

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const getArg = (name) => {
    const eq = args.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(`--${name}=`.length);
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] !== undefined ? args[idx + 1] : null;
  };

  const root = findHarnessRoot(process.cwd());
  if (!root) { console.error('[orchestrator] 未找到 .harness 目录（不是 harness 项目）'); process.exit(1); }

  switch (cmd) {
    case 'start': {
      const taskId = getArg('task-id');
      if (!taskId) { console.error('Usage: node core.js start --task-id <id> [--code <确认码>]'); process.exit(1); }
      cmdStart(root, taskId, getArg('code'));
      break;
    }
    case 'next': {
      const taskId = getArg('task-id');
      if (!taskId) { console.error('Usage: node core.js next --task-id <id>'); process.exit(1); }
      cmdNext(root, taskId);
      break;
    }
    case 'run-stage': {
      const taskId = getArg('task-id');
      if (!taskId) { console.error('Usage: node core.js run-stage --task-id <id>'); process.exit(1); }
      cmdRunStage(root, taskId);
      break;
    }
    case 'validate': {
      const taskId = getArg('task-id');
      if (!taskId) { console.error('Usage: node core.js validate --task-id <id>'); process.exit(1); }
      cmdValidate(root, taskId);
      break;
    }
    case 'advance': {
      const taskId = getArg('task-id');
      if (getArg('approved')) {
        console.warn('[orchestrator] --approved 已废弃：审批以 approve 命令落盘为准（user_approval 阶段必须先 approve 再 advance）');
      }
      if (!taskId) { console.error('Usage: node core.js advance --task-id <id>'); process.exit(1); }
      cmdAdvance(root, taskId);
      break;
    }
    case 'approve': {
      const taskId = getArg('task-id');
      const stageName = getArg('stage');
      const code = getArg('code');
      if (!taskId || !stageName) { console.error('Usage: node core.js approve --task-id <id> --stage <name> --code <code>'); process.exit(1); }
      cmdApprove(root, taskId, stageName, code);
      break;
    }
    case 'status': {
      const taskId = getArg('task-id') || findLatestTaskId(root);
      if (!taskId) { console.error('[orchestrator] 无活跃任务（未传 --task-id 且找不到 checkpoint）'); process.exit(1); }
      cmdStatus(root, taskId);
      break;
    }
    default:
      console.error('Usage: node core.js <start|next|run-stage|validate|advance|approve|status> [--task-id <id>] ...');
      process.exit(1);
  }
}

/** 找 workspace 下最新修改的 checkpoint 所属任务（status 省略 task-id 时用） */
function findLatestTaskId(root) {
  const ws = path.join(root, '.harness', 'workspace');
  if (!fs.existsSync(ws)) return null;
  let latest = null;
  let latestMtime = 0;
  for (const entry of fs.readdirSync(ws, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cp = path.join(ws, entry.name, 'checkpoint.json');
    if (!fs.existsSync(cp)) continue;
    const mtime = fs.statSync(cp).mtimeMs;
    if (mtime > latestMtime) { latestMtime = mtime; latest = entry.name; }
  }
  return latest;
}

if (require.main === module) main();

module.exports = {
  buildInstruction,
  findLatestTaskId,
  extractJsonFromStdout,
  generateConfirmCode,
};
