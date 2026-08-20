#!/usr/bin/env node

/**
 * asset-index.js — 技术资产索引生成器（清单骨架 + 描述保留）
 *
 * 扫描项目前端/后端资产，生成 knowledge/component-index.md：
 *   - 清单部分（组件/API 端点/工具模块）由脚本机械生成——永不过期
 *   - 职责/功能描述保留既有文案（由 tech-audit 的 LLM 补充），新条目描述留空待补
 *
 * 用法：
 *   node .harness/tools/asset-index.js            生成/刷新索引
 *   node .harness/tools/asset-index.js --check    校验索引清单是否过期（缺/多条目即 exit 1）
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

/** 文件名 kebab-case → PascalCase（每个文件 = 一个条目，稳定且唯一） */
function kebabToPascal(name) {
  return name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()).replace(/^[a-z]/, (c) => c.toUpperCase());
}

/** 提取 props：优先 interface XProps 字段名，兜底组件函数/const/forwardRef 的解构参数 */
function extractProps(content, key) {
  const iface = content.match(new RegExp(`interface\\s+${key}Props[^{]*\\{([\\s\\S]*?)\\n\\}`));
  if (iface) {
    const fields = iface[1].split('\n')
      .map((l) => l.trim())
      .map((l) => l.replace(/[?:;].*$/, ''))
      .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n.length < 30);
    return [...new Set(fields)].join(', ');
  }
  // 组件函数/const/forwardRef 的解构参数
  const dec = content.match(/(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\w+\s*\(\s*\{([^}]*)\}/)
    || content.match(/(?:export\s+)?const\s+\w+\s*=\s*\(\s*\{([^}]*)\}\s*\)\s*=>/)
    || content.match(/\(\s*\{([^}]*)\}\s*,\s*ref\s*\)\s*=>/);
  if (dec) {
    const params = dec[1].match(/([A-Za-z_$][\w$]*)/g) || [];
    return [...new Set(params.filter((p) => p !== 'props'))].join(', ');
  }
  return '';
}

/** 提取文件头部注释（/** ... *\/ 或前几行 //），用于描述兜底 */
function extractComment(content) {
  let m = content.match(/\/\*\*([\s\S]*?)\*\//);
  if (m) return m[1].replace(/\s*\*\s?/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 80);
  const lines = content.split('\n');
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const l = lines[i].trim();
    if (l.startsWith('//') && !l.includes('"use client"') && !l.startsWith('// ') || (l.startsWith('//') && l.length > 3)) {
      return l.replace(/^\/\/\s*/, '').trim().slice(0, 80);
    }
  }
  return '';
}

/** 组件使用场景：grep 组件名在其他文件的 import 引用（排除组件自身文件） */
function findUsage(root, componentName, ownFile) {
  const hits = [];
  const dirs = [path.join(root, 'src', 'app'), path.join(root, 'src', 'features')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    walkFiles(dir, (f) => {
      if (!/\.(tsx|ts)$/.test(f) || f === ownFile) return;
      const c = fs.readFileSync(f, 'utf8');
      if (new RegExp(`\\b${componentName}\\b`).test(c) && /(import|from)/.test(c)) {
        if (new RegExp(`import[\\s\\S]*?\\b${componentName}\\b|from\\s+['"][^'"]*`).test(c)) {
          hits.push(rel(root, f));
        }
      }
    });
  }
  return [...new Set(hits)].slice(0, 3);
}

function rel(root, p) { return path.relative(root, p).replace(/\\/g, '/'); }

function walkFiles(dir, cb) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, cb);
    else cb(full);
  }
}

/** route.ts 导出的 HTTP 方法 */
function extractMethods(content) {
  const methods = [];
  for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|DELETE|PUT)\b/g)) {
    methods.push(m[1]);
  }
  return methods.join(', ');
}

/** 工具模块导出列表 */
function extractExports(content) {
  const out = [];
  for (const m of content.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/g)) {
    out.push(m[1]);
  }
  for (const m of content.matchAll(/export\s+interface\s+([A-Za-z_$][\w$]*)/g)) {
    out.push(m[1]);
  }
  return out;
}

// ---- 扫描 ----

