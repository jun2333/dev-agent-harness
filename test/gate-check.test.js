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

test('loadWorkflowDefinition：不存在的插件包返回 null', () => {
  assert.strictEqual(loadWorkflowDefinition(REPO_ROOT, 'not-exist'), null);
});

test('resolveVerifyCommands：命令池 key 解析（unit → 具体命令）', () => {
  const root = makeTempProject({ unit: 'npm test', lint: 'npm run lint' });
  const wfDef = { verify: { checks: ['unit', 'lint'] } };
  assert.deepStrictEqual(resolveVerifyCommands(root, wfDef), ['npm test', 'npm run lint']);
});

test('resolveVerifyCommands：skill-check 解析为内置脚本（无需项目命令池）', () => {
  const root = makeTempProject({});
  const wfDef = { verify: { checks: ['skill-check'] } };
  const cmds = resolveVerifyCommands(root, wfDef);
  assert.strictEqual(cmds.length, 1);
  assert.ok(cmds[0].includes('skill-check.js'));
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
  assert.deepStrictEqual(checkVerifyEvidence(root, 't1', ['npm test']), []);
});

test('checkVerifyEvidence 缺证据：未生成 verification-result.json', () => {
  const root = makeTempProject({ unit: 'npm test' }); // 不写 report
  const failures = checkVerifyEvidence(root, 't1', ['npm test']);
  assert.ok(failures.some((f) => /缺少 verify 证据/.test(f)));
});

test('checkVerifyEvidence 命令未全量执行（工作流声明命令未覆盖）', () => {
  const root = makeTempProject({ unit: 'npm test', lint: 'npm run lint' }, {
    overall_status: 'passed',
    config_source: 'knowledge/verify.config.json',
    commands: [{ command: 'npm test', status: 'passed' }],
  });
  const failures = checkVerifyEvidence(root, 't1', ['npm test', 'npm run lint']);
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
  const failures = checkVerifyEvidence(root, 't1', ['npm test']);
  assert.ok(failures.some((f) => /工作流声明外的命令/.test(f)));
});

test('checkVerifyEvidence 未 passed 直接失败', () => {
  const root = makeTempProject({ unit: 'npm test' }, {
    overall_status: 'failed',
    config_source: 'knowledge/verify.config.json',
    commands: [{ command: 'npm test', status: 'failed' }],
  });
  const failures = checkVerifyEvidence(root, 't1', ['npm test']);
  assert.ok(failures.some((f) => /未通过/.test(f)));
});
