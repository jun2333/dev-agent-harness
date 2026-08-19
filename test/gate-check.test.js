const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadWorkflowDefinition,
  resolveVerifyCommands,
  taskIdFromPath,
  checkVerifyEvidence,
} = require('../hooks/gate-check.js');

// 仓库根（含 .harness/workflows/feature/workflow.yaml）
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// 建最小项目根：含 knowledge/verify.config.json（v2 命令池）与 workspace/{task}/verify 证据
function makeTempProject(pool, report, taskId = 't1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gate-'));
  fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'knowledge', 'verify.config.json'),
    JSON.stringify({ schema_version: 'verify.config.v2', commands: pool })
  );
  const taskDir = path.join(root, '.harness', 'workspace', taskId);
  fs.mkdirSync(path.join(taskDir, 'verify'), { recursive: true });
  if (report !== undefined) {
    fs.writeFileSync(path.join(taskDir, 'verify', 'verification-result.json'), JSON.stringify(report));
  }
  return root;
}

test('loadWorkflowDefinition：feature 插件包 designing 必含 Summary、testing 要求 verify', () => {
  const def = loadWorkflowDefinition(REPO_ROOT, 'feature');
  assert.ok(def, '应能加载 feature 插件包');
  assert.deepStrictEqual(def.stages.designing.sections[0], ['## Summary for downstream']);
  assert.strictEqual(def.stages.designing.require_verify, false);
  assert.strictEqual(def.stages.testing.require_verify, true);
  assert.ok(
    def.stages.testing.sections.some((g) => g.includes('## Anti-Cherry-Pick Declaration'))
  );
  assert.deepStrictEqual(def.verify.checks, ['unit', 'lint']);
});

test('loadWorkflowDefinition：skill-creation 插件包 verify 用 skill-check（不依赖项目命令）', () => {
  const def = loadWorkflowDefinition(REPO_ROOT, 'skill-creation');
  assert.ok(def);
  assert.deepStrictEqual(def.verify.checks, ['skill-check']);
  assert.strictEqual(def.stages.testing.require_verify, true);
});

test('loadWorkflowDefinition：不存在的插件包抛错', () => {
  assert.throws(() => loadWorkflowDefinition(REPO_ROOT, 'not-exist'), /未找到工作流插件/);
});

test('resolveVerifyCommands：命令池 key 解析（unit → 具体命令）', () => {
  const root = makeTempProject({ unit: 'npm test', lint: 'npm run lint' });
  const wfDef = { verify: { checks: ['unit', 'lint'] } };
  assert.deepStrictEqual(resolveVerifyCommands(root, wfDef), ['npm test', 'npm run lint']);
});

test('resolveVerifyCommands：插件包 check/ 脚本解析（无需项目命令池）', () => {
  const root = makeTempProject({});
  // 插件 check/ 脚本放在项目知识库 knowledge/plugins/{workflow}/check/（唯一来源）
  const checkDir = path.join(root, 'knowledge', 'plugins', 'demo-flow', 'check');
  fs.mkdirSync(checkDir, { recursive: true });
  fs.writeFileSync(path.join(checkDir, 'demo-check.js'), 'console.log("ok");');
  const wfDef = { name: 'demo-flow', verify: { checks: ['demo-check'] } };
  const cmds = resolveVerifyCommands(root, wfDef);
  assert.strictEqual(cmds.length, 1);
  assert.ok(cmds[0].includes('demo-check.js'));
});

test('resolveVerifyCommands：checks 为空返回 null（无 verify 命令要求）', () => {
  const root = makeTempProject({});
  assert.strictEqual(resolveVerifyCommands(root, { verify: { checks: [] } }), null);
});

test('resolveVerifyCommands：未定义的手段抛错（他证：不能自选命令）', () => {
  const root = makeTempProject({ unit: 'npm test' });
  const wfDef = { verify: { checks: ['unit', 'self-defined-cmd'] } };
  assert.throws(() => resolveVerifyCommands(root, wfDef), /无法解析/);
});

test('taskIdFromPath 解析 .harness/workspace/{task-id}/file', () => {
  assert.strictEqual(taskIdFromPath('/proj', '/proj/.harness/workspace/task-001/design.md'), 'task-001');
  assert.strictEqual(taskIdFromPath('/proj', '/proj/workspace/task-002/changes.md'), 'task-002');
  assert.strictEqual(taskIdFromPath('/proj', '/proj/src/foo.js'), null);
});

test('checkVerifyEvidence 通过：报告命令覆盖工作流声明且 passed', () => {
  const root = makeTempProject({ unit: 'npm test' }, {
    overall_status: 'passed',
    config_source: 'knowledge/verify.config.json',
    commands: [{ command: 'npm test', status: 'passed' }],
  });
  assert.deepStrictEqual(checkVerifyEvidence({ root, taskId: 't1', verifyCommands: ['npm test'] }), []);
});

