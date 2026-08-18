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

/** 解析并校验配置 */
function readConfig(configPath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    throw new Error(`验证配置解析失败：${configPath}（${e.message}）`);
  }
  if (!raw || !Array.isArray(raw.commands) || raw.commands.length === 0) {
    throw new Error(
      `验证配置格式错误：${configPath} 必须包含非空 commands 数组（schema_version: ${CONFIG_SCHEMA}）`
    );
  }
  return raw;
}

/** 执行全部验证命令，产出结构化证据 */
function runVerification(config, configPath, rootDir, outputDir, reportPath) {
  const results = {
    schema_version: RESULT_SCHEMA,
    generated_at: new Date().toISOString(),
    config_source: path.relative(rootDir, configPath),
    config_schema_version: config.schema_version || CONFIG_SCHEMA,
    timeout_ms: config.timeout_ms || 300000,
    commands: [],
    overall_status: 'passed',
    overall_reason: null,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const timeoutMs = config.timeout_ms || 300000;

  for (const cmd of config.commands) {
    const logFile = path.join(outputDir, `${String(cmd).replace(/\s+/g, '-')}.log`);
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
  console.error('  run  - 从 knowledge/verify.config.json 读取命令并执行验证');
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

if (!outputDirArg || !reportPathArg) {
  console.error('Usage: node verify.js run --output-dir=<dir> --report=<path> [--root=<dir>]');
  process.exit(1);
}

try {
  const found = findVerifyConfig(rootArg || process.cwd());
  if (!found) {
    console.error(
      `[harness verify] 未找到 ${CONFIG_REL}：请先运行 knowledge-init 生成项目验证配置（命令是项目拥有的，不允许 LLM 自选）。`
    );
    process.exit(1);
  }
  const { configPath, rootDir } = found;
  const config = readConfig(configPath);

  const outputDir = path.isAbsolute(outputDirArg)
    ? outputDirArg
    : path.join(rootDir, outputDirArg);
  const reportPath = path.isAbsolute(reportPathArg)
    ? reportPathArg
    : path.join(rootDir, reportPathArg);

  const results = runVerification(config, configPath, rootDir, outputDir, reportPath);

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
