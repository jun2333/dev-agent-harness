const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { findVerifyConfig, readConfig, runVerification } = require('../tools/verify.js');

// 在临时目录建一个最小项目根，含 knowledge/verify.config.json
function makeTempProject(commands) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-verify-'));
  fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'knowledge', 'verify.config.json'),
    JSON.stringify({ schema_version: 'verify.config.v1', commands, timeout_ms: 10000 })
  );
  return root;
}

test('findVerifyConfig 向上查找项目根配置', () => {
  const root = makeTempProject(['node -e "process.exit(0)"']);
  const nested = path.join(root, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  const found = findVerifyConfig(nested);
  assert.ok(found);
  assert.strictEqual(found.rootDir, root);
  assert.ok(found.configPath.endsWith(path.join('knowledge', 'verify.config.json')));
});

test('readConfig 拒绝空 commands（格式错误）', () => {
  const root = makeTempProject(['echo ok']);
  const cfg = path.join(root, 'knowledge', 'verify.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ schema_version: 'verify.config.v1', commands: [] }));
  assert.throws(() => readConfig(cfg), /非空 commands/);
});

test('readConfig 解析合法配置', () => {
  const root = makeTempProject(['echo ok']);
  const cfg = readConfig(path.join(root, 'knowledge', 'verify.config.json'));
  assert.deepStrictEqual(cfg.commands, ['echo ok']);
});

test('runVerification 通过的命令返回 passed 并写入报告', () => {
  const root = makeTempProject(['node -e "process.exit(0)"']);
  const out = path.join(root, 'out');
  const report = path.join(root, 'verify', 'verification-result.json');
  const res = runVerification(
    { schema_version: 'verify.config.v1', commands: ['node -e "process.exit(0)"'], timeout_ms: 5000 },
    path.join(root, 'knowledge', 'verify.config.json'),
    root,
    out,
    report
  );
  assert.strictEqual(res.overall_status, 'passed');
  assert.strictEqual(res.commands[0].status, 'passed');
  assert.ok(res.config_source);
  assert.ok(fs.existsSync(report));
});

test('runVerification 失败命令返回 failed', () => {
  const root = makeTempProject(['node -e "process.exit(0)"']);
  const out = path.join(root, 'out');
  const report = path.join(root, 'verify', 'verification-result.json');
  const res = runVerification(
    { schema_version: 'verify.config.v1', commands: ['node -e "process.exit(1)"'], timeout_ms: 5000 },
    path.join(root, 'knowledge', 'verify.config.json'),
    root,
    out,
    report
  );
  assert.strictEqual(res.overall_status, 'failed');
  assert.strictEqual(res.commands[0].status, 'failed');
});

test('CLI 拒绝 --commands（他证原则，不给 LLM 自选命令的机会）', () => {
  const root = makeTempProject(['echo ok']);
  let stderr = '';
  let code = 0;
  try {
    execFileSync(
      process.execPath,
      [path.join(__dirname, '..', 'tools', 'verify.js'), 'run', '--commands=echo hi'],
      { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (e) {
    code = e.status;
    stderr = e.stderr.toString();
  }
  assert.strictEqual(code, 1);
  assert.match(stderr, /拒绝 --commands/);
});
