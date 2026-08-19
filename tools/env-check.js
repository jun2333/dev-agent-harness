#!/usr/bin/env node

/**
 * Harness Environment Check Tool
 *
 * 任务开始前检查环境就绪状态，防止设计阶段基于错误假设开工
 * （LESSON 4：设计阶段假设环境已就绪，实际 PG 未装 / .env 缺失 / Prisma 未 migrate）。
 *
 * 他证原则（与 verify.js 一致）：
 *   检查命令必须来自项目拥有的机器可读配置 knowledge/env-check.config.json
 *   （由 knowledge-init 生成），LLM 不允许通过 --commands 自选命令。
 *
 * 用法：
 *   node env-check.js run \
 *     --task-id <task-id> \
 *     --root <project-root>
 *
 * 配置格式（knowledge/env-check.config.json）：
 *   {
 *     "schema_version": "env-check.v1",
 *     "checks": [
 *       { "name": "node-version", "command": "node -v" },
 *       { "name": "env-file", "command": "test -f .env" }
 *     ],
 *     "timeout_ms": 30000
 *   }
 *   checks 也兼容字符串数组（无 name 时用命令前 30 字符作 name）。
 *
 * 行为：
 *   - 向上查找项目根的 knowledge/env-check.config.json
 *   - 逐个执行检查命令，捕获真实 exit code / 输出 / 耗时 / 超时
 *   - 人类可读快照写入 workspace/{task-id}/env-check.md
 *   - 机器可读结果写入 workspace/{task-id}/env-check/result.json
 *   - 全部通过退出 0，任一失败退出 1
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_NAME = 'env-check.config.json';
const CONFIG_REL = path.join('knowledge', CONFIG_NAME);
const CONFIG_SCHEMA = 'env-check.v1';
const RESULT_SCHEMA = 'env-check-result.v1';

/** 从 startDir 向上查找 knowledge/env-check.config.json，返回 { configPath, rootDir } */
function findEnvCheckConfig(startDir) {
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

/** 解析并校验配置；checks 归一化为 { name, command } 数组 */
function readConfig(configPath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    throw new Error(`环境检查配置解析失败：${configPath}（${e.message}）`);
  }
  const rawChecks = raw && raw.checks;
  if (!Array.isArray(rawChecks) || rawChecks.length === 0) {
    throw new Error(
      `环境检查配置格式错误：${configPath} 必须包含非空 checks（对象数组 {name,command} 或字符串命令数组，schema_version: ${CONFIG_SCHEMA}）`
    );
  }
  const checks = rawChecks.map((c) => {
    if (typeof c === 'string') {
      return { name: c.slice(0, 30).replace(/[^a-zA-Z0-9._-]+/g, '-'), command: c };
    }
    if (c && typeof c.command === 'string' && c.command) {
      return { name: (c.name || c.command.slice(0, 30)).replace(/[^a-zA-Z0-9._-]+/g, '-'), command: c.command };
    }
    throw new Error(`环境检查配置格式错误：checks 项必须是 {name, command} 对象或命令字符串（${configPath}）`);
  });
  return { schema_version: raw.schema_version || CONFIG_SCHEMA, checks, timeout_ms: raw.timeout_ms || 30000 };
}

/** 执行全部检查命令，返回结果对象（含机器数据 + markdown 快照文本） */
function runEnvChecks(config, configPath, rootDir, taskId) {
  const results = {
    schema_version: RESULT_SCHEMA,
    generated_at: new Date().toISOString(),
    config_source: path.relative(rootDir, configPath),
    config_schema_version: config.schema_version,
    timeout_ms: config.timeout_ms,
    task_id: taskId,
    checks: [],
    overall_status: 'passed',
    overall_reason: null,
  };

  for (const check of config.checks) {
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const startTime = Date.now();

    try {
      stdout = execSync(check.command, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: rootDir,
        timeout: config.timeout_ms,
        killSignal: 'SIGTERM',
      });
    } catch (error) {
      exitCode = error.status || 1;
      stdout = error.stdout || '';
      stderr = error.stderr || '';
      timedOut = !!error.killed || error.signal === 'SIGTERM';
    }

    const result = {
      name: check.name,
      command: check.command,
      status: exitCode === 0 ? 'passed' : 'failed',
      exit_code: exitCode,
      duration_ms: Date.now() - startTime,
      timed_out: timedOut,
      output: String(stdout).trim(),
    };
    if (exitCode !== 0) {
      result.error_summary = (stderr.split('\n').filter(Boolean).slice(0, 3) || ['']).join('\n') || '(no stderr)';
    }

    results.checks.push(result);
    if (exitCode !== 0 && results.overall_status === 'passed') {
      results.overall_status = 'failed';
      results.overall_reason = `${check.name} failed with exit code ${exitCode}`;
    }
  }

  return results;
}

