const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CORE = path.join(__dirname, '..', 'orchestrator', 'core.js');

const WORKFLOW_YAML = `name: feature
description: 测试工作流
stages:
  - name: designing
    skill: skills/domain-templates/designing.md
    input: task.md
    output: design.md
    sections:
      - [## Summary for downstream]
      - [## Decision Log]
    gate: user_approval
  - name: task-planning
    skill: skills/domain-templates/task-planning.md
    input: [task.md, design.md]
    output: task-plan.md
    sections:
      - [## Summary for downstream]
      - [## Decision Log]
`;

const BUGFIX_WORKFLOW_YAML = `name: bugfix
description: 带 on_fail 回退的测试工作流
stages:
  - name: implementing
    skill: skills/domain-templates/implementing.md
    input: task.md
    output: changes.md
    sections:
      - [## Summary for downstream]
  - name: testing
    skill: skills/domain-templates/testing.md
    input: [task.md, changes.md]
    output: test-report.md
    sections:
      - [## Summary for downstream]
      - [## 完整性声明]
    on_fail: implementing
`;

/** 建临时 harness 项目：.harness/workflows/{name}/ + orchestrator config */
function makeTempProject(workflowName = 'feature', workflowYaml = WORKFLOW_YAML, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-orch-'));
  const harness = path.join(root, '.harness');
  fs.mkdirSync(path.join(harness, 'orchestrator'), { recursive: true });
  // 工作流只读项目知识库 knowledge/workflow/{name}/（发现机制改造后不再从 .harness/workflows/ 兜底）
  const workflowDir = path.join(root, 'knowledge', 'workflow', workflowName);
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(path.join(workflowDir, 'workflow.yaml'), workflowYaml);
  fs.writeFileSync(path.join(harness, 'orchestrator', 'config.json'), JSON.stringify({ subagent: 'bridge', ...config }));
  return root;
}

/** 建任务目录 + manifest + 初始化 checkpoint */
function initTask(root, taskId) {
  const tdir = path.join(root, '.harness', 'workspace', taskId);
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, 'task.manifest.json'), JSON.stringify({
    workflow: 'feature', task_id: taskId, task_desc: '测试任务', user_confirmed: true,
  }));
  const out = execFileSync(process.execPath, [CORE, 'start', '--task-id', taskId], { cwd: root, encoding: 'utf8' });
  return JSON.parse(out);
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

// ---- start / next ----

test('start 读 manifest 创建 checkpoint，current_stage 为第一阶段', () => {
  const root = makeTempProject();
  const res = initTask(root, 't1');
  assert.strictEqual(res.ok, true);
  const cp = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'workspace', 't1', 'checkpoint.json'), 'utf8'));
  assert.strictEqual(cp.workflow, 'feature');
  assert.strictEqual(cp.current_stage, 'designing');
});

test('start 拒绝无 user_confirmed 的 manifest（启动会话强制，确认码机制）', () => {
  const root = makeTempProject();
  const tdir = path.join(root, '.harness', 'workspace', 't1');
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, 'task.manifest.json'),
    JSON.stringify({ workflow: 'feature', task_id: 't1', task_desc: '未确认' })); // 无 user_confirmed
  // 1. 未确认 → 生成一次性确认码并拒绝（exit 2）
  const r1 = run(root, 't1', 'start');
  assert.strictEqual(r1.exit, 2); // CONFIRM_REQUIRED
  assert.strictEqual(r1.json.ok, false);
  assert.strictEqual(r1.json.confirm_required, true);
  assert.ok(r1.json.confirm_code, '应生成一次性确认码');
  // 2. 已置 user_confirmed 但缺/错确认码 → 仍拒绝
  fs.writeFileSync(path.join(tdir, 'task.manifest.json'),
    JSON.stringify({ workflow: 'feature', task_id: 't1', task_desc: '已确认', user_confirmed: true }));
  const r2 = run(root, 't1', 'start');
  assert.strictEqual(r2.exit, 2);
  assert.ok(r2.json.confirm_code === r1.json.confirm_code, '确认码应保持不变直至消费');
  // 3. 带正确确认码 → 启动成功
  const r3 = run(root, 't1', 'start', '--code', r1.json.confirm_code);
  assert.strictEqual(r3.exit, 0);
  assert.strictEqual(r3.json.ok, true);
  assert.strictEqual(r3.json.current_stage, 'designing');
  // 4. 确认码一次性：消费后 pending_confirm 清除
  const cp = JSON.parse(fs.readFileSync(path.join(tdir, 'checkpoint.json'), 'utf8'));
  assert.strictEqual(cp.pending_confirm, null);
});

