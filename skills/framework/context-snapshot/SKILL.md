---
name: context-snapshot
description: 上下文快照。基于 tool-actions.log 确定性生成已读清单（context-ledger），防重复读取 + 统计 token 开销。自动触发：workflow 每阶段 post_stage 钩子调用（action: run）。
---

# Context Snapshot Skill

## Overview
把 `tools/context-snapshot.js` 解析 tool-actions.log 生成的已读清单（`workspace/{task-id}/context-ledger.md`）作为每阶段上下文加载的依据：**已读文件不重复读取**。清单基于真实工具调用记录生成（他证），替代 LLM 自觉记账的旧 context-ledger。

## 触发方式

### 自动触发
- **触发条件**：每个 stage 完成后（post_stage 钩子）：action: run
- **调用方式**：workflow YAML 中定义，无需用户主动调用

## 执行步骤

1. 刷新已读清单：
   ```bash
   node .harness/tools/context-snapshot.js run --task-id {task-id}
   ```
2. 读取 `workspace/{task-id}/context-ledger.md`：
   - **已读文件表**：这些文件本任务已读取过，后续阶段不重复读取（除非内容已变更，需用 git 或时间戳确认）
   - **累计 token 估算**：了解当前上下文开销，超出预算时压缩后续读取（优先精读小文件、用 grep 定位代替全文件读取）
3. 将已读清单纳入下一阶段的上下文加载依据（配合 context-rules/loading-strategy.md）

## 确定性输入（从实际状态读取）
- `.harness/workspace/tool-actions.log`（post-tool-log.js 记录的真实工具调用）
- `workspace/{task-id}/checkpoint.json`（`started_at`/`created_at` 作为任务基线，过滤本任务之前的记录）

## 语义判断（基于输入推断）
- 本任务实际读取了哪些文件（基于工具调用事实，非 LLM 自述）
- 哪些已读文件可能已变更需要重读（基于后续是否有 Edit/Write 该文件）

## 约束
- 已读文件不重复读取；确需重读时记录原因（写入 context-ledger.md 的备注）
- 不修改 context-snapshot.js 的解析规则来"美化"清单——清单必须反映真实行为