/** 生成人类可读的环境快照 markdown */
function toMarkdown(results) {
  const rows = results.checks
    .map((c) => {
      const badge = c.status === 'passed' ? '✅ PASS' : '❌ FAIL';
      const note = c.timed_out
        ? 'timeout'
        : c.status === 'passed'
          ? (c.output.split('\n')[0] || '').slice(0, 80)
          : (c.error_summary || '').slice(0, 80);
      return `| ${c.name} | ${badge} | ${c.duration_ms}ms | ${note} |`;
    })
    .join('\n');

  return `# 环境检查快照：${results.task_id}

- 配置来源：\`${results.config_source}\`
- 检查时间：${results.generated_at}
- 结论：**${results.overall_status === 'passed' ? '环境就绪' : `存在 ${results.checks.filter((c) => c.status === 'failed').length} 项未就绪`}**

| 检查项 | 状态 | 耗时 | 说明 |
|--------|------|------|------|
${rows}

## 失败项
${results.checks.filter((c) => c.status === 'failed').length === 0 ? '（无）' : results.checks
  .filter((c) => c.status === 'failed')
  .map((c) => `- **${c.name}**（\`${c.command}\`）：exit ${c.exit_code}${c.error_summary ? `\n  ${c.error_summary}` : ''}`)
  .join('\n')}

> 本快照是任务设计阶段的确定性输入，基于实际状态生成（他证）。
`;
}

// ---------------------------------------------------------------- CLI 入口

function runCli() {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  function getArg(name) {
    const eq = args.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(`--${name}=`.length);
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && args[idx + 1] !== undefined) return args[idx + 1];
    return null;
  }

  if (subcommand !== 'run') {
    console.error('Usage: node env-check.js <run> ...');
    console.error('Subcommands:');
    console.error('  run  - 执行环境检查（--task-id <id>，--root <dir>）');
    process.exit(1);
  }

  // 他证：--commands 直接拒绝
  if (getArg('commands')) {
    console.error(
      '[harness env-check] 拒绝 --commands：检查命令必须来自项目配置 knowledge/env-check.config.json（他证原则）。'
    );
    process.exit(1);
  }

  const taskId = getArg('task-id');
  const rootArg = getArg('root');
  if (!taskId) {
    console.error('Usage: node env-check.js run --task-id=<id> [--root=<dir>]');
    process.exit(1);
  }

  try {
    const found = findEnvCheckConfig(rootArg || process.cwd());
    if (!found) {
      console.error(
        `[harness env-check] 未找到 ${CONFIG_REL}：请先运行 knowledge-init 生成项目环境检查配置（命令是项目拥有的，不允许 LLM 自选）。`
      );
      process.exit(1);
    }
    const { configPath, rootDir } = found;
    const config = readConfig(configPath);
    const results = runEnvChecks(config, configPath, rootDir, taskId);

    const wsDir = path.join(rootDir, '.harness', 'workspace', taskId);
    const mdPath = path.join(wsDir, 'env-check.md');
    const resultPath = path.join(wsDir, 'env-check', 'result.json');
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(mdPath, toMarkdown(results));
    fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));

    console.log(`Environment check completed: ${results.overall_status}`);
    console.log(`Checks run (from ${results.config_source}): ${results.checks.length}`);
    for (const c of results.checks) {
      console.log(`  [${c.status}] ${c.name} (${c.duration_ms}ms)${c.timed_out ? ' [timeout]' : ''}`);
    }
    console.log(`Snapshot saved to: ${mdPath}`);
    console.log(`Result saved to: ${resultPath}`);

    process.exit(results.overall_status === 'passed' ? 0 : 1);
  } catch (e) {
    console.error(`[harness env-check] ${e.message}`);
    process.exit(1);
  }
}

module.exports = { findEnvCheckConfig, readConfig, runEnvChecks, toMarkdown };

if (require.main === module) runCli();
