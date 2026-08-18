const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  STAGE_REQUIREMENTS,
  taskIdFromPath,
  checkVerifyEvidence,
} = require('../hooks/gate-check.js');

// 建最小项目根：含 knowledge/verify.config.json 与 workspace/{task}/verify 证据
function makeTempProject(configCommands, report) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gate-'));
  fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'knowledge', 'verify.config.json'),
    JSON.stringify({ schema_version: 'verify.config.v1', commands: configCommands })
  );
  const taskDir = path.join(root, '.harness', 'workspace', 't1');
  fs.mkdirSync(path.join(taskDir, 'verify'), { recursive: true });
  if (report !== undefined) {
    fs.writeFileSync(path.join(taskDir, 'verify', 'verification-result.json'), JSON.stringify(report));
  }
  return root;
}

test('STAGE_REQUIREMENTS：testing/reviewing 要求 verify 证据，designing 不要求', () => {
  assert.strictEqual(STAGE_REQUIREMENTS.testing.require_verify, true);
  assert.strictEqual(STAGE_REQUIREMENTS.reviewing.require_verify, true);
  assert.strictEqual(STAGE_REQUIREMENTS.designing.require_verify, false);
});

test('STAGE_REQUIREMENTS：designing 必含 Summary，testing 必含 Anti-Cherry-Pick', () => {
  assert.deepStrictEqual(STAGE_REQUIREMENTS.designing.sections[0], ['## Summary for downstream']);
  assert.ok(
    STAGE_REQUIREMENTS.testing.sections.some((g) => g.includes('## Anti-Cherry-Pick Declaration'))
  );
});

test('taskIdFromPath 解析 .harness/workspace/{task-id}/file', () => {
  assert.strictEqual(taskIdFromPath('/proj', '/proj/.harness/workspace/task-001/design.md'), 'task-001');
  assert.strictEqual(taskIdFromPath('/proj', '/proj/workspace/task-002/changes.md'), 'task-002');
  assert.strictEqual(taskIdFromPath('/proj', '/proj/src/foo.js'), null);
});

test('checkVerifyEvidence 通过：报告命令覆盖配置且 passed', () => {
  const root = makeTempProject(['npm test'], {
    overall_status: 'passed',
    config_source: 'knowledge/verify.config.json',
    commands: [{ command: 'npm test', status: 'passed' }],
  });
  assert.deepStrictEqual(checkVerifyEvidence(root, 't1'), []);
});

test('checkVerifyEvidence 缺证据：未生成 verification-result.json', () => {
  const root = makeTempProject(['npm test']); // 不写 report
  const failures = checkVerifyEvidence(root, 't1');
  assert.ok(failures.some((f) => /缺少 verify 证据/.test(f)));
});

test('checkVerifyEvidence 命令未全量执行（配置外命令未覆盖）', () => {
  const root = makeTempProject(['npm test', 'npm run build'], {
    overall_status: 'passed',
    config_source: 'knowledge/verify.config.json',
    commands: [{ command: 'npm test', status: 'passed' }],
  });
  const failures = checkVerifyEvidence(root, 't1');
  assert.ok(failures.some((f) => /未覆盖项目配置中的命令/.test(f))); // npm run build 没跑
});

test('checkVerifyEvidence 含配置外命令（自证漏洞，必须拦下）', () => {
  const root = makeTempProject(['npm test'], {
    overall_status: 'passed',
    config_source: 'knowledge/verify.config.json',
    commands: [
      { command: 'npm test', status: 'passed' },
      { command: 'echo hi', status: 'passed' },
    ],
  });
  const failures = checkVerifyEvidence(root, 't1');
  assert.ok(failures.some((f) => /配置外的命令/.test(f)));
});

test('checkVerifyEvidence 未 passed 直接失败', () => {
  const root = makeTempProject(['npm test'], {
    overall_status: 'failed',
    config_source: 'knowledge/verify.config.json',
    commands: [{ command: 'npm test', status: 'failed' }],
  });
  const failures = checkVerifyEvidence(root, 't1');
  assert.ok(failures.some((f) => /未通过/.test(f)));
});
