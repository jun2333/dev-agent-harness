#!/usr/bin/env node

/**
 * workflow-lib.js — 工作流插件包加载与 verify 手段解析（gate-check / verify 共享）
 *
 * 职责：
 *   - loadWorkflowDefinition(root, workflowName)：加载 .harness/workflows/{name}/workflow.yaml
 *     （simple-yaml 解析，零依赖），返回 { name, stages: {stageName: def}, verify }
 *   - resolveVerifyCommands(root, wfDef)：把 workflow 的 verify.checks 解析为实际命令数组
 *     内置 check（skill-check）→ node .harness/tools/{name}.js
 *     命令池 key（unit/lint/e2e）→ knowledge/verify.config.json 的 commands[key]
 *
 * 他证原则：命令来源只能是工作流 verify 声明 + 项目命令池，LLM 不能自选。
 */

const fs = require('fs');
const path = require('path');
const yaml = require('../hooks/simple-yaml.js');

const VERIFY_CONFIG_REL = path.join('knowledge', 'verify.config.json');

/** 加载工作流插件包定义；缺失返回 null */
function loadWorkflowDefinition(root, workflowName) {
  if (!workflowName) return null;
  const file = path.join(root, '.harness', 'workflows', workflowName, 'workflow.yaml');
  if (!fs.existsSync(file)) return null;
  let doc;
  try {
    doc = yaml.parse(fs.readFileSync(file, 'utf8'));
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
  };
}

/**
 * 解析 verify.checks → 实际命令数组。
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
    if (check === 'skill-check') {
      cmds.push(`node ${path.join(root, '.harness', 'tools', 'skill-check.js')}`);
      continue;
    }
    if (check === 'workflow-check') {
      cmds.push(`node ${path.join(root, '.harness', 'tools', 'workflow-check.js')}`);
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
      `工作流 verify 手段无法解析：${unresolved.join(', ')}（检查 workflow.yaml 的 checks 与 ${VERIFY_CONFIG_REL} 命令池）`
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

module.exports = { loadWorkflowDefinition, resolveVerifyCommands, readVerifyConfig, VERIFY_CONFIG_REL };
