#!/usr/bin/env node

/**
 * Harness Context Snapshot Tool
 *
 * 基于 tool-actions.log 的确定性上下文记账：解析任务开始后 agent 的
 * 真实信息获取行为（Read 工具 + Bash 中的 cat/grep/find/head/tail/ls 等），
 * 生成已读清单 + token 估算，替代 LLM 自觉记账的 context-ledger。
 *
 * 背景：context-rules 是纯提示词（无强制力），context-ledger 靠 LLM 自觉
 * （不可靠）。tool-actions.log 是确定性事实（post-tool-log.js 记录每次
 * 工具调用），本工具把它解析成"这个任务读了什么、花了多少 token"。
 *
 * 用法：
 *   node context-snapshot.js run --task-id <id> [--root <dir>]
 *
 * 输入：
 *   - .harness/workspace/{task-id}/checkpoint.json（取 created_at 作为任务基线）
 *   - .harness/workspace/tool-actions.log（会话级工具调用事实）
 *
 * 输出：
 *   - workspace/{task-id}/context-ledger.md   —— 人类可读已读清单
 *   - workspace/{task-id}/context-ledger.json —— 机器可读（含 token 估算）
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LEDGER_SCHEMA = 'context-ledger.v1';
// 不看的内容（依赖/构建产物/版本库/运行时/本地工具记忆）
const IGNORE_DIR = /node_modules|\.git(?:hub)?|\.next|dist|build|\.venv|coverage|test-results|playwright-report|\.workbuddy|\.qoder|\.dsh/i;
const TOKENS_PER_BYTE = 1 / 3; // 粗略估算：中文/代码混合约 3 字节 ≈ 1 token

// 非"信息读取"命令：参数不是文件读取目标（执行/写入/版本管理/输出字符串）
const NON_READ_COMMANDS = new Set([
  'git', 'echo', 'printf', 'cp', 'mv', 'rm', 'mkdir', 'touch', 'chmod', 'chown',
  'npm', 'pnpm', 'yarn', 'npx', 'node', 'tsc', 'eslint', 'vitest', 'jest', 'playwright',
  'docker', 'docker-compose', 'curl', 'wget', 'brew', 'kill', 'open', 'code',
]);

/** 路径参数合法性过滤：去掉纯符号/中文单字/heredoc 标记等噪音 */
function isLikelyPath(s) {
  if (!s || s.length < 2) return false;
  if (/^[<>|&;]+$/.test(s)) return false; // 纯重定向/管道符号
  if (/^(EOF|EOT|heredoc|pass)$/i.test(s)) return false; // heredoc 标记
  if (/^[0-9,]+[a-z]?$/i.test(s)) return false; // sed 地址如 40,48p / 3d
  if (/\s/.test(s)) return false; // 含空格的多词字符串（echo 内容等）
  if (/^[0-9]+[><&]/.test(s)) return false; // 2>&1 / 2>/dev/null 重定向
  if (/^[()]/.test(s)) return false; // (pass 等 pattern/字符串
  if (/^[^/.]{1,2}$/.test(s)) return false; // 单字符/双字符且无路径分隔符
  return true;
}

/** 从 startDir 向上查找 .harness 目录（项目根） */
function findHarnessRoot(startDir) {
  let current = path.resolve(startDir || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, '.harness'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** 读 checkpoint.json，返回 { created_at, workflow, current_stage } 或 null */
function readCheckpoint(root, taskId) {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, '.harness', 'workspace', taskId, 'checkpoint.json'), 'utf8')
    );
    return raw;
  } catch {
    return null;
  }
}

/** 读工具调用日志：按日全局日志（tool-actions/YYYY-MM-DD.log），按 task_id 过滤；共享 tool-actions.log 兼容 */
function readToolLog(root, taskId) {
  const records = [];
  const dayDir = path.join(root, '.harness', 'workspace', 'tool-actions');
  if (fs.existsSync(dayDir)) {
    for (const f of fs.readdirSync(dayDir)) {
      if (!f.endsWith('.log')) continue;
      for (const line of fs.readFileSync(path.join(dayDir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line);
          // 有任务时按 task_id 过滤；无任务读全部（非任务调用）
          if (taskId && rec.task_id !== taskId) continue;
          records.push(rec);
        } catch {
          // 忽略坏行
        }
      }
    }
  }
  // 兼容旧共享日志（历史记录，无 task_id 字段）
  const sharedLog = path.join(root, '.harness', 'workspace', 'tool-actions.log');
  if (fs.existsSync(sharedLog)) {
    for (const line of fs.readFileSync(sharedLog, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // 忽略坏行
      }
    }
  }
  return records;
}

/**
 * 解析 Bash 命令，提取"信息获取行为"。
 * @returns {{ files: string[], dirs: string[] }}
 *   files —— 文件内容被读入上下文的命令目标（cat/head/tail/grep 的文件参数、重定向 <）
 *   dirs  —— 目录浏览（ls/find 的目标，token 开销小）
 */