test('next 输出阶段指令（含 adapter 生成的 prompt_template）', () => {
  const root = makeTempProject();
  initTask(root, 't1');
  const r = run(root, 't1', 'next');
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.json.stage, 'designing');
  assert.strictEqual(r.json.stage_no, 1);
  assert.ok(r.json.prompt_template.includes('designing'));
  assert.ok(r.json.output_file === 'design.md');
});

// ---- validate 结构层 ----

test('validate 拒绝缺字段的 stage-result.json', () => {
  const root = makeTempProject();
  initTask(root, 't1');
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'stage-result.json'),
    JSON.stringify({ stage: 'designing', output_file: 'design.md' }));
  const r = run(root, 't1', 'validate');
  assert.strictEqual(r.exit, 1);
  assert.ok(r.json.failures.some((f) => /缺少字段/.test(f)));
});

test('validate 拒绝 stage 不匹配', () => {
  const root = makeTempProject();
  initTask(root, 't1');
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'stage-result.json'),
    JSON.stringify({ stage: 'wrong', output_file: 'design.md', sections_ok: true, verify_evidence: null, notes: null }));
  const r = run(root, 't1', 'validate');
  assert.strictEqual(r.exit, 1);
  assert.ok(r.json.failures.some((f) => /stage 不匹配/.test(f)));
});

// ---- validate 规则层 ----

test('validate 机械检查产出物缺必含区块（不采信 sections_ok）', () => {
  const root = makeTempProject();
  initTask(root, 't1');
  // 子代理谎报 sections_ok: true，但产出物缺区块
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'stage-result.json'),
    JSON.stringify({ stage: 'designing', output_file: 'design.md', sections_ok: true, verify_evidence: null, notes: null }));
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'design.md'), '# 设计\n（没有必含区块）');
  const r = run(root, 't1', 'validate');
  assert.strictEqual(r.exit, 1);
  assert.ok(r.json.failures.some((f) => /缺少必含区块/.test(f)));
});

test('validate 通过：产出物含必含区块 + stage-result 合法', () => {
  const root = makeTempProject();
  initTask(root, 't1');
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'stage-result.json'),
    JSON.stringify({ stage: 'designing', output_file: 'design.md', sections_ok: true, verify_evidence: null, notes: 'ok' }));
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'design.md'),
    '# 设计\n\n## Summary for downstream\n结论\n\n## Decision Log\nD-1\n');
  const r = run(root, 't1', 'validate');
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.json.ok, true);
});

// ---- advance / gate / approve ----

test('advance 无 approved 时停在 user_approval 阶段（exit 2 CONFIRM_REQUIRED）', () => {
  const root = makeTempProject();
  initTask(root, 't1');
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'stage-result.json'),
    JSON.stringify({ stage: 'designing', output_file: 'design.md', sections_ok: true, verify_evidence: null, notes: 'ok' }));
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'design.md'),
    '# 设计\n\n## Summary for downstream\n结论\n\n## Decision Log\nD-1\n');
  const r = run(root, 't1', 'advance');
  assert.strictEqual(r.exit, 2);
  assert.strictEqual(r.json.confirm_required, true);
});

