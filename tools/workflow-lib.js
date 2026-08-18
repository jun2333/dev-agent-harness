#!/usr/bin/env node

/**
 * workflow-lib.js — 工作流插件包加载与 verify 手段解析（gate-check / verify / workflow-init 共享）
 *
 * 职责：
 *   - loadWorkflowDefinition(root, workflowName)：按"项目层优先 → 通用兜底"解析工作流插件包
 *     （simple-yaml 解析，零依赖），返回 { name, description, stages, verify, source }
 *   - listWorkflows(root)：扫描两处目录（knowledge/plugins + .harness/workflows），返回全部可用工作流
 *   - resolveVerifyCommands(root, wfDef)：把 workflow 的 verify.checks 解析为实际命令数组
 *     内置 check（skill-check/workflow-check）→ node .harness/tools/{name}.js
 *     命令池 key（unit/lint/e2e）→ knowledge/verify.config.json 的 commands[key]
 *
 * 模板语义：通用工作流（.harness/workflows/）是模板（骨架），项目层（knowledge/plugins/）
 * 是定制实例；同名项目版覆盖通用版。他证原则：命令来源只能是工作流声明 + 项目命令池。
 */

const fs = require('fs');
const path = require('path');
const yaml = require('../hooks/simple-yaml.js');

const VERIFY_CONFIG_REL = path.join('knowledge', 'verify.config.json');
const PROJECT_PLUGINS_DIR = 'knowledge/plugins'; // 项目层插件目录（项目根，git 跟踪）
const HARNESS_WORKFLOWS_DIR = path.join('.harness', 'workflows'); // 通用层模板目录

/** 查找某工作流插件包文件（项目层优先），返回 { file, source } 或 null */
function findWorkflowFile(root, workflowName) {
  const projectFile = path.join(root, PROJECT_PLUGINS_DIR, workflowName, 'workflow.yaml');
  if (fs.existsSync(projectFile)) return { file: projectFile, source: 'project' };
  const harnessFile = path.join(root, HARNESS_WORKFLOWS_DIR, workflowName, 'workflow.yaml');
  if (fs.existsSync(harnessFile)) return { file: harnessFile, source: 'harness' };
  return null;
}

/** 加载工作流插件包定义（项目层优先 → 通用兜底）；缺失返回 null */
function loadWorkflowDefinition(root, workflowName) {
  if (!workflowName) return null;
  const found = findWorkflowFile(root, workflowName);
  if (!found) return null;
  let doc;
  try {
    doc = yaml.parse(fs.readFileSync(found.file, 'utf8'));
  } catch {
    return null;
  }
  const stages = {};
  for (const s of Array.isArray(doc.stages) ? doc.stages : []) {
    if (s && s.name) stages[s.name] = s;
  }
  return {
    name: doc.name || workflowName,
    description: doc.description || '',
    stages,
    verify: doc.verify || { checks: [] },
    source: found.source,
  };
}

/** 列出全部可用工作流（项目层 + 通用层），返回 [{ name, source, stages }] */
function listWorkflows(root) {
  const result = [];
  const seen = new Set();
  // 项目层优先
  const projectDir = path.join(root, PROJECT_PLUGINS_DIR);
  if (fs.existsSync(projectDir)) {
    for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const def = loadWorkflowDefinition(root, entry.name);
      if (def && def.source === 'project') {
        result.push({ name: entry.name, source: 'project', stages: Object.keys(def.stages).length });
        seen.add(entry.name);
      }
    }
  }
  const harnessDir = path.join(root, HARNESS_WORKFLOWS_DIR);
  if (fs.existsSync(harnessDir)) {
    for (const entry of fs.readdirSync(harnessDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      const def = loadWorkflowDefinition(root, entry.name);
      if (def && def.source === 'harness') {
        result.push({ name: entry.name, source: 'harness', stages: Object.keys(def.stages).length });
      }
    }
  }
  return result;
}

/**
 * 查找工作流插件包 check/ 下的校验脚本（项目层优先 → 通用层）。
 * @returns {string|null} 绝对路径或 null
 */
function findCheckScript(root, workflowName, checkName) {
  const projectFile = path.join(root, PROJECT_PLUGINS_DIR, workflowName, 'check', `${checkName}.js`);
  if (fs.existsSync(projectFile)) return projectFile;
  const harnessFile = path.join(root, HARNESS_WORKFLOWS_DIR, workflowName, 'check', `${checkName}.js`);
  if (fs.existsSync(harnessFile)) return harnessFile;
  return null;
}

/**
 * 解析 verify.checks → 实际命令数组。
 * 解析顺序（每个 check）：
 *   1. 当前工作流插件包的 check/{check}.js（项目层优先 → 通用层）——插件自带校验脚本
 *   2. 项目命令池 key（knowledge/verify.config.json 的 commands[key]）
 *   3. 都无法解析 → 报错（他证：命令来源只能是插件包脚本或命令池）
 * @returns {string[]|null} checks 为空返回 null；有未解析手段抛错
 */
function resolveVerifyCommands(root, wfDef) {
  const checks = (wfDef && wfDef.verify && wfDef.verify.checks) || [];
  if (!Array.isArray(checks) || checks.length === 0) return null;

  const cfg = readVerifyConfig(root);
  const pool = {};
  if (cfg && cfg.commands && typeof cfg.commands === 'object' && !Array.isArray(cfg.commands)) {
    Object.assign(pool, cfg.commands);
  }

  const cmds = [];
  const unresolved = [];
  for (const check of checks) {
    const checkFile = wfDef && wfDef.name ? findCheckScript(root, wfDef.name, check) : null;
    if (checkFile) {
      cmds.push(`node ${checkFile}`);
      continue;
    }
    if (typeof pool[check] === 'string' && pool[check]) {
      cmds.push(pool[check]);
      continue;
    }
    unresolved.push(check);
  }
  if (unresolved.length > 0) {
    throw new Error(
      `工作流 verify 手段无法解析：${unresolved.join(', ')}（检查 workflow.yaml 的 checks 是否对应插件包 check/ 脚本或 ${VERIFY_CONFIG_REL} 命令池 key）`
    );
  }
  return cmds;
}

/** 读项目命令池配置（不存在返回 null） */
function readVerifyConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, VERIFY_CONFIG_REL), 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  loadWorkflowDefinition,
  listWorkflows,
  resolveVerifyCommands,
  readVerifyConfig,
  findWorkflowFile,
  findCheckScript,
  VERIFY_CONFIG_REL,
  PROJECT_PLUGINS_DIR,
  HARNESS_WORKFLOWS_DIR,
};
