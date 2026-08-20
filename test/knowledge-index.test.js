const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TOOL = path.join(__dirname, '..', 'tools', 'knowledge-index.js');

/** 建临时项目：.harness/ + 带示例文件的知识库 */
function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kidx-'));
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  const k = path.join(root, 'knowledge');
  fs.mkdirSync(path.join(k, 'standards'), { recursive: true });
  fs.mkdirSync(path.join(k, 'patterns'), { recursive: true });
  fs.mkdirSync(path.join(k, 'lessons'), { recursive: true });
  fs.mkdirSync(path.join(k, 'skills', 'designing'), { recursive: true });
  fs.writeFileSync(path.join(k, 'standards', 'code-style.md'),
    '---\ntags: [code-style]\nstatus: active\n---\n\n# 代码风格规范\n\n- 命名 kebab-case\n- 组件用 shadcn\n');
  fs.writeFileSync(path.join(k, 'patterns', 'route-handler.md'),
    '---\ntags: [backend]\nstatus: active\n---\n\n# Route Handler 模式\n\n新增 API 时按服务层 + 薄 handler 实现。\n');
  fs.writeFileSync(path.join(k, 'lessons', '1-sample-lesson.md'),
    '---\ntags: [process]\nuse_count: 1\nstatus: active\n---\n\n# 示例经验\n\n遇到 X 时应该做 Y。\n');
  fs.writeFileSync(path.join(k, 'skills', 'designing', 'SKILL.md'),
    '---\nname: designing\ndescription: 技术设计阶段。\n---\n\n# Designing\n');
  return root;
}

function runTool(root, ...args) {
  return execFileSync(process.execPath, [TOOL, ...args], { cwd: root, encoding: 'utf8' });
}

test('生成 knowledge/_index.md：扫描各分类并写相对路径', () => {
  const root = makeTempProject();
  runTool(root);
  const idx = fs.readFileSync(path.join(root, 'knowledge', '_index.md'), 'utf8');

  assert.ok(idx.includes('## 规范 (Standards)'));
  assert.ok(idx.includes('## 模式 (Patterns)'));
  assert.ok(idx.includes('## 经验 (Lessons)'));
  assert.ok(idx.includes('## 业务技能 (Skills)'));

  // 路径相对 knowledge/，不带 knowledge/ 前缀
  assert.ok(idx.includes('[代码风格规范](standards/code-style.md)'));
  assert.ok(idx.includes('[Route Handler 模式](patterns/route-handler.md)'));
  assert.ok(idx.includes('[示例经验](lessons/1-sample-lesson.md)'));
  assert.ok(idx.includes('[designing](skills/designing/SKILL.md) — 技术设计阶段。'));

  // 描述派生：跳过列表式段落（code-style 无描述），取普通段落（route-handler 有）
  assert.ok(!idx.includes('— 命名 kebab-case'));
  assert.ok(idx.includes('— 新增 API 时按服务层 + 薄 handler 实现。'));
});

test('--check 模式：索引最新则通过，过期则 exit 1', () => {
  const root = makeTempProject();
  runTool(root);
  // 最新 → 通过
  runTool(root, '--check');

  // 手动改索引 → 过期 → 拒绝（exit 1）
  const idxPath = path.join(root, 'knowledge', '_index.md');
  fs.writeFileSync(idxPath, fs.readFileSync(idxPath, 'utf8') + '# 手动添加\n');
  try {
    runTool(root, '--check');
    assert.fail('应拒绝过期的索引');
  } catch (e) {
    assert.strictEqual(e.status, 1);
  }
});
