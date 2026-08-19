const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseBashReads, extractReads, generateSnapshot, toMarkdown } = require('../tools/context-snapshot.js');

// ---- parseBashReads：Bash 命令 → 读取目标 ----

test('cat 提取文件（含管道）', () => {
  const r = parseBashReads('cat src/a.ts | grep foo');
  assert.deepStrictEqual(r.files, ['src/a.ts']);
});

test('cat 多文件', () => {
  const r = parseBashReads('cat a.ts b.ts c.ts');
  assert.deepStrictEqual(r.files, ['a.ts', 'b.ts', 'c.ts']);
});

test('head/tail 的 -N 参数不算文件', () => {
  const r = parseBashReads('tail -5 file.txt');
  assert.deepStrictEqual(r.files, ['file.txt']);
  const r2 = parseBashReads('head -n 20 log.txt');
  assert.deepStrictEqual(r2.files, ['log.txt']);
});

test('grep 的 pattern 不算文件，文件参数正确提取', () => {
  const r = parseBashReads('grep -nE "foo" src/lib/auth.ts');
  assert.deepStrictEqual(r.files, ['src/lib/auth.ts']);
  const r2 = parseBashReads('grep -rn TODO src/');
  assert.deepStrictEqual(r2.files, ['src/']);
});

test('find 提取起始目录', () => {
  const r = parseBashReads('find src -name "*.ts" -type f');
  assert.deepStrictEqual(r.dirs, ['src']);
});

test('ls 提取目录（无参数为 .）', () => {
  const r = parseBashReads('ls src/components/');
  assert.deepStrictEqual(r.dirs, ['src/components/']);
  const r2 = parseBashReads('ls');
  assert.deepStrictEqual(r2.dirs, ['.']);
});

test('重定向 < 也算读取', () => {
  const r = parseBashReads('grep foo < input.txt');
  assert.ok(r.files.includes('input.txt'));
});

test('忽略命令自身的 flag', () => {
  const r = parseBashReads('ls -la');
  assert.deepStrictEqual(r.dirs, []);
});

test('多个子命令（&& / ;）分别解析', () => {
  const r = parseBashReads('cat a.ts && grep x b.ts; ls src');
  assert.ok(r.files.includes('a.ts'));
  assert.ok(r.files.includes('b.ts'));
  assert.deepStrictEqual(r.dirs, ['src']);
});

// ---- extractReads：工具调用记录 → 读取目标 ----

test('Read 工具直接提取文件路径', () => {
  const r = extractReads({ tool: 'Read', input: 'src/app.ts' });
  assert.deepStrictEqual(r.files, ['src/app.ts']);
});

test('Bash 工具走命令解析', () => {
  const r = extractReads({ tool: 'Bash', input: 'cat README.md' });
  assert.deepStrictEqual(r.files, ['README.md']);
});

test('其他工具返回空', () => {
  const r = extractReads({ tool: 'Edit', input: 'src/app.ts (edit)' });
  assert.deepStrictEqual(r, { files: [], dirs: [] });
});

// ---- generateSnapshot：端到端 ----

function makeTempProject(records) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ctx-'));
  const ws = path.join(root, '.harness', 'workspace', 'task-001');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'checkpoint.json'), JSON.stringify({ created_at: '2026-08-19T00:00:00.000Z' }));
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 'tool-actions.log'),
    records.map((r) => JSON.stringify(r)).join('\n'));
  // 造两个真实文件用于字节统计
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'a'.repeat(300));
  fs.writeFileSync(path.join(root, 'README.md'), 'b'.repeat(900));
  return root;
}

test('generateSnapshot 基线过滤 + 字节/token 统计', () => {
  const records = [
    { ts: '2026-08-18T23:00:00.000Z', tool: 'Bash', input: 'cat README.md' }, // 基线前，应被过滤
    { ts: '2026-08-19T01:00:00.000Z', tool: 'Read', input: 'src/app.ts' },    // 基线后
    { ts: '2026-08-19T01:01:00.000Z', tool: 'Bash', input: 'grep -n foo src/app.ts' },
    { ts: '2026-08-19T01:02:00.000Z', tool: 'Bash', input: 'ls src' },
    { ts: '2026-08-19T01:03:00.000Z', tool: 'Edit', input: 'src/app.ts (edit)' },
  ];
  const root = makeTempProject(records);
  const ledger = generateSnapshot({ root, taskId: 'task-001' });

  assert.strictEqual(ledger.records_scanned, 4); // 基线前那条被过滤
  // src/app.ts 被 Read + grep 读到 2 次，bytes = 300
  const app = ledger.files.find((f) => f.path === 'src/app.ts');
  assert.ok(app);
  assert.strictEqual(app.count, 2);
  assert.strictEqual(app.bytes, 300);
  assert.strictEqual(app.estimated_tokens, 100);
  // README.md 在基线前，不应出现
  assert.ok(!ledger.files.find((f) => f.path === 'README.md'));
  // ls src → 目录浏览
  assert.ok(ledger.dirs.find((d) => d.path === 'src'));
  // token 估算
  assert.strictEqual(ledger.total_estimated_tokens, 100);
});

test('generateSnapshot 无基线时统计全部', () => {
  const records = [{ ts: '2026-08-19T01:00:00.000Z', tool: 'Bash', input: 'cat README.md' }];
  const root = makeTempProject(records);
  fs.writeFileSync(path.join(root, '.harness', 'workspace', 'task-001', 'checkpoint.json'), JSON.stringify({}));
  const ledger = generateSnapshot({ root, taskId: 'task-001' });
  assert.strictEqual(ledger.records_scanned, 1);
  assert.strictEqual(ledger.files[0].path, 'README.md');
  assert.strictEqual(ledger.files[0].bytes, 900);
});

test('忽略 node_modules 等目录', () => {
  const records = [{ ts: '2026-08-19T01:00:00.000Z', tool: 'Bash', input: 'cat node_modules/x/index.js' }];
  const root = makeTempProject(records);
  const ledger = generateSnapshot({ root, taskId: 'task-001' });
  assert.strictEqual(ledger.files.length, 0);
});

test('toMarkdown 产出人类可读清单', () => {
  const ledger = {
    task_id: 'task-001',
    baseline_ts: '2026-08-19T00:00:00.000Z',
    generated_at: '2026-08-19T01:00:00.000Z',
    records_scanned: 3,
    total_estimated_tokens: 100,
    files: [{ path: 'src/app.ts', count: 2, estimated_tokens: 100, sources: ['Read', 'Bash'] }],
    dirs: [{ path: 'src', count: 1 }],
  };
  const md = toMarkdown(ledger);
  assert.ok(md.includes('# 上下文已读清单：task-001'));
  assert.ok(md.includes('src/app.ts'));
  assert.ok(md.includes('~100'));
  assert.ok(md.includes('已读文件'));
});
