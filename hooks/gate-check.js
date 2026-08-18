#!/usr/bin/env node

/**
 * gate-check.js — 阶段门禁校验（exit 2 阻塞阶段推进）
 *
 * 注册：PostToolUse 匹配 Write|Edit（写产出物后立即校验）+ Stop（任务收尾终检）
 * 校验：
 *   1. 当前阶段产出物存在（checkpoint.json 的 current_stage 对应的 output 文件）
 *   2. 产出物包含该阶段必含区块（Summary / Decision Log / Anti-Cherry-Pick，按阶段）
 *   3. testing / reviewing 阶段必须存在 verify 证据（verification-result.json 且 passed），
 *      且证据命令必须与项目配置 knowledge/verify.config.json 对账（他证）：
 *      - 证据中不能有配置外的命令（禁止自选命令 = 禁止自证）
 *      - 配置中所有命令必须全量出现在证据中（禁止只跑部分）
 * 失败：PostToolUse 时 exit 2 + stderr 列出缺失项，CLI 拦截并反馈给 LLM 补齐；
 *       Stop 时只发提醒不阻塞（避免用户中途退出会话被卡住）
 * 容错：不在 harness 任务中（无 checkpoint）→ exit 0，不打扰普通开发；
 *       checkpoint.json 自身写入跳过校验（阶段切换时先写 checkpoint 再产出文件，顺序自由）
 */

const fs = require('fs');
const path = require('path');
const { readStdin, findHarnessRoot, emitReminder, exitBlock, exitOk } = require('./lib.js');

// 阶段 -> 产出物 + 必含区块（sections 内每个数组为「任一即可」）+ 是否要求 verify 证据
// 与 workflows/*.yaml 的 output 对应；与 dsh/stage-schema.json 保持同步
const STAGE_REQUIREMENTS = {
  designing: {
    output: 'design.md',
    sections: [['## Summary for downstream'], ['## Decision Log']],
    require_verify: false,
  },
  'task-planning': {
    output: 'task-plan.md',
    sections: [['## Summary for downstream'], ['## Decision Log']],
    require_verify: false,
  },
  implementing: {
    output: 'changes.md',
    sections: [['## Summary for downstream']],
    require_verify: false,
  },
  testing: {
    output: 'test-report.md',
    sections: [
      ['## Summary for downstream'],
      ['## 完整性声明', '## Anti-Cherry-Pick Declaration'],
    ],
    require_verify: true,
  },
  reviewing: {
    output: 'review-report.md',
    sections: [['## Summary for downstream'], ['## Anti-Cherry-Pick Declaration']],
    require_verify: true,
  },
  reflecting: {
    output: 'lessons-draft.md',
    sections: [],
    require_verify: false,
  },
};

// 项目验证配置（他证证据的唯一合法来源）
const VERIFY_CONFIG_REL = path.join('knowledge', 'verify.config.json');

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

function checkStage(root, taskDir, checkpoint) {
  const stage = checkpoint.current_stage;
  const req = STAGE_REQUIREMENTS[stage];
  const output = (checkpoint.stage_outputs && checkpoint.stage_outputs[stage]) || (req && req.output);
  if (!req || !output) return []; // 未知阶段（如 git-operations / 复盘），不做硬校验

  const failures = [];
  const outputPath = path.join(root, '.harness', 'workspace', taskDir, output);

  if (!fs.existsSync(outputPath)) {
    failures.push(`产出物缺失：${path.join('workspace', taskDir, output)}`);
    return failures;
  }

  const content = fs.readFileSync(outputPath, 'utf8');
  for (const group of req.sections) {
    if (!group.some(sec => content.includes(sec))) {
      failures.push(
        `产出物缺少必含区块（${path.join('workspace', taskDir, output)}）：${group.join(' 或 ')}`
      );
    }
  }

  // testing / reviewing 阶段必须有 verify 证据链（他证）
  if (req.require_verify) {
    failures.push(...checkVerifyEvidence(root, taskDir));
  }

  return failures;
}

/** verify 证据校验：报告存在 + passed + 命令与项目配置对账（他证） */
function checkVerifyEvidence(root, taskDir) {
  const failures = [];
  const verifyReport = path.join(root, '.harness', 'workspace', taskDir, 'verify', 'verification-result.json');
  const verifyData = readJson(verifyReport);
  if (!verifyData) {
    failures.push(
      `缺少 verify 证据：${path.join('workspace', taskDir, 'verify', 'verification-result.json')} 不存在。` +
        '测试必须通过 `node .harness/tools/verify.js run` 执行（命令来自项目配置 knowledge/verify.config.json），结果才会落盘为证据。'
    );
    return failures;
  }
  if (verifyData.overall_status !== 'passed') {
    failures.push(`verify 证据显示未通过：overall_status = ${verifyData.overall_status}`);
  }

  // 证据对账：报告命令必须来自项目配置，且全量执行
  const config = readJson(path.join(root, VERIFY_CONFIG_REL));
  if (!config || !Array.isArray(config.commands) || config.commands.length === 0) {
    failures.push(
      `缺少项目验证配置：${VERIFY_CONFIG_REL} 不存在或 commands 为空。` +
        '验证命令是项目拥有的，请先运行 knowledge-init 生成该配置，不允许 LLM 自选命令。'
    );
    return failures;
  }

  const configCommands = config.commands.map(String);
  const reportCommands = (verifyData.commands || [])
    .map(c => (typeof c === 'string' ? c : c && c.command))
    .filter(Boolean);

  const ran = new Set(reportCommands);
  const notRun = configCommands.filter(c => !ran.has(c));
  if (notRun.length > 0) {
    failures.push(
      `verify 证据未覆盖项目配置中的命令：${notRun.join(', ')}（配置命令必须全量执行，不允许只跑部分）`
    );
  }
  const extra = reportCommands.filter(c => !configCommands.includes(c));
  if (extra.length > 0) {
    failures.push(
      `verify 证据包含配置外的命令：${extra.join(', ')}（命令只能来自项目配置，如需新增请修改 ${VERIFY_CONFIG_REL}）`
    );
  }
  if (!verifyData.config_source) {
    failures.push(
      'verify 证据缺少 config_source 字段：请使用新版 `node .harness/tools/verify.js run`（命令来自项目配置）重新生成证据。'
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

  if (event === 'PostToolUse' && (input.tool_name === 'Write' || input.tool_name === 'Edit')) {
    // Write 的 tool_input 是 {file_path} 对象；部分 CLI 的 Edit 直接传路径字符串，两种都兼容
    const ti = input.tool_input;
    const filePath = typeof ti === 'string' ? ti : ti && ti.file_path;
    // checkpoint.json 自身写入跳过校验：阶段切换可以先行写 checkpoint，再产出该阶段文件
    if (filePath && path.basename(filePath) === 'checkpoint.json') exitOk();
    taskId = taskIdFromPath(root, filePath);
  } else if (event === 'Stop') {
    const cp = latestCheckpoint(root);
    if (cp) taskId = path.basename(path.dirname(cp));
  }

  if (!taskId) exitOk();

  const taskDir = path.join(workspaceDir, taskId);
  const checkpoint = readJson(path.join(taskDir, 'checkpoint.json'));
  if (!checkpoint) exitOk();

  const failures = checkStage(root, taskId, checkpoint);
  if (failures.length > 0) {
    const detail = failures.map(f => `- ${f}`).join('\n');
    if (event === 'Stop') {
      // Stop 只提醒不阻塞，避免用户中途退出会话被卡住
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

main();
