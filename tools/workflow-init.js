#!/usr/bin/env node

/**
 * workflow-init.js — 工作流模板实例化工具（workflow-init 技能的确定性操作）
 *
 * 模板语义：.harness/workflows/{name}/ 是通用模板（骨架），knowledge/plugins/{name}/ 是项目定制实例。
 * 本工具负责"模板 → 项目实例"的确定性操作；语义判断（哪些字段该定制、sync 冲突裁决）
 * 由 knowledge-init 的 workflow-init 技能文档承载。
 *
 * 用法：
 *   node workflow-init.js init <name> [--as <new-name>] [--force]
 *     - 把通用模板复制到 knowledge/plugins/{new-name||name}/workflow.yaml
 *     - 校验命令池绑定：模板 verify.checks 中的命令池 key 必须存在于 verify.config.json（内置 check 跳过）
 *     - 内置 check（skill-check/workflow-check）在项目副本可生成 check/ 占位说明
 *     - --force 跳过命令池校验
 *   node workflow-init.js sync <name>
 *     - 上游模板更新同步：只补齐"模板有而项目副本没有"的字段/阶段；项目已有的差异字段视为定制保留
 *     - 输出：补齐了哪些、保留了哪些、冲突报告（两边都改）
 *   node workflow-init.js list
 *     - 列出全部可用工作流（项目层 + 通用层），标注 source
 */

const fs = require('fs');
const path = require('path');
const yaml = require('../hooks/simple-yaml.js');
const {
  loadWorkflowDefinition,
  listWorkflows,
  readVerifyConfig,
  findWorkflowFile,
  PROJECT_PLUGINS_DIR,
} = require('./workflow-lib.js');

function findHarnessRoot(startDir) {
  const candidates = [startDir, process.cwd()];
  for (const dir of candidates) {
    let current = path.resolve(dir || '.');
    while (true) {
      if (fs.existsSync(path.join(current, '.harness'))) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}

function getArg(name) {
  const args = process.argv.slice(2);
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] !== undefined) return args[idx + 1];
  return null;
}

/** 直接解析工作流模板文件（模板源在 .harness/workflows/，不通过 findWorkflowFile——它只查项目层） */
function parseWorkflowFile(file, fallbackName) {
  const doc = yaml.parse(fs.readFileSync(file, 'utf8'));
  const stages = {};
  for (const s of Array.isArray(doc.stages) ? doc.stages : []) {
    if (s && s.name) stages[s.name] = s;
  }
  return {
    name: doc.name || fallbackName,
    description: doc.description || '',
    stages,
    verify: doc.verify || { checks: [] },
    pre_task: doc.pre_task || [],
    post_task: doc.post_task || [],
  };
}

/** 命令池 key 校验：返回 { missing: string[] }（内置 check + 插件自带 check 脚本不算 key） */
function checkCommandPool(root, wfDef) {
  const checks = (wfDef && wfDef.verify && wfDef.verify.checks) || [];
  if (!Array.isArray(checks) || checks.length === 0) return { missing: [] };
  const builtin = new Set(['skill-check', 'workflow-check']);
  const pool = readVerifyConfig(root);
  const poolKeys = new Set(pool && pool.commands && typeof pool.commands === 'object' && !Array.isArray(pool.commands)
    ? Object.keys(pool.commands)
    : []);
  return {
    missing: checks.filter((c) => {
      if (builtin.has(c)) return false; // 框架内置 check
      if (poolKeys.has(c)) return false; // 命令池 key
      // 插件自带 check 脚本（模板目录 check/{c}.js 存在）→ 不依赖命令池，随插件复制
      if (fs.existsSync(path.join(root, '.harness', 'workflows', wfDef.name, 'check', `${c}.js`))) return false;
      return true;
    }),
  };
}

