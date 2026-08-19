---
name: env-check
description: 环境就绪检查。自动触发：workflow 的 pre_task 钩子调用（action: run）。任务开始前验证项目环境（数据库、依赖、配置文件等）是否就绪，产出环境快照，防止设计阶段基于错误假设开工。
---

# Env Check Skill

## Overview
任务开始前检查环境就绪状态。检查命令由项目配置 `knowledge/env-check.config.json` 声明（他证），工具 `tools/env-check.js` 确定性执行，产出人类可读快照 `workspace/{task-id}/env-check.md` 与机器可读结果 `workspace/{task-id}/env-check/result.json`。

## 触发方式

### 自动触发
- **触发条件**：workflow 开始前（pre_task 钩子）：action: run
- **调用方式**：workflow YAML 中定义，无需用户主动调用

## 执行步骤

1. 执行环境检查：
   ```bash
   node .harness/tools/env-check.js run --task-id {task-id}
   ```
2. 读取结果（`workspace/{task-id}/env-check.md`）：
   - **全部 PASS** → 进入下一步，将环境快照作为设计阶段的确定性输入
   - **存在 FAIL** → 向用户说明未就绪项、对应命令和错误摘要，给出修复建议；用户修复后**重跑 env-check**，直到全部通过才允许进入 designing
3. 环境快照就绪后，将 `env-check.md` 内容纳入设计阶段的参考上下文（如环境版本、数据库连通性等事实以快照为准，不臆测）

## 确定性输入（从实际状态读取）
- `knowledge/env-check.config.json`（项目拥有的检查命令配置）
- 实际执行时的 exit code / 命令输出 / 耗时（由 env-check.js 捕获）

## 语义判断（基于输入推断）
- 未就绪项是否阻塞当前任务（基于任务类型与环境项的关联判断）
- 是否需要建议用户调整环境（如切换数据库、安装依赖）而非强行开工

## 约束
- 检查命令必须来自项目配置 `knowledge/env-check.config.json`，不允许通过命令行自选命令（他证原则）
- 未全部通过前不得进入设计阶段；如用户坚持继续，需显式记录到 env-check.md 的失败项并口头确认风险
- env-check.md 只记录实际状态，不写入推测信息
