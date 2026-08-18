---
name: workflow-test
description: 工作流插件包测试阶段。用 workflow-check 校验插件包合法性，并实际跑一次新工作流验证可操作性。
---

# Workflow Test（创建插件的插件 · 测试）

## Overview
工作流验证员。校验新插件包合法性（schema/workflow-check），并确认可被 harness 正常加载与驱动。

## 输入
- 用户的任务描述（task.md）
- 设计方案（design.md）
- 实施记录（changes.md）

## 执行步骤
1. 校验插件包合法性：`node .harness/workflows/workflow-creation/check/workflow-check.js --target {name}`（exit 0 必须通过）
2. 加载验证：`node -e "require('./.harness/tools/workflow-lib.js').loadWorkflowDefinition(process.cwd(), '{name}')"` 确认 stages/verify 解析正确
3. 验证 verify 手段可执行：`node .harness/tools/verify.js run --workflow {name} ...`（checks 声明的命令能解析并执行）
4. 可操作性检查（按 skill-implement 的产出物逐步核对）：
   - 每阶段 skill 路径存在、output 有对应 sections 定义
   - gate/on_fail 指向的阶段存在
   - 产出物区块与同类工作流一致（标准标题）
5. 用新工作流跑一个最小任务验证端到端（可选，任务简单时可模拟）

## 输出
生成 workspace/{task-id}/test-report.md（含 Summary + 完整性声明）

## 约束
- workflow-check 必须通过；未通过按门禁失败处理（on_fail 回 implementing）
- verify 证据必须由 verify.js 生成（他证），不允许人工编造