function cmdInit(root, name, asName, force) {
  // 通用模板 = .harness/workflows/{name}/（模板源；findWorkflowFile 只查项目层，不用于模板）
  const templateDir = path.join(root, '.harness', 'workflows', name);
  const templateFile = path.join(templateDir, 'workflow.yaml');
  if (!fs.existsSync(templateFile)) {
    console.error(`[workflow-init] 通用模板不存在：.harness/workflows/${name}/workflow.yaml`);
    process.exit(2);
  }

  const target = asName || name;
  const targetDir = path.join(root, PROJECT_PLUGINS_DIR, target);
  const targetFile = path.join(targetDir, 'workflow.yaml');
  if (fs.existsSync(targetFile)) {
    console.error(`[workflow-init] 项目层已存在 ${target}（${targetFile}），先 sync 或删除后再 init`);
    process.exit(2);
  }

  const template = parseWorkflowFile(templateFile, name);

  // 命令池校验
  const { missing } = checkCommandPool(root, template);
  if (missing.length > 0 && !force) {
    console.error(
      `[workflow-init] 模板 ${name} 的 verify.checks 引用了命令池 key 但项目 verify.config.json 缺失：\n` +
        `  ${missing.join(', ')}\n` +
        `请先向 knowledge/verify.config.json 的 commands 补充这些 key，或用 --force 跳过（实例化后 verify 将不可用）。`
    );
    process.exit(2);
  }

  // 复制整个插件目录（workflow.yaml + check/ + templates/）
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(templateDir)) {
    fs.cpSync(path.join(templateDir, entry), path.join(targetDir, entry), { recursive: true });
  }

  // 复制插件专属 skill：模板引用 `skills/{name}/...` 且 .harness/skills/{name}/ 存在 →
  // 视为插件自带 skill，复制到项目副本 knowledge/plugins/{target}/skills/（插件自包含，不依赖 .harness）
  const tplOwnSkillDir = path.join(root, '.harness', 'skills', name);
  if (fs.existsSync(tplOwnSkillDir)) {
    fs.cpSync(tplOwnSkillDir, path.join(targetDir, 'skills'), { recursive: true });
    console.log(`  [插件 skill] 已复制插件专属 skill：.harness/skills/${name}/ → knowledge/plugins/${target}/skills/`);
  }

  // 记录上游模板来源（sync 溯源用），插到文件头
  {
    const content = fs.readFileSync(targetFile, 'utf8');
    fs.writeFileSync(targetFile, `# template: ${name}\n${content}`);
  }

  // --as 重命名时同步改 workflow.yaml 的 name（顶层第一字段，文本替换唯一出现）
  if (target !== template.name) {
    const content = fs.readFileSync(targetFile, 'utf8');
    const updated = content.replace(
      new RegExp(`^name:\\s*${template.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'),
      `name: ${target}`
    );
    if (updated === content) {
      console.error(`[workflow-init] 警告：无法在项目副本中重命名 name（未找到 "name: ${template.name}"），请手动改 ${targetFile} 首行`);
    } else {
      fs.writeFileSync(targetFile, updated);
    }
  }

  // 路径规范化（自动修正 + 校验）：把项目副本中过时的 `skills/{dir}/{name}.md` skill 引用
  // 修正为 `skills/{dir}/{name}/SKILL.md`（标准 skill 格式），只改项目副本，不动模板源。
  // 同时校验修正后是否还有无效引用。
  normalizeSkillPaths(root, targetFile, target, name);

  console.log(`[workflow-init] ✓ 已实例化 ${name} → knowledge/plugins/${target}/（source: project，含 check/templates）`);
  if (missing.length > 0) {
    console.log(`  [警告] 命令池缺失 key（已 --force 跳过校验）：${missing.join(', ')}`);
  } else if (template.verify && template.verify.checks && template.verify.checks.length > 0) {
    console.log(`  verify.checks: ${template.verify.checks.join(', ')}（命令池绑定已校验）`);
  }
  console.log('  建议定制点（改项目副本）：verify.checks（绑定项目测试命令）/ 阶段增删 / gate / sections / executor');
  console.log(`  下一步：编辑 ${targetFile} 完成项目定制`);
}

/**
 * 路径规范化（init 与 sync 共享）：
 *   1) 插件专属 skill `skills/{name}/...` → 项目内 `knowledge/plugins/{target}/skills/...`
 *   2) 框架级/共享 skill 的过时 .md 引用 → /SKILL.md（保留 .harness 引用）
 *   3) 校验修正后是否还有无效引用
 */
function normalizeSkillPaths(root, targetFile, target, name) {
  const lines = fs.readFileSync(targetFile, 'utf8').split('\n');
  let fixed = 0;
  const outLines = lines.map((line) => {
    const m = line.match(/^(\s*(?:-\s*)?skill:\s*)(\S+)\s*$/);
    if (!m) return line;
    const ref = m[2];

    // 1) 插件专属 skill：`skills/{name}/...` → 项目内 `knowledge/plugins/{target}/skills/...`
    const ownPrefix = `skills/${name}/`;
    if (ref.startsWith(ownPrefix)) {
      const rel = ref.slice(ownPrefix.length).replace(/\.md$/, '');
      const projRef = `knowledge/plugins/${target}/skills/${rel}/SKILL.md`;
      if (fs.existsSync(path.join(root, projRef))) {
        fixed++;
        return `${m[1]}${projRef}`;
      }
    }

    // 2) 框架级/共享 skill 的过时 .md 引用 → /SKILL.md（保留 .harness 引用）
    if (ref.endsWith('.md') && !ref.startsWith('knowledge/')) {
      const dir = ref.replace(/\.md$/, '');
      const skMd = path.join(root, '.harness', dir, 'SKILL.md');
      const oldRef = path.join(root, '.harness', ref);
      if (!fs.existsSync(oldRef) && fs.existsSync(skMd)) {
        fixed++;
        return `${m[1]}${dir}/SKILL.md`;
      }
    }
    return line;
  });
  if (fixed > 0) {
    fs.writeFileSync(targetFile, outLines.join('\n'));
  }

  // 修正后重新校验剩余无效引用
  const finalPlugin = parseWorkflowFile(targetFile, target);
  const issues = [];
  for (const [sname, st] of Object.entries(finalPlugin.stages)) {
    if (!st.skill) continue;
    const candidates = [
      path.join(root, st.skill.startsWith('knowledge/') ? '.' : '.harness', st.skill),
      path.join(root, st.skill),
    ];
    if (!candidates.some((c) => fs.existsSync(c))) {
      issues.push(`stage.${sname}.skill=${st.skill}（引用不存在）`);
    }
  }
  if (fixed > 0) {
    console.log(`  [路径规范化] 自动修正 ${fixed} 处 skill 引用（.md → /SKILL.md 或插件专属 → 项目内，项目副本）`);
  }
  if (issues.length > 0) {
    console.log(`  [路径规范化] ${issues.length} 处 skill 引用仍无效（需人工处理）：`);
    for (const i of issues) console.log(`    - ${i}`);
  } else {
    console.log('  [路径规范化] 全部 skill 引用有效');
  }
  return { fixed, issues };
}

/** 字段级 diff：返回 { added: string[], kept: string[] }（added=模板有项目没有，kept=项目定制保留） */
function diffWorkflow(template, project) {
  const added = [];
  const kept = [];
  // 元信息字段（name/source 等）不参与定制对比
  const SKIP = new Set(['name', 'source']);
  // 顶层字段
  for (const key of Object.keys(template)) {
    if (SKIP.has(key) || ['stages', 'verify'].includes(key)) continue;
    if (project[key] === undefined) added.push(key);
    else if (JSON.stringify(project[key]) !== JSON.stringify(template[key])) kept.push(key);
  }
  // verify.checks
  const tChecks = (template.verify && template.verify.checks) || [];
  const pChecks = (project.verify && project.verify.checks) || [];
  if (JSON.stringify(tChecks) !== JSON.stringify(pChecks)) {
    if (pChecks === undefined || pChecks.length === 0) added.push('verify.checks');
    else kept.push('verify.checks');
  }
  // stages：模板有而项目没有的阶段 → added；同名阶段字段差异 → kept
  const tStageNames = Object.keys(template.stages || {});
  const pStageNames = Object.keys(project.stages || {});
  for (const s of tStageNames) {
    if (!pStageNames.includes(s)) added.push(`stage.${s}`);
    else {
      const ts = template.stages[s];
      const ps = project.stages[s];
      for (const k of Object.keys(ts)) {
        if (ps[k] === undefined) added.push(`stage.${s}.${k}`);
        else if (JSON.stringify(ts[k]) !== JSON.stringify(ps[k])) kept.push(`stage.${s}.${k}`);
      }
    }
  }
  return { added, kept };
}

function cmdSync(root, name) {
  const found = findWorkflowFile(root, name);
  if (!found || found.source !== 'project') {
    console.error(`[workflow-init] 项目层没有 ${name}（knowledge/plugins/${name}/workflow.yaml）`);
    process.exit(2);
  }
  // 溯源：项目副本头部的 # template: {上游名}（--as 重命名时记录），无则用自身 name
  const raw = fs.readFileSync(found.file, 'utf8');
  const tmplMatch = raw.match(/^#\s*template:\s*([a-z0-9][a-z0-9-]*)\s*$/m);
  const upstreamName = tmplMatch ? tmplMatch[1] : name;
  const templateFile = path.join(root, '.harness', 'workflows', upstreamName, 'workflow.yaml');
  if (!fs.existsSync(templateFile)) {
    console.error(`[workflow-init] 通用模板不存在（${upstreamName} 无上游可同步）`);
    process.exit(2);
  }

  const template = parseWorkflowFile(templateFile, upstreamName);
  const project = loadWorkflowDefinition(root, name);
  const { added, kept } = diffWorkflow(template, project);

  console.log(`[workflow-init] sync ${name}（上游模板 ${upstreamName} → 项目副本）`);

  // 1) 插件专属 skill 同步：模板 .harness/skills/{upstreamName}/ → 项目副本 skills/（缺则补）
  const projectFile = findWorkflowFile(root, name).file;
  const targetDir = path.dirname(projectFile);
  const tplOwnSkillDir = path.join(root, '.harness', 'skills', upstreamName);
  if (fs.existsSync(tplOwnSkillDir) && !fs.existsSync(path.join(targetDir, 'skills'))) {
    fs.cpSync(tplOwnSkillDir, path.join(targetDir, 'skills'), { recursive: true });
    console.log(`  [插件 skill] 已同步插件专属 skill → ${path.relative(root, path.join(targetDir, 'skills'))}/`);
  }

  // 2) 路径规范化自动修正（.md → /SKILL.md、插件专属 → 项目内）
  normalizeSkillPaths(root, projectFile, name, name);

  // 字段级差异输出（added 需补齐，kept 为项目定制保留；agent/用户按提示处理）
  if (added.length > 0) {
    console.log(`  需补齐（模板有、项目缺）${added.length} 项：`);
    for (const a of added) console.log(`    + ${a}`);
    console.log('  参考：模板文件 ' + path.relative(root, templateFile));
  } else {
    console.log('  无缺失字段，项目副本完整');
  }
  if (kept.length > 0) {
    console.log(`  项目定制保留 ${kept.length} 项：`);
    for (const k of kept) console.log(`    ~ ${k}`);
  } else {
    console.log('  无项目定制差异');
  }
  if (added.length === 0 && kept.length === 0) {
    console.log('  ✓ 项目副本与模板一致');
  }
}

function cmdList(root) {
  const workflows = listWorkflows(root);
  if (workflows.length === 0) {
    console.log('无可用工作流');
    return;
  }
  console.log(`可用工作流（${workflows.length}）：`);
  for (const w of workflows) {
    console.log(`  ${w.name.padEnd(20)} source=${w.source.padEnd(7)} stages=${w.stages}`);
  }
}

function main() {
  const root = findHarnessRoot(process.cwd());
  if (!root) {
    console.error('未找到 harness 根（无 .harness 目录）');
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const sub = args[0];
  const name = args[1];
  const asName = getArg('as');
  const force = args.includes('--force');

  if (sub === 'init') {
    if (!name) {
      console.error('用法：node workflow-init.js init <name> [--as <new-name>] [--force]');
      process.exit(2);
    }
    cmdInit(root, name, asName, force);
  } else if (sub === 'sync') {
    if (!name) {
      console.error('用法：node workflow-init.js sync <name>');
      process.exit(2);
    }
    cmdSync(root, name);
  } else if (sub === 'list') {
    cmdList(root);
  } else {
    console.error('用法：node workflow-init.js <init|sync|list> ...');
    process.exit(2);
  }
}

main();
