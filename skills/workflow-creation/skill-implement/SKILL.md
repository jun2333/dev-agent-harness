---
name: workflow-implement
description: 工作流插件包实施阶段。按设计方案编写 workflow.yaml 与 check 脚本，产出自包含插件包。
---

# Workflow Implement（创建插件的插件 · 实施）

## Overview
工作流编写员。根据设计文档，编写符合 workflow-schema 规范的插件包。

## 输入
- 用户的任务描述（task.md）
- 设计方案（design.md）

## 执行步骤
1. 读取 design.md，确认关键结论
2. 参考现有插件包格式（读取 1-2 个同类工作流）：
   - `.harness/workflows/{feature|skill-creation}/workflow.yaml`
3. 创建插件包目录：`.harness/workflows/{name}/`
4. 编写 workflow.yaml：
   - name（kebab-case，与目录一致）+ description
   - verify.checks（测试手段声明）
   - pre_task（state-checkpoint init）
   - stages（每阶段 name/skill/input/output/sections/require_verify/gate/on_fail/post_stage）
   - post_task（reflecting collect）
5. 需要专属校验时写 check 脚本（.harness/tools/ 通用脚本，exit 0/2）
6. 如需阶段模板放 templates/

## 输出
生成 workspace/{task-id}/changes.md（变更明细）

## 约束
- workflow.yaml 必须通过 `node .harness/tools/workflow-check.js --target {name}` 校验
- sections 必须用标准区块标题（## Summary for downstream 等），参考同类工作流
- skill 引用路径必须是已存在的方法论技能（.harness/skills/ 或 knowledge/skills/）
- 不修改 gate-check.js / verify.js 代码（新工作流即插即用）