test('approve + advance 推进到下一阶段（需先 advance 生成确认码）', () => {
  const root = makeTempProject();
  initTask(root, 't1');
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'stage-result.json'),
    JSON.stringify({ stage: 'designing', output_file: 'design.md', sections_ok: true, verify_evidence: null, notes: 'ok' }));
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'design.md'),
    '# 设计\n\n## Summary for downstream\n结论\n\n## Decision Log\nD-1\n');
  // 第一次 advance:触发 confirm_required,生成一次性确认码
  const first = run(root, 't1', 'advance');
  assert.strictEqual(first.exit, 2);
  assert.ok(first.json.confirm_code, 'advance 应返回 confirm_code');
  // 无码 approve 应拒绝
  const noCode = run(root, 't1', 'approve', '--stage', 'designing');
  assert.strictEqual(noCode.exit, 1);
  // 正确码 approve 通过
  const a = run(root, 't1', 'approve', '--stage', 'designing', '--code', first.json.confirm_code);
  assert.strictEqual(a.exit, 0);
  const adv = run(root, 't1', 'advance');
  assert.strictEqual(adv.exit, 0);
  assert.strictEqual(adv.json.next_stage, 'task-planning');
  const cp = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'workspace', 't1', 'checkpoint.json'), 'utf8'));
  assert.ok(cp.completed_stages.includes('designing'));
  assert.strictEqual(cp.current_stage, 'task-planning');
});

// ---- status ----

test('status 输出进度', () => {
  const root = makeTempProject();
  initTask(root, 't1');
  const r = run(root, 't1', 'status');
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.json.current_stage, 'designing');
  assert.deepStrictEqual(r.json.completed_stages, []);
});

// ---- on_fail 回退 + 重做上限 ----

/** 完成一个阶段：写产物 + 落盘 stage-result.json */
function completeStage(root, taskId, stage, content, outputFile) {
  const tdir = path.join(root, '.harness', 'workspace', taskId);
  fs.writeFileSync(path.join(tdir, outputFile), content);
  fs.writeFileSync(path.join(tdir, 'stage-result.json'),
    JSON.stringify({ stage, output_file: outputFile, sections_ok: true, verify_evidence: null, notes: 'ok' }));
}

test('on_fail 回退到指定阶段，重做上限从 config 读取并触发 rework_exhausted', () => {
  const root = makeTempProject('bugfix', BUGFIX_WORKFLOW_YAML, { max_rework: 2 });
  const tdir = path.join(root, '.harness', 'workspace', 't1');
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, 'task.manifest.json'),
    JSON.stringify({ workflow: 'bugfix', task_id: 't1', task_desc: 'bug', user_confirmed: true }));
  execFileSync(process.execPath, [CORE, 'start', '--task-id', 't1'], { cwd: root, encoding: 'utf8' });

  // implementing 完成 → advance → testing
  completeStage(root, 't1', 'implementing', '# changes\n\n## Summary for downstream\nx\n', 'changes.md');
  let r = run(root, 't1', 'advance');
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.json.next_stage, 'testing');

  // testing 失败（缺 ## 完整性声明）→ advance → 回退 implementing（第 1 次，剩 1）
  completeStage(root, 't1', 'testing', '# 报告\n\n## Summary for downstream\nx\n', 'test-report.md');
  r = run(root, 't1', 'advance');
  assert.strictEqual(r.exit, 1);
  assert.strictEqual(r.json.rework, true);
  assert.strictEqual(r.json.to, 'implementing');
  assert.strictEqual(r.json.rework_left, 1);

  // 第 2 轮：implementing 完成 → testing 又失败 → 回退（第 2 次，剩 0）
  completeStage(root, 't1', 'implementing', '# changes\n\n## Summary for downstream\nx\n', 'changes.md');
  r = run(root, 't1', 'advance');
  assert.strictEqual(r.json.next_stage, 'testing');
  completeStage(root, 't1', 'testing', '# 报告\n\n## Summary for downstream\nx\n', 'test-report.md');
  r = run(root, 't1', 'advance');
  assert.strictEqual(r.exit, 1);
  assert.strictEqual(r.json.rework, true);
  assert.strictEqual(r.json.rework_left, 0);

  // 第 3 轮：implementing 完成 → testing 又失败 → 重做耗尽，停等人工
  completeStage(root, 't1', 'implementing', '# changes\n\n## Summary for downstream\nx\n', 'changes.md');
  r = run(root, 't1', 'advance');
  assert.strictEqual(r.json.next_stage, 'testing');
  completeStage(root, 't1', 'testing', '# 报告\n\n## Summary for downstream\nx\n', 'test-report.md');
  r = run(root, 't1', 'advance');
  assert.strictEqual(r.exit, 1);
  assert.strictEqual(r.json.rework_exhausted, true);
  assert.ok(r.json.message.includes('max_rework'));
});