function scanComponents(root, dir, isFeature) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !/\.tsx$/.test(e.name) || e.name.endsWith('.test.tsx')) continue;
    const file = path.join(dir, e.name);
    const content = fs.readFileSync(file, 'utf8');
    const name = kebabToPascal(e.name.replace(/\.tsx$/, ''));
    results.push({
      name,
      file: rel(root, file),
      props: extractProps(content, name),
      usage: isFeature ? findUsage(root, name, file).join('、') : '',
      comment: extractComment(content),
    });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function scanApi(root) {
  const apiDir = path.join(root, 'src', 'app', 'api');
  if (!fs.existsSync(apiDir)) return [];
  const results = [];
  walkFiles(apiDir, (f) => {
    if (!f.endsWith('route.ts')) return;
    const content = fs.readFileSync(f, 'utf8');
    const apiPath = path.relative(apiDir, f).replace(/route\.ts$/, '').replace(/\\/g, '/');
    results.push({
      path: '/api/' + apiPath.replace(/\/$/, ''),
      methods: extractMethods(content),
      isFramework: apiPath.includes('[...nextauth]'),
      comment: extractComment(content),
    });
  });
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

function scanToolModules(root, dir, label) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !/\.ts$/.test(e.name) || e.name.endsWith('.test.ts')) continue;
    const file = path.join(dir, e.name);
    const content = fs.readFileSync(file, 'utf8');
    results.push({
      module: label ? `${label}/${e.name.replace(/\.ts$/, '')}` : e.name.replace(/\.ts$/, ''),
      exports: extractExports(content).join(', '),
      comment: extractComment(content),
    });
  }
  return results.sort((a, b) => a.module.localeCompare(b.module, 'zh-CN'));
}

// ---- 既有描述解析（按分区表列含义取"描述"列） ----

/**
 * 解析既有索引为 key → 描述。
 * 各表描述列位置不同：组件表第 2 列；API/工具表第 3 列。
 * 返回 { ui:{}, biz:{}, api:{}, tool:{} } 四个 map。
 */
