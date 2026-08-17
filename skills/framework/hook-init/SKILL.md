---
name: hook-init
description: harness hooks 初始化与维护。自动注册 hook 到宿主 CLI（QoderCLI / Claude Code / Codex），验证触发行为，排查故障。手动触发：用户说"初始化 hook"、"安装 hook"或"检查 hook"。
---

# Hook Init Skill

## Overview

把 `.harness/hooks/` 下的一套脚本注册到宿主 CLI，让"验证、记账、门禁"从提示词约束变成系统事件。脚本随 submodule 分发（一套代码），install.js 按 CLI 生成对应注册配置（多 CLI 通用）。

## 注册的 hook 一览

| 脚本 | 事件 | 作用 | 失败行为 |
|------|------|------|---------|
| `post-tool-log.js` | PostToolUse（全工具） | 每次工具调用追加一行到 `workspace/tool-actions.log` | 永不阻塞（async） |
| `check-verify.js` | PostToolUse（Bash） | 检测直接跑测试/构建命令，提醒改用 verify 通道 | 只提醒，不拦截 |
| `gate-check.js` | PostToolUse（Write）+ Stop | 校验阶段产出物与 verify 证据链，不达标拦截 | exit 2 阻塞 |

设计原则：hook 只做"提醒 + 校验"，否决权全部交给证据链（`verification-result.json` 只能由 verify 工具产生）。

## 确定性输入与语义判断

### 确定性输入（从实际状态读取）
- 本机安装的 CLI（`~/.qoder-cn` / `~/.claude` / `~/.codex` 目录，或 PATH 中的命令）
- 目标配置文件的现有内容（合并前读取）
- 注册结果（install.js 打印的报告）
- checkpoint.json 与产出物文件的实际状态

### 语义判断（需用户确认）
- 安装范围：项目级（推荐，随项目走）还是用户级（所有项目生效）
- 显式指定 CLI 时目标机是否装有对应 CLI（install.js 不校验，安装后需实测）

## 触发方式

### 手动触发
- **触发条件**：项目首次嵌入 `.harness` submodule；或 hook 行为异常需要重装
- **调用方式**：用户说"初始化 hook" / "安装 hook"；或执行 `node .harness/hooks/install.js`

## 执行步骤

### 1. 确认项目已嵌入 .harness

检查 `cwd/.harness/` 存在且含 `hooks/` 目录。缺失则先完成 submodule 添加。

### 2. 运行安装器

```bash
node .harness/hooks/install.js
```

- 默认 `--cli=auto`：检测本机 CLI（qoder / claude / codex），全部注册
- `--cli=codex`：只注册到指定 CLI（不要求本机已检测到）
- `--scope=user`：注册到用户级配置（`~/.qoder-cn/settings.json` / `~/.claude/settings.json` / `~/.codex/config.toml`）

### 3. 核对报告

确认输出包含 4 个 hook 的注册结果与配置文件路径。出现"备份原文件"说明做了合并；出现"追加方式合并，请人工检查"说明 Codex 配置已有其他 hooks 段，需要人工确认无重复。

### 4. 验证 hook 触发（推荐）

用管道模拟 stdin 直接跑脚本（不依赖 CLI）：

```bash
# 记账：应生成 workspace/tool-actions.log 一行记录
echo '{"cwd":"'$PWD'","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"npm run build"}}' \
  | node .harness/hooks/post-tool-log.js

# 绕过提醒：应输出 hookSpecificOutput JSON
echo '{"cwd":"'$PWD'","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"npm test"}}' \
  | node .harness/hooks/check-verify.js

# 门禁：无 checkpoint 时应 exit 0
echo '{"cwd":"'$PWD'","hook_event_name":"Stop"}' \
  | node .harness/hooks/gate-check.js; echo "exit=$?"
```

### 5. 告知用户验证方式

重启 CLI 会话（或等待下一次事件），观察：
- 任意 Bash/Write 调用后 `workspace/tool-actions.log` 有新记录
- 直接跑 `npm test` 时收到 harness 提醒
- testing 阶段产出物缺 verify 证据时被拦截

## 跨 CLI 差异对照

| 维度 | QoderCLI | Claude Code | Codex |
|------|----------|-------------|-------|
| 项目级配置 | `.qoder/settings.json` | `.claude/settings.json` | `.codex/config.toml` |
| 用户级配置 | `~/.qoder-cn/settings.json` | `~/.claude/settings.json` | `~/.codex/config.toml` |
| 配置格式 | JSON | JSON | TOML（数组表） |
| 事件键 | `PostToolUse` / `Stop` | `PostToolUse` / `Stop` | `[[hooks.PostToolUse]]` |
| 拦截语义 | exit 2，stderr 作 reason | exit 2，stderr 作 reason | exit 2，stderr 作 reason（stderr 为空则视为失败） |
| 提醒注入 | stdout `hookSpecificOutput.hookEventName` + `additionalContext` | 同左（额外支持 `systemMessage`） | 同左（严格校验未知字段，只输出交集字段） |
| matcher | 工具名正则，支持 `Bash(npm test*)` 命令前缀规则 | 工具名正则 | 工具名正则 |

**兼容要点**：脚本 stdout 只输出交集字段（`hookSpecificOutput` + `hookEventName` + `additionalContext`），拦截统一走 exit 2 + stderr——三个 CLI 都能正确解析。

## 故障排查

| 症状 | 可能原因 | 处理 |
|------|---------|------|
| hook 不触发 | 配置写到了别的 scope（如项目级 vs 用户级） | 确认目标配置文件位置，重跑 install.js 指定 `--scope` |
| 提醒没出现 | 当前 CLI 只认 `systemMessage` 不认 `additionalContext` | 检查脚本输出格式；Claude Code 额外支持顶层 `systemMessage` 字段 |
| gate 拦截误伤 | Stop 事件在非任务场景触发但 checkpoint 陈旧 | 检查 `workspace/*/checkpoint.json` 是否有未完成任务；`state-checkpoint complete` 会清理 |
| Codex 下 gate 不触发 | Codex 写文件走 `apply_patch`/`Write` 之外的工具名 | 确认工具名后调整 matcher；Stop 终检是兜底 |
| 脚本报错但主流程正常 | 脚本异常被 CLI 当作警告 | 用第 4 步管道方式单独调试脚本 |

## 卸载

手动删除注册的配置段（按 hook name `harness-*` 检索），或还原 install.js 生成的备份文件（`.bak-*`）。
