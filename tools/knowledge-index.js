#!/usr/bin/env node

/**
 * knowledge-index.js — 知识库索引生成器
 *
 * 扫描 knowledge/{standards,patterns,lessons,skills}/ 下的 markdown 文件，
 * 读取 frontmatter 与正文标题，自动生成 knowledge/_index.md。
 *
 * 用途：reflecting collect / knowledge-init 之后运行，替代 LLM 手动更新索引
 * （LLM 手动更新易漏条目、留死链、与知识库漂移）。
 *
 * 用法：
 *   node .harness/tools/knowledge-index.js            生成索引（写 knowledge/_index.md）
 *   node .harness/tools/knowledge-index.js --check    仅校验：索引过期则 exit 1
 */

const fs = require('fs');
const path = require('path');

function findHarnessRoot(startDir) {
  let current = path.resolve(startDir || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, '.harness'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** 解析 frontmatter（--- 块），返回键值对象；无 frontmatter 返回 {} */
function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    val = val.replace(/^["']|["']$/g, '');
    fm[key] = val;
  }
  return fm;
}

/** 取第一个 H1 标题 */
function firstH1(content) {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/** 取正文第一段非空段落（去掉 frontmatter、标题行与代码块），用于派生描述 */
function firstParagraph(content, h1) {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const lines = body.split('\n');
  const paras = [];
  let cur = '';
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (line.startsWith('#') || line.trim() === '') {
      if (cur.trim()) { paras.push(cur.trim()); cur = ''; }
      continue;
    }
    cur += line.trim() + ' ';
  }
  if (cur.trim()) paras.push(cur.trim());
  // 跳过与标题相同的段落、以及列表式（- / 1.）开头的内容——不适合做索引描述
  const desc = paras.find((p) => !(h1 && p.includes(h1)) && !/^[-*•]|\d+\.\s/.test(p));
  return desc ? desc.slice(0, 80) + (desc.length > 80 ? '…' : '') : null;
}

/** 生成单个条目标题与描述 */
function entryTitleDesc(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);
  const h1 = firstH1(content);
  const title = fm.name || fm.title || h1 || path.basename(filePath, '.md');
  const desc = fm.description || firstParagraph(content, h1);
  return { title, desc };
}

/** 扫描某目录下的条目（按文件名排序），返回 markdown 行数组 */
function scanDir(root, relDir, filePicker) {
  const dir = path.join(root, relDir);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => filePicker(e))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const lines = [];
  for (const e of entries) {
    const relPath = path.join(relDir, e.name).replace(/\\/g, '/').replace(/^knowledge\//, '');
    const filePath = path.join(root, relDir, e.name);
    if (fs.statSync(filePath).isDirectory()) continue;
    const { title, desc } = entryTitleDesc(filePath);
    lines.push(`- [${title}](${relPath})${desc ? ` — ${desc}` : ''}`);
  }
  return lines;
}

/** 扫描 skills/ 下的子技能（每个子目录一个 SKILL.md） */
function scanSkills(root) {
  const dir = path.join(root, 'knowledge', 'skills');
  if (!fs.existsSync(dir)) return [];
  const subs = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const lines = [];
  for (const s of subs) {
    const filePath = path.join(root, 'knowledge', 'skills', s.name, 'SKILL.md');
    if (!fs.existsSync(filePath)) continue;
    const relPath = `skills/${s.name}/SKILL.md`;
    const { title, desc } = entryTitleDesc(filePath);
    lines.push(`- [${title}](${relPath})${desc ? ` — ${desc}` : ''}`);
  }
  return lines;
}

/** 归档区：knowledge/archive/*.md，无条目显示占位 */
function scanArchive(root) {
  const lines = scanDir(root, 'knowledge/archive', (e) => e.isFile() && e.name.endsWith('.md'));
  return lines.length ? lines : ['_暂无_'];
}

/** 生成完整索引内容 */
function generate(root) {
  const sections = [];

  // 知识库根级参考文档（如 architecture / tech-decisions），排除 _index / component-index
  const rootRefs = scanDir(root, 'knowledge', (e) => e.isFile() && e.name.endsWith('.md')
    && e.name !== '_index.md' && e.name !== 'component-index.md');
  if (rootRefs.length) sections.push(['## 项目参考 (Reference)', rootRefs]);

  const standards = scanDir(root, 'knowledge/standards', (e) => e.isFile() && e.name.endsWith('.md') && e.name !== '_index.md');
  if (standards.length) sections.push(['## 规范 (Standards)', standards]);

  const patterns = scanDir(root, 'knowledge/patterns', (e) => e.isFile() && e.name.endsWith('.md'));
  if (patterns.length) sections.push(['## 模式 (Patterns)', patterns]);

  const skills = scanSkills(root);
  if (skills.length) sections.push(['## 业务技能 (Skills)', skills]);

  sections.push(['## 资产索引', [`- [组件与 API 索引](component-index.md) — 前后端组件、API、工具的结构化清单（tech-audit 技能生成）`]]);

  const lessons = scanDir(root, 'knowledge/lessons', (e) => e.isFile() && e.name.endsWith('.md'));
  if (lessons.length) sections.push(['## 经验 (Lessons)', lessons]);

  const archive = scanArchive(root);
  sections.push(['## 归档 (Archive)', archive]);

  const out = ['# 知识库索引', '',
    '> 本文件由 `.harness/tools/knowledge-index.js` 自动生成，手动修改会被覆盖。', ''];
  for (const [heading, lines] of sections) {
    out.push(heading, '');
    out.push(...lines);
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

function main() {
  const root = findHarnessRoot(process.cwd());
  if (!root) { console.error('[knowledge-index] 未找到 .harness 目录'); process.exit(1); }
  const indexPath = path.join(root, 'knowledge', '_index.md');
  const generated = generate(root);

  if (process.argv.includes('--check')) {
    if (!fs.existsSync(indexPath)) {
      console.error('[knowledge-index] knowledge/_index.md 缺失（应运行生成工具）');
      process.exit(1);
    }
    const current = fs.readFileSync(indexPath, 'utf8');
    if (current !== generated) {
      console.error('[knowledge-index] knowledge/_index.md 过期，请运行生成工具更新');
      process.exit(1);
    }
    console.log('[knowledge-index] 索引最新 ✓');
    return;
  }

  fs.writeFileSync(indexPath, generated);
  console.log(`[knowledge-index] 已生成 knowledge/_index.md（${sectionsCount(generated)} 节）`);
}

function sectionsCount(content) {
  return (content.match(/^## /gm) || []).length;
}

main();