function loadExistingDescriptions(root) {
  const indexPath = path.join(root, 'knowledge', 'component-index.md');
  const maps = { ui: {}, biz: {}, api: {}, tool: {} };
  if (!fs.existsSync(indexPath)) return maps;
  const lines = fs.readFileSync(indexPath, 'utf8').split('\n');
  let section = null;
  for (const line of lines) {
    if (/^## /.test(line)) {
      section = line.includes('UI') ? 'ui' : line.includes('业务') ? 'biz' : line.includes('API') ? 'api' : line.includes('工具') ? 'tool' : null;
      continue;
    }
    if (!section || !line.startsWith('|') || line.includes('|------')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const key = cells[0];
    // 组件表：| name | desc | ... | → 描述在 index 1；API/工具表：| path/module | ... | desc | → 描述在末尾
    const desc = section === 'api' || section === 'tool' ? cells[cells.length - 1] : cells[1];
    if (key && !key.startsWith('-') && desc && !desc.includes('|')) maps[section][key] = desc;
  }
  return maps;
}

// ---- 生成 ----

function generate(root) {
  const maps = loadExistingDescriptions(root);
  const desc = (map, key, fallback) => map[key] || fallback || '';

  const out = [];
  out.push('# 项目技术资产索引', '',
    `> 最后更新：${new Date().toISOString().slice(0, 10)}`,
    '> 生成方式：`.harness/tools/asset-index.js` 生成清单骨架（组件/端点/工具机械扫描），职责/功能描述由 tech-audit 补充',
    '> 清单过期即运行 `node .harness/tools/asset-index.js` 刷新；`--check` 校验', '');

  // UI 基础组件
  const ui = scanComponents(root, path.join(root, 'src', 'shared', 'components', 'ui'), false);
  if (ui.length) {
    out.push('## UI 基础组件', '',
      '| 组件 | 职责 | 关键 Props |', '|------|------|-----------|');
    for (const c of ui) {
      out.push(`| ${c.name} | ${desc(maps.ui, c.name, c.comment)} | ${c.props || '—'} |`);
    }
    out.push('');
  }

  // 业务组件（按 feature 分组）
  const featuresDir = path.join(root, 'src', 'features');
  if (fs.existsSync(featuresDir)) {
    const featureDirs = fs.readdirSync(featuresDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (featureDirs.length) {
      out.push('## 业务组件', '');
      for (const f of featureDirs) {
        const comps = scanComponents(root, path.join(featuresDir, f, 'components'), true);
        if (!comps.length) continue;
        out.push(`### ${f[0].toUpperCase() + f.slice(1)}`, '',
          '| 组件 | 职责 | 关键 Props | 使用场景 |', '|------|------|-----------|---------|');
        for (const c of comps) {
          out.push(`| ${c.name} | ${desc(maps.biz, c.name, c.comment)} | ${c.props || '—'} | ${c.usage || '—'} |`);
        }
        out.push('');
      }
    }
  }

  // 通用组件（shared 非 ui）
  const sharedDir = path.join(root, 'src', 'shared', 'components');
  if (fs.existsSync(sharedDir)) {
    const sharedComps = scanComponents(root, sharedDir, true);
    const uiNames = new Set(scanComponents(root, path.join(sharedDir, 'ui'), false).map((c) => c.name));
    const comps = sharedComps.filter((c) => !uiNames.has(c.name));
    if (comps.length) {
      out.push('## 通用组件', '',
        '| 组件 | 职责 | 关键 Props | 使用场景 |', '|------|------|-----------|---------|');
      for (const c of comps) {
        out.push(`| ${c.name} | ${desc(maps.biz, c.name, c.comment)} | ${c.props || '—'} | ${c.usage || '—'} |`);
      }
      out.push('');
    }
  }

  // API 端点
  const api = scanApi(root);
  if (api.length) {
    out.push('## API 端点（Route Handlers）', '',
      '| 路径 | 方法 | 功能 |', '|------|------|------|');
    for (const a of api) {
      out.push(`| ${a.path} | ${a.methods || '—'} | ${a.isFramework ? '框架路由（认证入口）' : desc(maps.api, a.path, a.comment)} |`);
    }
    out.push('');
  }

  // 共享工具与服务
  const utils = scanToolModules(root, path.join(root, 'src', 'shared', 'utils'));
  const libApi = scanToolModules(root, path.join(root, 'src', 'lib', 'api'), 'lib/api');
  const services = scanToolModules(root, path.join(root, 'src', 'server', 'services'), 'server/services');
  const tools = [...utils, ...libApi, ...services];
  if (tools.length) {
    out.push('## 共享工具与服务', '',
      '| 模块 | 导出 | 用途 |', '|------|------|------|');
    for (const t of tools) {
      out.push(`| ${t.module} | ${t.exports || '—'} | ${desc(maps.tool, t.module, t.comment)} |`);
    }
    out.push('');
  }

  return out.join('\n').trimEnd() + '\n';
}

// ---- --check：骨架清单是否过期 ----

function collectSkeleton(root) {
  const names = new Set();
  const collectDir = (dir) => {
    for (const c of scanComponents(root, dir, false)) names.add(`comp:${c.name}`);
  };
  const featuresDir = path.join(root, 'src', 'features');
  if (fs.existsSync(featuresDir)) {
    for (const f of fs.readdirSync(featuresDir, { withFileTypes: true })) {
      if (f.isDirectory()) {
        for (const c of scanComponents(root, path.join(featuresDir, f.name, 'components'), true)) names.add(`comp:${c.name}`);
      }
    }
  }
  const sharedDir = path.join(root, 'src', 'shared', 'components');
  const uiDir = path.join(sharedDir, 'ui');
  if (fs.existsSync(uiDir)) collectDir(uiDir);
  if (fs.existsSync(sharedDir)) collectDir(sharedDir);
  for (const a of scanApi(root)) names.add(`api:${a.path}`);
  return names;
}

function checkIndex(root) {
  const indexPath = path.join(root, 'knowledge', 'component-index.md');
  if (!fs.existsSync(indexPath)) {
    console.error('[asset-index] knowledge/component-index.md 缺失（应运行生成工具）');
    process.exit(1);
  }
  const current = fs.readFileSync(indexPath, 'utf8');
  const curEntries = new Set();
  for (const line of current.split('\n')) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|/);
    if (m && m[1].trim() && !m[1].trim().startsWith('-') && !m[1].trim().startsWith(':')) {
      curEntries.add(m[1].trim());
    }
  }
  const fresh = collectSkeleton(root);
  for (const entry of fresh) {
    const [type, key] = entry.split(':');
    const exists = curEntries.has(key) || (type === 'comp' && [...curEntries].some((k) => k === key));
    if (!exists) {
      console.error(`[asset-index] 索引过期：缺少条目 ${key}`);
      process.exit(1);
    }
  }
  console.log('[asset-index] 索引清单最新 ✓');
}

// ---- CLI ----

function main() {
  const root = findHarnessRoot(process.cwd());
  if (!root) { console.error('[asset-index] 未找到 .harness 目录'); process.exit(1); }
  const indexPath = path.join(root, 'knowledge', 'component-index.md');
  if (process.argv.includes('--check')) {
    checkIndex(root);
    return;
  }
  fs.writeFileSync(indexPath, generate(root));
  console.log('[asset-index] 已生成 knowledge/component-index.md');
}

main();
