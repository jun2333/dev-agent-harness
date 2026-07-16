#!/usr/bin/env node

/**
 * Harness Verification Tool
 * 
 * 强制执行验证命令并捕获真实结果，防止 AI 跳过或伪造测试结果。
 * 
 * 用法：
 *   node verify.js run \
 *     --commands "npm run test:unit,npm run build,npm run lint" \
 *     --output-dir workspace/task-123/test-results \
 *     --report workspace/task-123/verification-result.json
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runVerification(commands, outputDir, reportPath) {
  const results = {
    schema_version: 'verification-result.v1',
    generated_at: new Date().toISOString(),
    commands: [],
    overall_status: 'passed',
    overall_reason: null
  };

  // 确保输出目录存在
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 逐个执行命令
  for (const cmd of commands) {
    const logFile = path.join(outputDir, `${cmd.replace(/\s+/g, '-')}.log`);
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    const startTime = Date.now();

    try {
      stdout = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      exitCode = error.status || 1;
      stdout = error.stdout || '';
      stderr = error.stderr || '';
    }

    const duration = Date.now() - startTime;

    // 保存日志
    fs.writeFileSync(logFile, `Command: ${cmd}\nExit Code: ${exitCode}\nDuration: ${duration}ms\n\n--- STDOUT ---\n${stdout}\n\n--- STDERR ---\n${stderr}`);

    // 记录结果
    const result = {
      command: cmd,
      exit_code: exitCode,
      status: exitCode === 0 ? 'passed' : 'failed',
      log_path: logFile,
      duration_ms: duration
    };

    if (exitCode !== 0) {
      result.error_summary = stderr.split('\n').slice(0, 5).join('\n');
    }

    results.commands.push(result);

    // 如果有失败，标记整体失败
    if (exitCode !== 0 && results.overall_status === 'passed') {
      results.overall_status = 'failed';
      results.overall_reason = `${cmd} failed with exit code ${exitCode}`;
    }
  }

  // 写入报告
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  return results;
}

// CLI 入口
const args = process.argv.slice(2);
const subcommand = args[0];

if (subcommand === 'run') {
  const commandsArg = args.find(arg => arg.startsWith('--commands='));
  const outputDirArg = args.find(arg => arg.startsWith('--output-dir='));
  const reportPathArg = args.find(arg => arg.startsWith('--report='));

  if (!commandsArg || !outputDirArg || !reportPathArg) {
    console.error('Usage: node verify.js run --commands="cmd1,cmd2" --output-dir=<dir> --report=<path>');
    process.exit(1);
  }

  const commands = commandsArg.split('=')[1].split(',');
  const outputDir = outputDirArg.split('=')[1];
  const reportPath = reportPathArg.split('=')[1];

  const results = runVerification(commands, outputDir, reportPath);

  console.log(`Verification completed: ${results.overall_status}`);
  console.log(`Report saved to: ${reportPath}`);
  
  process.exit(results.overall_status === 'passed' ? 0 : 1);
} else {
  console.error('Usage: node verify.js <run> ...');
  console.error('Subcommands:');
  console.error('  run  - Execute verification commands and generate report');
  process.exit(1);
}
