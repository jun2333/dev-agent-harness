const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkTaskFile, splitSections } = require('../workflows/requirements/check/req-check.js');

const VALID_TASK = `# 需求：测试

## 背景与目标
- 背景：需要一个测试需求
- 目标：验证 req-check
- 成功指标：测试通过

## 范围
- 范围内：做 A
- 范围外：不做 B

## 功能需求
### FR-1 登录
- 描述：实现登录
- 用户故事：作为用户，我希望登录，以便访问
- 验收要点：输入正确账号密码可登录

## 验收标准
- [ ] 登录成功跳转首页
- [ ] 密码错误有提示

## 待确认问题
- （无）
`;

function makeTempTask(content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-req-'));
  const dir = path.join(root, '.harness', 'workspace', 't1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.md'), content);
  return path.join(dir, 'task.md');
}

test('splitSections 正确切分区块', () => {
  const sections = splitSections(VALID_TASK);
  const titles = sections.map((s) => s.title);
  assert.ok(titles.includes('背景与目标'));
  assert.ok(titles.includes('功能需求'));
  assert.ok(titles.includes('验收标准'));
});

test('合法需求文档通过', () => {
  const file = makeTempTask(VALID_TASK);
  assert.deepStrictEqual(checkTaskFile(file), []);
});

test('缺必含区块失败', () => {
  const content = VALID_TASK.replace('## 范围', '## 范围X');
  const file = makeTempTask(content);
  const failures = checkTaskFile(file);
  assert.ok(failures.some((f) => /缺少必含区块.*范围/.test(f)));
});

test('功能需求为空失败', () => {
  const content = VALID_TASK.replace('### FR-1 登录', '### 登录（非 FR 格式）');
  const file = makeTempTask(content);
  const failures = checkTaskFile(file);
  assert.ok(failures.some((f) => /功能需求为空/.test(f)));
});

test('验收标准为空失败', () => {
  const content = VALID_TASK.replace('- [ ] 登录成功跳转首页\n', '').replace('- [ ] 密码错误有提示\n', '');
  const file = makeTempTask(content);
  const failures = checkTaskFile(file);
  assert.ok(failures.some((f) => /验收标准为空/.test(f)));
});

test('待确认问题未清零失败（定稿条件）', () => {
  const content = VALID_TASK.replace('## 待确认问题\n- （无）', '## 待确认问题\n- [ ] 登录用邮箱还是手机号？');
  const file = makeTempTask(content);
  const failures = checkTaskFile(file);
  assert.ok(failures.some((f) => /待确认问题区仍有 1 条/.test(f)));
});

test('缺失文件直接失败', () => {
  const failures = checkTaskFile('/nonexistent/task.md');
  assert.ok(failures.some((f) => /需求文档缺失/.test(f)));
});