function parseBashReads(command) {
  const files = [];
  const dirs = [];

  // 处理 < file 重定向（排除 << heredoc）
  for (const m of command.matchAll(/(?:^|[^<])<\s*([^\s|&;<>]+)/g)) {
    const t = m[1];
    if (t && isLikelyPath(t) && !t.startsWith('-')) files.push(t);
  }

  // 按管道/逻辑符切成子命令，逐条识别
  const segments = command.split(/\s*\|\s*|\s*&&\s*|\s*;\s*/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    // heredoc（<<EOF 等）不是文件读取，跳过整个段
    if (/<<[\s-]?['"]?[A-Z_]+['"]?/.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].replace(/^.*\//, ''); // 去掉路径前缀
    const args = parts.slice(1);

    // 非读取类命令（执行/写入/输出字符串）整体跳过
    if (NON_READ_COMMANDS.has(cmd)) continue;

    const norm = (p) => p.replace(/^['"]|['"]$/g, '');

    switch (cmd) {
      case 'cat':
      case 'less':
      case 'more':
      case 'wc':
      case 'diff': {
        for (const a of args) {
          const n = norm(a);
          if (!isLikelyPath(n) || n.startsWith('-') || n === '>') continue;
          files.push(n);
        }
        break;
      }
      case 'head':
      case 'tail': {
        let skipNext = false;
        for (const a of args) {
          const n = norm(a);
          if (!n) continue;
          if (skipNext) { skipNext = false; continue; } // -n 20 的 20
          if (n === '-n' || n === '--lines' || n === '-c' || n === '--bytes') { skipNext = true; continue; }
          if (/^-\d+$/.test(n) || /^\d+$/.test(n)) continue; // -5 或 20
          if (n.startsWith('-')) continue;
          if (isLikelyPath(n)) files.push(n);
        }
        break;
      }
      case 'grep':
      case 'rg': {
        let seenPattern = false;
        for (const a of args) {
          const n = norm(a);
          if (!n) continue;
          if (!seenPattern) {
            if (n.startsWith('-')) continue; // -n -E -v --include 等
            seenPattern = true; // 第一个非 flag 是 pattern
            continue;
          }
          if (n.startsWith('-')) continue; // 剩余 flag
          if (isLikelyPath(n)) files.push(n);
        }
        break;
      }
      case 'find': {
        for (const a of args) {
          const n = norm(a);
          if (!n || n.startsWith('-')) continue; // find -name 等
          if (isLikelyPath(n)) dirs.push(n);
          break; // 只取起始目录
        }
        break;
      }
      case 'ls': {
        if (args.length === 0) {
          dirs.push('.');
        } else {
          for (const a of args) {
            const n = norm(a);
            if (n && !n.startsWith('-') && isLikelyPath(n)) dirs.push(n);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  return { files, dirs };
}

/** 从一条工具调用记录提取读取目标 */
function extractReads(record) {
  if (record.tool === 'Read') {
    const fp = record.input;
    return fp && !fp.startsWith('-') ? { files: [fp], dirs: [] } : { files: [], dirs: [] };
  }
  if (record.tool === 'Bash' && typeof record.input === 'string') {
    return parseBashReads(record.input);
  }
  return { files: [], dirs: [] };
}

/**
 * 生成上下文快照。
 * @param {object} opts { root, taskId }
 * @returns {object} ledger 数据
 */
function generateSnapshot({ root, taskId }) {
  const cp = readCheckpoint(root, taskId);
  const baselineTs = (cp && (cp.created_at || cp.started_at)) || null;

  const records = readToolLog(root, taskId);
  // 过滤：有基线时只取基线之后；基线缺失时取全部
  const relevant = baselineTs
    ? records.filter((r) => r.ts && r.ts >= baselineTs)
    : records;

  const fileStats = new Map(); // path -> { count, bytes, sources:Set }
  const dirStats = new Map(); // path -> { count }

  // 只记录主代理（桥）的工具调用：子代理能读什么由 prompt + 交接文档限定，不做自报记账
  for (const rec of relevant) {
    const { files, dirs } = extractReads(rec);
    for (const f of files) {
      // 绝对路径：项目内相对化，项目外忽略
      let rel = f;
      if (path.isAbsolute(f)) {
        if (f.startsWith(root)) rel = path.relative(root, f);
        else continue;
      }
      if (IGNORE_DIR.test(rel)) continue;
      // stat 判定：文件 → files，目录 → dirs，不存在（glob/pattern）→ 丢弃
      const abs = path.resolve(root, rel);
      let isDir = false;
      let bytes = 0;
      try {
        const st = fs.statSync(abs);
        if (st.isDirectory()) isDir = true;
        else if (st.isFile()) bytes = st.size;
        else continue;
      } catch {
        continue;
      }
      if (isDir) {
        const st = dirStats.get(rel) || { count: 0 };
        st.count += 1;
        dirStats.set(rel, st);
        continue;
      }
      const key = rel;
      const fst = fileStats.get(key) || { count: 0, bytes: 0, sources: new Set() };
      fst.count += 1;
      fst.sources.add(rec.tool === 'Read' ? 'Read' : 'Bash');
      fst.bytes = Math.max(fst.bytes, bytes);
      fileStats.set(key, fst);
    }
    for (const d of dirs) {
      let rel = d;
      if (path.isAbsolute(d)) {
        if (d.startsWith(root)) rel = path.relative(root, d);
        else continue;
      }
      if (IGNORE_DIR.test(rel)) continue;
      // 目录路径需存在；不存在（如 glob）丢弃
      try {
        if (!fs.statSync(path.resolve(root, rel)).isDirectory()) continue;
      } catch {
        continue;
      }
      const st = dirStats.get(rel) || { count: 0 };
      st.count += 1;
      dirStats.set(rel, st);
    }
  }

  const files = [...fileStats.entries()]
    .map(([p, s]) => ({
      path: p,
      count: s.count,
      bytes: s.bytes,
      estimated_tokens: Math.round(s.bytes * TOKENS_PER_BYTE),
      sources: [...s.sources],
    }))
    .sort((a, b) => b.estimated_tokens - a.estimated_tokens);

  const dirs = [...dirStats.entries()]
    .map(([p, s]) => ({ path: p, count: s.count }))
    .sort((a, b) => b.count - a.count);

  const totalTokens = files.reduce((sum, f) => sum + f.estimated_tokens, 0);

  return {
    schema_version: LEDGER_SCHEMA,
    task_id: taskId,
    baseline_ts: baselineTs,
    generated_at: new Date().toISOString(),
    records_scanned: relevant.length,
    files,
    dirs,
    total_estimated_tokens: totalTokens,
    summary: {
      file_count: files.length,
      dir_count: dirs.length,
      top_files: files.slice(0, 10).map((f) => f.path),
    },
  };
}

/** 生成人类可读 markdown 已读清单 */
function toMarkdown(ledger) {
  const rows = ledger.files
    .map((f) => `| ${f.path} | ${f.count} | ${fmtTokens(f.estimated_tokens)} | ${f.sources.join('/')} |`)
    .join('\n') || '| （任务开始后未检测到文件内容读取） | - | - | - |';

  const dirRows = ledger.dirs
    .map((d) => `| ${d.path} | ${d.count} |`)
    .join('\n') || '| （无目录浏览） | - |';

  return `# 上下文已读清单：${ledger.task_id}

- 基线时间：${ledger.baseline_ts || '（无，全量统计）'}
- 更新时间：${ledger.generated_at}
- 扫描记录：${ledger.records_scanned} 条工具调用
- **累计上下文开销：约 ${fmtTokens(ledger.total_estimated_tokens)}**

## 已读文件（按 token 估算排序）

| 文件 | 读取次数 | 估算 token | 来源 |
|------|---------|-----------|------|
${rows}

## 目录浏览

| 目录 | 次数 |
|------|------|
${dirRows}

> 来源：\`.harness/workspace/tool-actions.log\`（确定性记录，post-tool-log.js 生成）。
> 规则：已读文件不重复读取；估算按 ~3 字节/token 粗略折算，非精确计量。
`;
}

function fmtTokens(n) {
  if (n >= 1000) return `~${(n / 1000).toFixed(1)}K`;
  return `~${n}`;
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
    console.error('Usage: node context-snapshot.js <run> ...');
    console.error('Subcommands:');
    console.error('  run  - 生成上下文快照（--task-id <id>，--root <dir>）');
    process.exit(1);
  }

  const taskId = getArg('task-id');
  const rootArg = getArg('root');
  if (!taskId) {
    console.error('Usage: node context-snapshot.js run --task-id=<id> [--root=<dir>]');
    process.exit(1);
  }

  const root = rootArg ? path.resolve(rootArg) : findHarnessRoot(process.cwd());
  if (!root) {
    console.error('[harness context-snapshot] 未找到 .harness 目录（不是 harness 项目）');
    process.exit(1);
  }

  try {
    const ledger = generateSnapshot({ root, taskId });
    const wsDir = path.join(root, '.harness', 'workspace', taskId);
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'context-ledger.md'), toMarkdown(ledger));
    fs.writeFileSync(path.join(wsDir, 'context-ledger.json'), JSON.stringify(ledger, null, 2));

    console.log(`Context snapshot completed: ${ledger.task_id}`);
    console.log(`Records scanned: ${ledger.records_scanned}, files read: ${ledger.files.length}, estimated tokens: ${ledger.total_estimated_tokens}`);
    console.log(`Ledger saved to: ${path.join(wsDir, 'context-ledger.md')}`);
  } catch (e) {
    console.error(`[harness context-snapshot] ${e.message}`);
    process.exit(1);
  }
}

module.exports = { findHarnessRoot, parseBashReads, extractReads, generateSnapshot, toMarkdown };

if (require.main === module) runCli();
