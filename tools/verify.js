#!/usr/bin/env node

/**
 * Harness Verification Tool
 *
 * 强制执行验证命令并捕获真实结果，防止 AI 跳过或伪造测试结果。
 *
 * 证据链「他证」原则（v0.4）：
 *   验证命令必须来自项目拥有的机器可读配置 knowledge/verify.config.json
 *   （由 knowledge-init 生成），LLM 不允许通过 --commands 自选命令——
 *   自选命令 = 自证，gate-check 只认项目配置驱动的证据，并对报告命令做对账。
 *
 * 用法：
 *   node verify.js run \
 *     --output-dir .harness/workspace/{task-id}/test-results \
 *     --report .harness/workspace/{task-id}/verify/verification-result.json
 *
 * 配置格式（knowledge/verify.config.json）：
 *   {
 *     "schema_version": "verify.config.v1",
 *     "commands": ["npm run test:unit", "npm run build"],
 *     "timeout_ms": 300000
 *   }
 *
 * 行为：
 *   - 向上查找项目根的 knowledge/verify.config.json，读入命令清单
 *   - 逐个执行命令，捕获真实 exit code / 日志 / 耗时 / 超时
 *   - 结果写入 --report 指定的 verification-result.json（含 config_source 与 config_schema_version）
 *   - 传 --commands 直接报错退出：命令只能来自项目配置
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadWorkflowDefinition, resolveVerifyCommands } = require('./workflow-lib.js');

const CONFIG_NAME = 'verify.config.json';
const CONFIG_REL = path.join('knowledge', CONFIG_NAME);
const CONFIG_SCHEMA = 'verify.config.v1';
const RESULT_SCHEMA = 'verification-result.v1';

/** 从 startDir 向上查找 knowledge/verify.config.json，返回 { configPath, rootDir } */
function findVerifyConfig(startDir) {
  let current = path.resolve(startDir || process.cwd());
  while (true) {
    const candidate = path.join(current, CONFIG_REL);
    if (fs.existsSync(candidate)) {
      return { configPath: candidate, rootDir: current };
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * 解析并校验配置。支持：
 *   v1：commands 为数组（默认命令集）
 *   v2：commands 为对象（命令池 key → 命令，配合工作流 verify.checks 使用）
 */
function readConfig(configPath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    throw new Error(`验证配置解析失败：${configPath}（${e.message}）`);
  }
  const cmds = raw && raw.commands;
  const empty = Array.isArray(cmds)
    ? cmds.length === 0
    : typeof cmds === 'object'
      ? Object.keys(cmds).length === 0
      : true;
  if (!raw || empty) {
    throw new Error(
      `验证配置格式错误：${configPath} 必须包含非空 commands（v1 数组或 v2 命令池对象，schema_version: ${CONFIG_SCHEMA} 或 verify.config.v2）`
    );
  }
  return raw;
}

/** 解析最终执行命令数组：优先 workflow verify 声明，否则 v1 数组默认命令集 */
function resolveCommands(config, workflowName, rootDir) {
  if (workflowName) {
    const wfDef = loadWorkflowDefinition(rootDir, workflowName);
    if (!wfDef) {
      throw new Error(
        `未找到工作流定义：.harness/workflows/${workflowName}/workflow.yaml（verify --workflow 需要它声明 verify.checks）`
      );
    }
    const cmds = resolveVerifyCommands(rootDir, wfDef);
    if (!cmds || cmds.length === 0) {
      throw new Error(
        `工作流 ${workflowName} 未声明 verify.checks（无需运行 verify），或 checks 为空`
      );
    }
    return cmds;
  }
  // 无 --workflow：v1 兼容（commands 数组作为默认命令集）；v2 对象则必须用 --workflow
  if (!config) {
    throw new Error(
      '未找到 knowledge/verify.config.json，且未指定 --workflow——验证命令来源必须是项目配置（命令池）或工作流声明（工作流 check 脚本），LLM 不允许自选'
    );
  }
  if (Array.isArray(config.commands)) return config.commands;
  throw new Error(
    'verify.config.json 使用 v2 命令池（commands 为对象），必须通过 --workflow <name> 指定工作流来解析 verify.checks'
  );
}

/** 执行全部验证命令，产出结构化证据 */
function runVerification(config, configPath, rootDir, outputDir, reportPath, commandsOverride) {
  const results = {
    schema_version: RESULT_SCHEMA,
    generated_at: new Date().toISOString(),
    config_source: configPath ? path.relative(rootDir, configPath) : 'workflow',
    config_schema_version: (config && config.schema_version) || CONFIG_SCHEMA,
    timeout_ms: (config && config.timeout_ms) || 300000,
    commands: [],
    overall_status: 'passed',
    overall_reason: null,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const timeoutMs = (config && config.timeout_ms) || 300000;
  // 兼容测试：不传 commandsOverride 时用 config.commands（v1 数组）
  const cmds = commandsOverride || (Array.isArray(config.commands) ? config.commands : []);

  for (const cmd of cmds) {
    // 日志文件名：命令的非字母数字字符转 '-'（避免绝对路径/空格破坏文件名）
    const logName = String(cmd).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    const logFile = path.join(outputDir, `${logName || 'verify-cmd'}.log`);
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const startTime = Date.now();

    try {
      stdout = execSync(cmd, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: rootDir,
        timeout: timeoutMs,
        killSignal: 'SIGTERM',
      });
    } catch (error) {
      exitCode = error.status || 1;
      stdout = error.stdout || '';
      stderr = error.stderr || '';
      timedOut = !!error.killed || error.signal === 'SIGTERM';
    }

    const duration = Date.now() - startTime;

    fs.writeFileSync(
      logFile,
      `Command: ${cmd}\nExit Code: ${exitCode}\nDuration: ${duration}ms\nTimed Out: ${timedOut}\n\n--- STDOUT ---\n${stdout}\n\n--- STDERR ---\n${stderr}`
    );

    const result = {
      command: cmd,
      exit_code: exitCode,
      status: exitCode === 0 ? 'passed' : 'failed',
      log_path: path.relative(rootDir, logFile),
      duration_ms: duration,
      timed_out: timedOut,
    };

    if (exitCode !== 0) {
      result.error_summary = stderr.split('\n').slice(0, 5).join('\n');
    }

    results.commands.push(result);

    if (exitCode !== 0 && results.overall_status === 'passed') {
      results.overall_status = 'failed';
      results.overall_reason = `${cmd} failed with exit code ${exitCode}`;
    }
  }

  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  return results;
}

// ---------------------------------------------------------------- CLI 入口

function runCli() {
  const args = process.argv.slice(2);
  const subcommand = args[0];

/** 兼容 --flag=value 与 --flag value 两种形式 */
function getArg(name) {
  const eq = args.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] !== undefined) return args[idx + 1];
  return null;
}

if (subcommand !== 'run') {
  console.error('Usage: node verify.js <run> ...');
  console.error('Subcommands:');
  console.error('  run  - 按工作流 verify.checks 解析命令并执行验证（--workflow <name>），无则用配置默认命令集');
  process.exit(1);
}

// 关闭自证漏洞：--commands 直接拒绝
if (getArg('commands')) {
  console.error(
    '[harness verify] 拒绝 --commands：验证命令必须来自项目配置 knowledge/verify.config.json（他证原则）。\n' +
      '如需调整验证命令，请编辑项目配置（knowledge/verify.config.json），不允许在命令行自选命令。'
  );
  process.exit(1);
}

const outputDirArg = getArg('output-dir');
const reportPathArg = getArg('report');
const rootArg = getArg('root');
const workflowArg = getArg('workflow');

if (!outputDirArg || !reportPathArg) {
  console.error('Usage: node verify.js run --output-dir=<dir> --report=<path> [--root=<dir>] [--workflow=<name>]');
  process.exit(1);
}

try {
  // verify.config.json 是可选的：workflow 用纯工作流 check 脚本时不依赖命令池
  // （resolveCommands 里：无配置 + 无 --workflow 会报错；命令池 key 解析失败也会报错）
  const found = findVerifyConfig(rootArg || process.cwd());
  let config = null;
  let configPath = null;
  let rootDir = rootArg ? path.resolve(rootArg) : process.cwd();
  if (found) {
    configPath = found.configPath;
    rootDir = found.rootDir;
    config = readConfig(configPath);
  } else {
    console.warn(`[harness verify] 未找到 ${CONFIG_REL}：若工作流 verify.checks 只用工作流 check 脚本可继续；命令池 key 需要此配置。`);
  }

  const outputDir = path.isAbsolute(outputDirArg)
    ? outputDirArg
    : path.join(rootDir, outputDirArg);
  const reportPath = path.isAbsolute(reportPathArg)
    ? reportPathArg
    : path.join(rootDir, reportPathArg);

  const cmds = resolveCommands(config, workflowArg, rootDir);
  const results = runVerification(config, configPath, rootDir, outputDir, reportPath, cmds);
  console.log(`Verification completed: ${results.overall_status}`);
  console.log(`Commands run (from ${results.config_source}): ${results.commands.length}`);
  for (const c of results.commands) {
    console.log(`  [${c.status}] ${c.command} (${c.duration_ms}ms)${c.timed_out ? ' [timeout]' : ''}`);
  }
  console.log(`Report saved to: ${reportPath}`);

  process.exit(results.overall_status === 'passed' ? 0 : 1);
} catch (e) {
  console.error(`[harness verify] ${e.message}`);
  process.exit(1);
}

}

module.exports = { findVerifyConfig, readConfig, runVerification };

if (require.main === module) runCli();