test('checkVerifyEvidence 缺证据：未生成 verification-result.json', () => {
  const root = makeTempProject({ unit: 'npm test' }); // 不写 report
  const failures = checkVerifyEvidence({ root, taskId: 't1', verifyCommands: ['npm test'] });
  assert.ok(failures.some((f) => /缺少 verify 证据/.test(f)));
});

test('checkVerifyEvidence 命令未全量执行（工作流声明命令未覆盖）', () => {
  const root = makeTempProject({ unit: 'npm test', lint: 'npm run lint' }, {
    overall_status: 'passed',
    config_source: 'knowledge/verify.config.json',
    commands: [{ command: 'npm test', status: 'passed' }],
  });
  const failures = checkVerifyEvidence({ root, taskId: 't1', verifyCommands: ['npm test', 'npm run lint'] });
  assert.ok(failures.some((f) => /未覆盖工作流声明的命令/.test(f))); // npm run lint 没跑
});

test('checkVerifyEvidence 含声明外命令（自证漏洞，必须拦下）', () => {
  const root = makeTempProject({ unit: 'npm test' }, {
    overall_status: 'passed',
    config_source: 'knowledge/verify.config.json',
    commands: [
      { command: 'npm test', status: 'passed' },
      { command: 'echo hi', status: 'passed' },
    ],
  });
  const failures = checkVerifyEvidence({ root, taskId: 't1', verifyCommands: ['npm test'] });
  assert.ok(failures.some((f) => /工作流声明外的命令/.test(f)));
});

test('checkVerifyEvidence 未 passed 直接失败', () => {
  const root = makeTempProject({ unit: 'npm test' }, {
    overall_status: 'failed',
    config_source: 'knowledge/verify.config.json',
    commands: [{ command: 'npm test', status: 'failed' }],
  });
  const failures = checkVerifyEvidence({ root, taskId: 't1', verifyCommands: ['npm test'] });
  assert.ok(failures.some((f) => /未通过/.test(f)));
});

// ---------- 项目层插件机制（第二批） ----------

const { listWorkflows } = require('../hooks/gate-check.js');

/** 建含通用层 + 项目层工作流的临时项目根 */
// 建只有项目层插件的临时项目（knowledge/plugins/，唯一插件来源）
function makeProjectWithPlugins(...names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plug-'));
  for (const name of names) {
    const projDir = path.join(root, 'knowledge/plugins', name);
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(
      path.join(projDir, 'workflow.yaml'),
      `name: ${name}\ndescription: 项目插件\nverify:\n  checks: [unit, coverage]\nstages:\n  - name: implementing\n    skill: knowledge/skills/implementing/SKILL.md\n    output: changes.md\n    sections:\n      - [## Summary for downstream]\n      - [## Project Marker]\n`
    );
  }
  return root;
}

test('loadWorkflowDefinition：项目层插件加载（source=project）', () => {
  const root = makeProjectWithPlugins('feature');
  const def = loadWorkflowDefinition(root, 'feature');
  assert.ok(def);
  assert.strictEqual(def.source, 'project');
  assert.deepStrictEqual(def.verify.checks, ['unit', 'coverage']);
});

test('loadWorkflowDefinition：无项目插件时抛错（边界检查，不再回退通用模板）', () => {
  const root = makeProjectWithPlugins('other');
  assert.throws(() => loadWorkflowDefinition(root, 'feature'), /未找到工作流插件/);
});

test('loadWorkflowDefinition：项目独有工作流只在项目层解析，缺失抛错', () => {
  const root = makeProjectWithPlugins('release-flow');
  const def = loadWorkflowDefinition(root, 'release-flow');
  assert.ok(def);
  assert.strictEqual(def.source, 'project');
  assert.throws(() => loadWorkflowDefinition(root, 'nope'), /未找到工作流插件/);
});

test('loadWorkflowDefinition：knowledge/plugins 目录缺失时抛错（边界检查）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plug-'));
  assert.throws(() => loadWorkflowDefinition(root, 'feature'), /未找到项目插件目录/);
});

test('listWorkflows：只列项目层插件', () => {
  const root = makeProjectWithPlugins('feature', 'bugfix');
  const workflows = listWorkflows(root);
  const names = workflows.map((w) => w.name);
  assert.ok(names.includes('feature'));
  assert.ok(names.includes('bugfix'));
  for (const w of workflows) {
    assert.strictEqual(w.source, 'project'); // 全部来自项目知识库
  }
});
