#!/usr/bin/env node

/**
 * install.js — harness hook 安装器（跨 CLI 注册）
 *
 * 用法：
 *   node .harness/hooks/install.js                 # 自动检测本机 CLI，全部注册（项目级）
 *   node .harness/hooks/install.js --cli=codex     # 只注册到 Codex
 *   node .harness/hooks/install.js --scope=user    # 注册到用户级配置（所有项目生效）
 *
 * 支持的 CLI：
 *   qoder     -> <root>/.qoder/settings.json（项目）或 ~/.qoder-cn/settings.json（用户）
 *   claude    -> <root>/.claude/settings.json（项目）或 ~/.claude/settings.json（用户）
 *   codex     -> <root>/.codex/config.toml（项目）或 ~/.codex/config.toml（用户）
 *   workbuddy -> <root>/.codebuddy/settings.json（项目）或 ~/.workbuddy/settings.json（用户）[WorkBuddy/CodeBuddy 桌面版，hook 契约与 Claude Code 同构]
 *   codebuddy -> 同上（CodeBuddy CLI，配置在 ~/.codebuddy/settings.json）
 *
 * 注：workbuddy / codebuddy 与 Claude Code 共享同一套 hook 契约（事件名 + stdin JSON + exit 2 阻断），
 *     因此直接复用 JSON_HOOKS 模板，无需为不同宿主复制 hook 逻辑。
 *
 * 合并策略：读现有配置 -> 按 hook name 去重合并 -> 备份原文件 -> 写回。
 * 一组脚本（hooks/*.js）随 submodule 分发，install.js 按 CLI 生成对应注册格式。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS_DIR = path.join(__dirname); // 本脚本所在目录即 hooks/
const REL = p => path.relative(process.cwd(), p) || p;

// ---------------------------------------------------------------- 配置模板

// 同一套 hook 适配所有宿主：事件名/matcher/脚本均与 Claude Code 同构。
// user 级用绝对路径（跨项目可用），project 级用相对路径（harness 作为 submodule 内嵌项目）。
function buildJsonHooks(scope) {
  const cmd = script => scope === 'user'
    ? `node ${path.join(HOOKS_DIR, script)}`
    : `node ${REL(path.join(HOOKS_DIR, script))}`;
  return {
    PostToolUse: [
      {
        matcher: 'Bash|Write|Edit|apply_patch',
        hooks: [{ type: 'command', command: cmd('post-tool-log.js'), name: 'harness-post-tool-log', async: true, statusMessage: 'harness: 记录工具调用' }],
      },
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: cmd('check-verify.js'), name: 'harness-check-verify', timeout: 10, statusMessage: 'harness: 检查验证命令' }],
      },
      {
        matcher: 'Write|Edit',
        hooks: [{ type: 'command', command: cmd('gate-check.js'), name: 'harness-gate-check', timeout: 10, statusMessage: 'harness: 阶段产出校验' }],
      },
    ],
    Stop: [
      {
        hooks: [{ type: 'command', command: cmd('gate-check.js'), name: 'harness-gate-check-stop', timeout: 10, statusMessage: 'harness: 收尾校验' }],
      },
    ],
  };
}

// Codex 用 TOML，事件键 PascalCase，数组表结构
function tomlHookLines() {
  const lines = ['# Harness hooks（由 .harness/hooks/install.js 生成，勿手改）'];
  const events = [
    ['PostToolUse', 'Bash|Write|Edit|apply_patch', 'post-tool-log.js', true, null],
    ['PostToolUse', 'Bash', 'check-verify.js', false, 10],
    ['PostToolUse', 'Write|Edit', 'gate-check.js', false, 10],
    ['Stop', null, 'gate-check.js', false, 10],
  ];
  for (const [event, matcher, script, isAsync, timeout] of events) {
    lines.push('');
    lines.push(`[[hooks.${event}]]`);
    if (matcher) lines.push(`matcher = "${matcher}"`);
    lines.push(`[[hooks.${event}.hooks]]`);
    lines.push(`type = "command"`);
    lines.push(`command = "node ${REL(path.join(HOOKS_DIR, script))}"`);
    if (isAsync) lines.push(`async = true`);
    if (timeout) lines.push(`timeout = ${timeout}`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- 检测

function detectCLIs() {
  const found = [];
  const home = os.homedir();
  if (fs.existsSync(path.join(home, '.qoder-cn'))) found.push('qoder');
  if (fs.existsSync(path.join(home, '.claude'))) found.push('claude');
  if (fs.existsSync(path.join(home, '.codex'))) found.push('codex');
  if (fs.existsSync(path.join(home, '.workbuddy'))) found.push('workbuddy');
  if (fs.existsSync(path.join(home, '.codebuddy'))) found.push('codebuddy');
  if (found.length === 0) {
    // 兜底：按 PATH 检测命令
    const pathDirs = (process.env.PATH || '').split(':');
    const hasCmd = cmd => pathDirs.some(dir => fs.existsSync(path.join(dir, cmd)));
    if (hasCmd('qoderclicn') || hasCmd('qoder')) found.push('qoder');
    if (hasCmd('claude')) found.push('claude');
    if (hasCmd('codex')) found.push('codex');
  }
  return found;
}

// ---------------------------------------------------------------- JSON 合并

function mergeJsonHooks(existing, template) {
  const out = { ...existing };
  for (const [event, groups] of Object.entries(template)) {
    const current = Array.isArray(out[event]) ? out[event] : [];
    const currentByName = new Set(
      current.flatMap(g => (g.hooks || []).map(h => h.name).filter(Boolean))
    );
    const added = [];
    for (const group of groups) {
      const newHooks = (group.hooks || []).filter(h => !currentByName.has(h.name));
      if (newHooks.length === 0) continue;
      added.push({ ...group, hooks: newHooks });
    }
    if (added.length > 0) out[event] = [...current, ...added];
  }
  return out;
}

function writeJsonConfig(filePath, template) {
  const backup = backupFile(filePath);
  let existing = {};
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      throw new Error(`现有配置不是合法 JSON：${filePath}（${e.message}），已备份未覆盖`);
    }
  }
  const merged = mergeJsonHooks(existing.hooks || {}, template);
  const result = { ...existing, hooks: merged };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  return { backup, hookCount: countJsonHooks(merged) };
}

function countJsonHooks(hooks) {
  return Object.values(hooks).flat().reduce((n, g) => n + (g.hooks ? g.hooks.length : 0), 0);
}

// ---------------------------------------------------------------- TOML

function writeTomlConfig(filePath, hookLines) {
  const backup = backupFile(filePath);
  const marker = '# Harness hooks';
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing.includes(marker)) {
      return { backup, hookCount: 4, appended: false, skipped: true };
    }
    if (/\[hooks\]|\[hooks\./.test(existing)) {
      // 已有其他 hooks 段：备份后追加（无法安全合并数组表，提示用户检查）
      fs.appendFileSync(filePath, '\n' + hookLines, 'utf8');
      return { backup, hookCount: 4, appended: true };
    }
    fs.appendFileSync(filePath, '\n' + hookLines, 'utf8');
    return { backup, hookCount: 4, appended: true };
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, hookLines, 'utf8');
  return { backup, hookCount: 4, appended: false };
}

// ---------------------------------------------------------------- 工具

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const bak = `${filePath}.bak-${ts}`;
  fs.copyFileSync(filePath, bak);
  return bak;
}

// ---------------------------------------------------------------- 主流程

function main() {
  const args = process.argv.slice(2);
  const getArg = name => {
    const a = args.find(x => x.startsWith(`--${name}=`));
    return a ? a.split('=')[1] : null;
  };
  const cliFilter = getArg('cli') || 'auto';
  const scope = getArg('scope') || 'project';

  const detected = detectCLIs();
  let targets;
  if (cliFilter === 'auto') {
    targets = detected;
  } else {
    // 显式指定：尊重用户意图，不要求本机已检测到（可能配置在别的机器/目录）
    targets = [cliFilter];
  }
  if (targets.length === 0) {
    console.error('未检测到任何支持的 CLI（qoder / claude / codex / workbuddy / codebuddy），注册不了 hook');
    process.exit(1);
  }

  const root = process.cwd();
  const home = os.homedir();
  const jsonTemplate = buildJsonHooks(scope);
  const tomlContent = tomlHookLines();
  const report = [];

  for (const cli of targets) {
    try {
      let filePath, result;
      if (cli === 'qoder') {
        filePath = scope === 'user' ? path.join(home, '.qoder-cn', 'settings.json') : path.join(root, '.qoder', 'settings.json');
        result = writeJsonConfig(filePath, jsonTemplate);
      } else if (cli === 'claude') {
        filePath = scope === 'user' ? path.join(home, '.claude', 'settings.json') : path.join(root, '.claude', 'settings.json');
        result = writeJsonConfig(filePath, jsonTemplate);
      } else if (cli === 'workbuddy' || cli === 'codebuddy') {
        const base = cli === 'workbuddy' ? '.workbuddy' : '.codebuddy';
        filePath = scope === 'user' ? path.join(home, base, 'settings.json') : path.join(root, base, 'settings.json');
        result = writeJsonConfig(filePath, jsonTemplate);
      } else {
        filePath = scope === 'user' ? path.join(home, '.codex', 'config.toml') : path.join(root, '.codex', 'config.toml');
        result = writeTomlConfig(filePath, tomlContent);
      }
      report.push({
        cli,
        file: filePath,
        hooks: result.hookCount,
        backup: result.backup,
        appended: result.appended,
      });
    } catch (e) {
      report.push({ cli, error: e.message });
    }
  }

  console.log(`[harness hook install] scope=${scope}\n`);
  for (const r of report) {
    if (r.error) {
      console.log(`  ${r.cli}: 失败 - ${r.error}`);
    } else {
      console.log(`  ${r.cli}: ${r.hooks} 个 hook 已写入 ${REL(r.file)}`);
      if (r.backup) console.log(`    备份原文件: ${REL(r.backup)}`);
      if (r.appended) console.log('    注：原配置已含 hooks 段，本次以追加方式合并，请人工检查重复项');
    }
  }
  console.log('\n注册的 hook：');
  console.log('  PostToolUse(Bash|Write|Edit|apply_patch) -> post-tool-log.js（异步记账）');
  console.log('  PostToolUse(Bash)                         -> check-verify.js（绕过提醒）');
  console.log('  PostToolUse(Write|Edit)                    -> gate-check.js（产出校验）');
  console.log('  Stop                                      -> gate-check.js（收尾校验）');
}

main();
