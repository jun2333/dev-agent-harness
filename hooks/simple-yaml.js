#!/usr/bin/env node

/**
 * simple-yaml.js — 零依赖 YAML 子集解析器（仅用于 harness workflow.yaml）
 *
 * 动机：gate-check.js / verify.js 需要读取工作流工作流的 workflow.yaml，
 * 但 hook 运行环境（WorkBuddy/CLI 沙箱）不能假设 node_modules 已安装，
 * 因此提供零依赖的最小 YAML 解析，覆盖 harness workflow 定义用到的子集：
 *   - 缩进块：map（key: value）、list（- item，item 可为 map/标量）
 *   - flow 数组：行内 [a, b, [c, d]]（支持嵌套，用于 input/sections）
 *   - 标量：字符串（含单双引号）、布尔、数字、空
 *   - 注释：# 开头行（整行注释；行内注释不支持，workflow.yaml 不使用）
 *
 * 用法：const yaml = require('./simple-yaml.js'); const doc = yaml.parse(str);
 */

function parseFlowValue(text) {
  // 解析 flow 数组 [a, b] 或嵌套 [[a], [b]]；标量直接返回
  text = text.trim();
  if (text.startsWith('[')) {
    const inner = text.slice(1, -1);
    const items = [];
    let depth = 0;
    let cur = '';
    let inStr = null;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (inStr) {
        if (ch === inStr) inStr = null;
        cur += ch;
        continue;
      }
      if (ch === '"' || ch === "'") { inStr = ch; cur += ch; continue; }
      if (ch === '[') depth++;
      if (ch === ']') depth--;
      if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) items.push(cur.trim());
    return items.map(parseFlowValue);
  }
  return parseScalar(text);
}

function parseScalar(text) {
  text = text.trim();
  if (text === '') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return parseInt(text, 10);
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1);
  return text;
}

/**
 * 缩进驱动的块解析。
 * lines: [{ indent, text }]；返回 { value, consumed }（递归用）。
 */
function parseBlock(lines, index, indent) {
  // 返回值：{ result, nextIndex }，result 为当前缩进层的 map 或 list
  const result = {};
  let i = index;
  let currentKey = null;
  let currentList = null;

  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;            // 缩进回退：本层结束
    if (line.indent > indent) {
      // 子块：属于上一个 key 或 list 项
      if (currentKey !== null && !(result[currentKey] instanceof Array)) {
        const child = parseBlock(lines, i, line.indent);
        result[currentKey] = child.result;
        i = child.nextIndex;
        currentKey = null;
        continue;
      }
      if (currentList !== null && currentList.length > 0 && typeof currentList[currentList.length - 1] === 'object') {
        const child = parseBlock(lines, i, line.indent);
        const last = currentList[currentList.length - 1];
        Object.assign(last, child.result);
        i = child.nextIndex;
        continue;
      }
      // 无法归属：跳到同缩进
      i++;
      continue;
    }

    const text = line.text;
    if (text.startsWith('- ')) {
      // list 项
      const itemText = text.slice(2).trim();
      if (currentList === null) {
        // 把 result 变成 list（当前层是 list）
        currentList = [];
      }
      if (itemText.includes(':') && !itemText.startsWith('[')) {
        // map 项开始（- key: value）
        const idx = itemText.indexOf(':');
        const key = itemText.slice(0, idx).trim();
        const valueText = itemText.slice(idx + 1).trim();
        const item = {};
        item[key] = valueText === '' ? {} : parseFlowValue(valueText);
        currentList.push(item);
      } else {
        currentList.push(parseFlowValue(itemText));
      }
      i++;
      continue;
    }

    if (text.includes(':')) {
      const idx = text.indexOf(':');
      const key = text.slice(0, idx).trim();
      const valueText = text.slice(idx + 1).trim();
      if (valueText === '') {
        result[key] = {};
        currentKey = key;
      } else {
        result[key] = parseFlowValue(valueText);
      }
      i++;
      continue;
    }

    // 无法解析的行：跳过
    i++;
  }

  if (currentList !== null) return { result: currentList, nextIndex: i };
  return { result, nextIndex: i };
}

function parse(str) {
  const lines = [];
  for (const raw of String(str || '').split('\n')) {
    // 只支持整行注释（^#）。不做行内注释剥除：flow 数组里的 Markdown 标题
    // （如 [## Summary]）的 # 前可能是空白，误删会导致 sections 解析丢失。
    const noComment = raw.replace(/^\s*#.*$/, '').trimEnd();
    if (!noComment.trim()) continue;
    const indent = noComment.length - noComment.trimStart().length;
    lines.push({ indent, text: noComment.trim() });
  }
  if (lines.length === 0) return {};
  const { result } = parseBlock(lines, 0, 0);
  return result;
}

module.exports = { parse, parseFlowValue, parseScalar };
