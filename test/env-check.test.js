const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findEnvCheckConfig, readConfig, runEnvChecks, toMarkdown } = require('../tools/env-check.js');

// 在临时目录建一个最小项目根，含 knowledge/env-check.config.json
function makeTempProject(checks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-envcheck-'));
  fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'knowledge', 'env-check.config.json'),
    JSON.stringify({ schema_version: 'env-check.v1', checks, timeout_ms: 10000 })
  );
  return root;
}

test('findEnvCheckConfig 向上查找项目根配置', () => {
  const root = makeTempProject([{ name: 'ok', command: 'node -e "process.exit(0)"' }]);
  const nested = path.join(root, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  const found = findEnvCheckConfig(nested);
  assert.ok(found);
  assert.strictEqual(found.rootDir, root);
  assert.ok(found.configPath.endsWith(path.join('knowledge', 'env-check.config.json')));
});

test('readConfig 拒绝空 checks（格式错误）', () => {
  const root = makeTempProject([{ name: 'ok', command: 'node -e "process.exit(0)"' }]);
  const cfg = path.join(root, 'knowledge', 'env-check.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ schema_version: 'env-check.v1', checks: [] }));
  assert.throws(() => readConfig(cfg), /非空 checks/);
});

test('readConfig 解析合法配置并归一化 checks', () => {
  const root = makeTempProject([
    { name: 'node-version', command: 'node -v' },
    'test -f .env',
  ]);
  const config = readConfig(path.join(root, 'knowledge', 'env-check.config.json'));
  assert.strictEqual(config.checks.length, 2);
  assert.strictEqual(config.checks[0].name, 'node-version');
  assert.strictEqual(config.checks[0].command, 'node -v');
  // 字符串命令自动生成 name
  assert.ok(config.checks[1].name);
  assert.strictEqual(config.checks[1].command, 'test -f .env');
});

test('readConfig 拒绝缺 command 的 check 项', () => {
  const root = makeTempProject([{ name: 'bad' }]);
  const cfg = path.join(root, 'knowledge', 'env-check.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ schema_version: 'env-check.v1', checks: [{ name: 'bad' }] }));
  assert.throws(() => readConfig(cfg), /command/);
});

test('runEnvChecks 全部通过 → overall passed，含实际输出', () => {
  const root = makeTempProject([{ name: 'node-version', command: 'node -v' }]);
  const config = readConfig(path.join(root, 'knowledge', 'env-check.config.json'));
  const results = runEnvChecks(config, path.join(root, 'knowledge', 'env-check.config.json'), root, 'task-001');
  assert.strictEqual(results.overall_status, 'passed');
  assert.strictEqual(results.checks[0].status, 'passed');
  assert.strictEqual(results.checks[0].exit_code, 0);
  assert.ok(results.checks[0].output.includes('v'));
});

test('runEnvChecks 有失败 → overall failed，记录错误摘要', () => {
  const root = makeTempProject([
    { name: 'pass', command: 'node -e "process.exit(0)"' },
    { name: 'fail', command: 'node -e "process.exit(1)"' },
  ]);
  const config = readConfig(path.join(root, 'knowledge', 'env-check.config.json'));
  const results = runEnvChecks(config, path.join(root, 'knowledge', 'env-check.config.json'), root, 'task-001');
  assert.strictEqual(results.overall_status, 'failed');
  assert.ok(results.overall_reason.includes('fail'));
  assert.strictEqual(results.checks[0].status, 'passed');
  assert.strictEqual(results.checks[1].status, 'failed');
  assert.strictEqual(results.checks[1].exit_code, 1);
});

test('toMarkdown 产出人类可读快照', () => {
  const root = makeTempProject([{ name: 'ok', command: 'node -e "process.exit(0)"' }]);
  const config = readConfig(path.join(root, 'knowledge', 'env-check.config.json'));
  const results = runEnvChecks(config, path.join(root, 'knowledge', 'env-check.config.json'), root, 'task-001');
  const md = toMarkdown(results);
  assert.ok(md.includes('# 环境检查快照：task-001'));
  assert.ok(md.includes('✅ PASS'));
  assert.ok(md.includes('环境就绪'));
});
