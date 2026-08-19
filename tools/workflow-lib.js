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
const PROJECT_PLUGINS_DIR = 'knowledge/plugins'; // 项目插件目录（项目根，git 跟踪，唯一插件来源）
const HARNESS_WORKFLOWS_DIR = path.join('.harness', 'workflows'); // 内置插件 = 模板源（不再直接使用）

/**
 * 边界检查：knowledge/plugins 目录必须存在（项目知识库插件是唯一插件来源）。
 * 缺失时抛错给 LLM——提示先初始化/复制插件，而不是静默降级。
 */
function checkPluginsDir(root) {
  if (!fs.existsSync(path.join(root, 'knowledge')) || !fs.existsSync(path.join(root, PROJECT_PLUGINS_DIR))) {
    throw new Error(
      `未找到项目插件目录：${PROJECT_PLUGINS_DIR} 不存在。` +
        `内置插件（.harness/workflows/）不再直接使用，请先运行 knowledge-init 初始化知识库，` +
        `或 workflow-init init <name> 复制内置插件到 ${PROJECT_PLUGINS_DIR}/`
    );
  }
}

/** 查找某工作流插件包文件（只读项目知识库 knowledge/plugins/）；缺失返回 null */
function findWorkflowFile(root, workflowName) {
  const projectFile = path.join(root, PROJECT_PLUGINS_DIR, workflowName, 'workflow.yaml');
  if (fs.existsSync(projectFile)) return { file: projectFile, source: 'project' };
  return null;
}

/** 加载工作流插件包定义（只读项目知识库）；缺失抛错给 LLM（边界检查） */
function loadWorkflowDefinition(root, workflowName) {
  if (!workflowName) return null;
  const found = findWorkflowFile(root, workflowName);
  if (!found) {
    checkPluginsDir(root); // knowledge/plugins 不存在 → 明确抛错
    throw new Error(
      `未找到工作流插件：${workflowName}（${PROJECT_PLUGINS_DIR}/ 下无该插件）。` +
        `请先运行 workflow-init init ${workflowName} 复制内置插件，或检查插件名`
    );
  }
  let doc;
  try {
    doc = yaml.parse(fs.readFileSync(found.file, 'utf8'));
  } catch (e) {
    throw new Error(`工作流插件解析失败：${found.file}（${e.message}）`);
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
    pre_task: doc.pre_task || [],
    post_task: doc.post_task || [],
    source: found.source,
  };
}

/** 列出全部可用工作流（只读项目知识库 knowledge/plugins/） */
function listWorkflows(root) {
  const result = [];
  const projectDir = path.join(root, PROJECT_PLUGINS_DIR);
  if (!fs.existsSync(projectDir)) return result; // 未初始化则空（调用方据此提示 knowledge-init）
  for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const def = loadWorkflowDefinition(root, entry.name);
    if (def && def.source === 'project') {
      result.push({ name: entry.name, source: 'project', stages: Object.keys(def.stages).length });
    }
  }
  return result;
}

/**
 * 查找工作流插件包 check/ 下的校验脚本（只读项目知识库）。
 * @returns {string|null} 绝对路径或 null
 */
function findCheckScript(root, workflowName, checkName) {
  const projectFile = path.join(root, PROJECT_PLUGINS_DIR, workflowName, 'check', `${checkName}.js`);
  if (fs.existsSync(projectFile)) return projectFile;
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
