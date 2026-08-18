#!/usr/bin/env node

/**
 * dsh/install.js — DSH 目标安装器（第三目标，与 hooks/install.js --cli=dsh 对称）
 *
 * 用法：
 *   node .harness/dsh/install.js              # 复制 preset 到 ~/.dsh/.agent-presets/
 *   node .harness/dsh/install.js --dry-run    # 只打印将要做什么，不写入
 *
 * 行为：
 *   - 把 dsh/preset/harness.preset.md 复制到 ~/.dsh/.agent-presets/harness.preset.md
 *   - 目标已存在同名文件时先备份（.bak-时间戳）再覆盖
 *   - 只操作 preset 文件本身，不触碰 DSH 其他配置（插件注册/工具注册留待验证后补）
 *
 * 注意：
 *   - preset 清单格式为草案，需按 ~/.dsh/.agent-presets 实际 schema 验证后再启用
 *   - 默认预设由用户在 GUI 中选择，本脚本不修改
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PRESET_SOURCE = path.join(__dirname, 'preset', 'harness.preset.md');
const PRESET_NAME = 'harness.preset.md';
const PRESET_DIR = path.join(os.homedir(), '.dsh', '.agent-presets');
const PRESET_TARGET = path.join(PRESET_DIR, PRESET_NAME);

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const bak = `${filePath}.bak-${ts}`;
  fs.copyFileSync(filePath, bak);
  return bak;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!fs.existsSync(PRESET_SOURCE)) {
    console.error(`preset 文件不存在：${PRESET_SOURCE}`);
    process.exit(1);
  }

  console.log(`[dsh install] target=${PRESET_TARGET}${dryRun ? ' (dry-run)' : ''}`);
  if (dryRun) {
    console.log('  将复制 preset → ~/.dsh/.agent-presets/（已存在则先备份）');
    console.log('  完成后在 DSH GUI 的新建会话预设选择器中选择「Harness Mode」');
    console.log('  注意：preset 格式为草案，需按实际 schema 验证后再启用');
    return;
  }

  fs.mkdirSync(PRESET_DIR, { recursive: true });
  const backup = backupFile(PRESET_TARGET);
  fs.copyFileSync(PRESET_SOURCE, PRESET_TARGET);
  console.log(`  preset 已写入 ${PRESET_TARGET}`);
  if (backup) console.log(`  已备份原文件：${backup}`);
  console.log('\n下一步：');
  console.log('  1. 在 DSH GUI 新建会话，预设选择器中选择「Harness Mode」');
  console.log('  2. 验证前先核对 dsh/preset/harness.preset.md 的「待验证项」清单');
  console.log('  3. 工作区选为目标项目根目录（含 .harness submodule）');
}

main();
