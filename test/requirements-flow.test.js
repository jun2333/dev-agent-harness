const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CORE = path.join(__dirname, '..', 'orchestrator', 'core.js');
const REQUIREMENTS_YAML = fs.readFileSync(
  path.join(__dirname, '..', 'workflows', 'requirements', 'workflow.yaml'), 'utf8'
);

/** 建临时 harness 项目，requirements 工作流放项目知识库 + 复制 check 脚本 */
function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reqflow-'));
  const harness = path.join(root, '.harness');
  fs.mkdirSync(path.join(harness, 'orchestrator'), { recursive: true });
  const workflowDir = path.join(root, 'knowledge', 'workflow', 'requirements');
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(path.join(workflowDir, 'workflow.yaml'), REQUIREMENTS_YAML);
  fs.cpSync(
    path.join(__dirname, '..', 'workflows', 'requirements', 'check'),
    path.join(workflowDir, 'check'),
    { recursive: true }
  );
  fs.writeFileSync(path.join(harness, 'orchestrator', 'config.json'), JSON.stringify({ subagent: 'bridge' }));
  return root;
}

function initTask(root, taskId) {
  const tdir = path.join(root, '.harness', 'workspace', taskId);
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, 'task.manifest.json'), JSON.stringify({
    workflow: 'requirements', task_id: taskId, task_desc: '构建登录功能需求', user_confirmed: true,
  }));
  fs.writeFileSync(path.join(tdir, 'task.md'), '# 初始想法：需要登录功能\n');
  execFileSync(process.execPath, [CORE, 'start', '--task-id', taskId], { cwd: root, encoding: 'utf8' });
}

function run(root, taskId, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [CORE, ...args, '--task-id', taskId], { cwd: root, encoding: 'utf8' });
    return { exit: 0, json: JSON.parse(stdout) };
  } catch (e) {
    let json = null;
    try { json = JSON.parse(e.stdout || ''); } catch { /* stdout 非 JSON */ }
    return { exit: e.status ?? 1, json };
  }
}

/** 完成一个阶段：写产物 + 落盘 stage-result.json */
function completeStage(root, taskId, stage, content, outputFile) {
  const tdir = path.join(root, '.harness', 'workspace', taskId);
  fs.writeFileSync(path.join(tdir, outputFile), content);
  fs.writeFileSync(path.join(tdir, 'stage-result.json'),
    JSON.stringify({ stage, output_file: outputFile, sections_ok: true, verify_evidence: null, notes: 'ok' }));
}

/** 推进一个 user_approval 阶段：advance 生成确认码 → approve --code → advance */
function advanceApproved(root, taskId, stage) {
  // 第一次 advance 触发 confirm_required 并生成一次性确认码
  const first = run(root, taskId, 'advance');
  assert.strictEqual(first.exit, 2);
  assert.ok(first.json.confirm_code, 'advance 应返回 confirm_code');
  const a = run(root, taskId, 'approve', '--stage', stage, '--code', first.json.confirm_code);
  assert.strictEqual(a.exit, 0);
  return run(root, taskId, 'advance');
}

const ELICITATION_TASK = `# 需求：登录功能（草稿）

## 背景与目标
- 背景：需要用户登录
- 目标：支持账号密码登录
- 成功指标：功能落地即完成

## 待确认问题
- [x] 登录用邮箱还是手机号？→ 邮箱
- [x] 需要注册功能吗？→ 不需要
`;

const DRAFTING_TASK = `# 需求：登录功能

## 背景与目标
- 背景：用户需要登录后才能使用系统
- 目标：支持邮箱密码登录
- 成功指标：功能落地即完成

## 范围
- 范围内：邮箱密码登录、会话保持、登出
- 范围外：注册、找回密码、第三方登录

## 功能需求
### FR-1 邮箱密码登录
- 描述：用户用邮箱和密码登录
- 用户故事：作为用户，我希望用邮箱密码登录，以便访问系统
- 验收要点：输入正确邮箱密码可登录；错误密码提示

### FR-2 会话保持
- 描述：登录后保持会话
- 用户故事：作为用户，我希望登录后保持会话，以便刷新不退出
- 验收要点：刷新页面仍保持登录

## 验收标准
- [ ] 正确邮箱密码登录成功跳转首页
- [ ] 错误密码显示提示且不登录
- [ ] 刷新页面会话保持

## 待确认问题
- 无（已全部拍板）
`;

// ---- 用例 A：完整流程 elicitation→drafting→review→reflecting→done ----

test('requirements 全流程：elicitation→drafting→review→done', () => {
  const root = makeTempProject();
  initTask(root, 't1');

  // elicitation（草稿 + 待确认问题已拍板）→ approve + advance → drafting
  completeStage(root, 't1', 'elicitation', ELICITATION_TASK, 'task.md');
  let r = run(root, 't1', 'validate');
  assert.strictEqual(r.exit, 0);
  r = advanceApproved(root, 't1', 'elicitation');
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.json.next_stage, 'drafting');

  // drafting（完整需求，gate none）→ advance → review
  completeStage(root, 't1', 'drafting', DRAFTING_TASK, 'task.md');
  r = run(root, 't1', 'advance');
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.json.next_stage, 'review');

  // review（定稿）→ approve + advance → reflecting
  completeStage(root, 't1', 'review', DRAFTING_TASK, 'task.md');
  r = advanceApproved(root, 't1', 'review');
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.json.next_stage, 'reflecting');

  // reflecting → advance → done + 简报
  completeStage(root, 't1', 'reflecting', '# 经验草稿\n\n无特殊经验\n', 'lessons-draft.md');
  r = run(root, 't1', 'advance');
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.json.done, true);
  assert.ok(r.json.review_brief);

  const brief = fs.readFileSync(path.join(root, '.harness', 'workspace', 't1', 'review-brief.md'), 'utf8');
  assert.ok(brief.includes('登录功能'));
});

// ---- 用例 B：review 阶段未 approve 不能推进（gate 强制 approve 标记） ----

test('requirements：review 未 approve → advance 停在阶段（confirm_required）', () => {
  const root = makeTempProject();
  initTask(root, 't1');

  completeStage(root, 't1', 'elicitation', ELICITATION_TASK, 'task.md');
  advanceApproved(root, 't1', 'elicitation');

  completeStage(root, 't1', 'drafting', DRAFTING_TASK, 'task.md');
  const d = run(root, 't1', 'advance');
  assert.strictEqual(d.exit, 0);
  assert.strictEqual(d.json.next_stage, 'review');

  // review 完成但未 approve → advance 应 exit 2 confirm_required（不能推进）
  completeStage(root, 't1', 'review', DRAFTING_TASK, 'task.md');
  const r = run(root, 't1', 'advance');
  assert.strictEqual(r.exit, 2);
  assert.strictEqual(r.json.confirm_required, true);
  // approve 后推进
  advanceApproved(root, 't1', 'review');
});
