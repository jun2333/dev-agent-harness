#!/usr/bin/env node

/**
 * dsh/install.js — DSH 目标安装器（第三目标，与 hooks/install.js --cli=dsh 对称）
 *
 * 用法：
 *   node .harness/dsh/install.js              # 安装 harness preset 到 ~/.dsh/.agent-presets/
 *   node .harness/dsh/install.js --dry-run    # 只打印将要做什么，不写入
 *
 * 行为：
 *   - 把 dsh/preset/harness/ 整个目录复制到 ~/.dsh/.agent-presets/harness/
 *     （preset 是目录：preset.yml 显示元数据 + agent.cordis.yml 组合文件 + NOTICE，
 *      参见 packages/preset/agent-presets 的 discovery/metadata 逻辑）
 *   - 目标已存在同名目录时先备份（.bak-时间戳）再覆盖
 *   - 只操作 preset 目录本身，不触碰 DSH 其他配置（沙箱/审批/持久化归宿主平面）
 *
 * 注意：
 *   - preset id = 目录名（harness），须匹配 /^[a-z0-9][a-z0-9-]*$/
 *   - 沙箱模式是会话级 knob（read-only / workspace-write / danger-full-access），
 *     preset 不配置沙箱；阶段权限映射通过会话默认 + 审批策略落地
 *   - 默认预设由用户在 GUI 中选择，本脚本不修改
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PRESET_SOURCE = path.join(__dirname, 'preset', 'harness');
const PRESET_DIR = path.join(os.homedir(), '.dsh', '.agent-presets');
const PRESET_TARGET = path.join(PRESET_DIR, 'harness');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function backupDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const bak = `${dir}.bak-${ts}`;
  fs.renameSync(dir, bak);
  return bak;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!fs.existsSync(path.join(PRESET_SOURCE, 'agent.cordis.yml'))) {
    console.error(`preset 组合文件缺失：${path.join(PRESET_SOURCE, 'agent.cordis.yml')}`);
    process.exit(1);
  }

  console.log(`[dsh install] target=${PRESET_TARGET}${dryRun ? ' (dry-run)' : ''}`);
  if (dryRun) {
    console.log('  将复制 dsh/preset/harness/ 目录 → ~/.dsh/.agent-presets/harness/（已存在则先备份）');
    console.log('  完成后在 DSH GUI 的新建会话预设选择器中选择「Harness 模式」');
    return;
  }

  const backup = backupDir(PRESET_TARGET);
  copyDir(PRESET_SOURCE, PRESET_TARGET);
  console.log(`  preset 已写入 ${PRESET_TARGET}`);
  if (backup) console.log(`  已备份原目录：${backup}`);

  console.log('\n下一步：');
  console.log('  1. 在 DSH GUI 新建会话，预设选择器中选择「Harness 模式」');
  console.log('  2. 工作区选为目标项目根目录（含 .harness submodule）');
  console.log('  3. 会话权限建议：workspace-write（实施阶段需要写）；危险操作走审批');
  console.log('  4. 验证编排流：给一个任务，观察是否按 子代理分阶段 + ask_user_question 门禁 执行');
}

main();