// ---- 任务完成：自动生成审核简报（通用最后流程） ----

test('advance 程序化执行 post_stage（skill-log）', () => {
  const root = makeTempProject();
  initTask(root, 't1');
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'stage-result.json'),
    JSON.stringify({ stage: 'designing', output_file: 'design.md', sections_ok: true, verify_evidence: null, notes: 'ok' }));
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 't1', 'design.md'),
    '# 设计\n\n## Summary for downstream\n结论\n\n## Decision Log\nD-1\n');
  const first = run(root, 't1', 'advance');
  assert.strictEqual(first.exit, 2);
  const a = run(root, 't1', 'approve', '--stage', 'designing', '--code', first.json.confirm_code);
  assert.strictEqual(a.exit, 0);
  const adv = run(root, 't1', 'advance');
  assert.strictEqual(adv.exit, 0);
  assert.strictEqual(adv.json.next_stage, 'task-planning');

  // post_stage 程序化执行产物（context-ledger 已移除：subagent 隔离后上下文可控，主代理调用由 post-tool-log 记账）
  const tdir = path.join(root, '.harness', 'workspace', 't1');
  assert.ok(fs.existsSync(path.join(tdir, 'skill-logs', 'designing.md')), 'skill-log 应生成');
  assert.ok(!fs.existsSync(path.join(tdir, 'context-ledger.md')), 'context-ledger 不应生成');
  const log = fs.readFileSync(path.join(tdir, 'skill-logs', 'designing.md'), 'utf8');
  assert.ok(log.includes('designing'));
});

test('任务完成后自动生成审核简报（manifest.task_desc 兜底标题）', () => {
  const root = makeTempProject('bugfix', BUGFIX_WORKFLOW_YAML);
  const tdir = path.join(root, '.harness', 'workspace', 't1');
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, 'task.manifest.json'),
    JSON.stringify({ workflow: 'bugfix', task_id: 't1', task_desc: '修复登录 bug', user_confirmed: true }));
  execFileSync(process.execPath, [CORE, 'start', '--task-id', 't1'], { cwd: root, encoding: 'utf8' });

  // implementing 完成 → advance → testing
  completeStage(root, 't1', 'implementing', '# changes\n\n## Summary for downstream\n修复了登录校验\n', 'changes.md');
  let r = run(root, 't1', 'advance');
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.json.next_stage, 'testing');

  // testing 完成（含完整性声明）→ advance → done + 简报
  completeStage(root, 't1', 'testing',
    '# 报告\n\n## Summary for downstream\n测试全部通过\n\n## 完整性声明\n已运行全部用例\n', 'test-report.md');
  r = run(root, 't1', 'advance');
  assert.strictEqual(r.exit, 0);
  assert.strictEqual(r.json.done, true);
  assert.ok(r.json.review_brief);

  const briefPath = path.join(root, '.harness', 'workspace', 't1', 'review-brief.md');
  assert.ok(fs.existsSync(briefPath));
  const brief = fs.readFileSync(briefPath, 'utf8');
  assert.ok(brief.includes('审核简报'));
  assert.ok(brief.includes('修复登录 bug')); // 无 task.md，用 manifest.task_desc 兜底
  assert.ok(brief.includes('implementing')); // 阶段产物摘要来自 checkpoint.stage_outputs
  assert.ok(brief.includes('testing'));
});
