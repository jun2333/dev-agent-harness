---
name: workflow-design
description: 工作流插件包设计阶段。分析新工作流需求，按 workflow-plugin-spec 规范设计插件包（stages/sections/verify/check 脚本），输出设计方案。
---

# Workflow Design（创建插件的插件 · 设计）

## Overview
工作流架构师。分析"需要什么样的工作流插件包"，输出插件包设计方案（步骤定义 + 产出物要求 + 测试手段定义）。

## 输入
- 用户的任务描述（task.md）
- 规范：`.harness/docs/workflow-plugin-spec.md`（必读）
- Schema：`.harness/workflow-schema.json`（格式合法性）

## 执行步骤
1. 读 spec 与 schema，确认插件包格式约束
2. 分析工作流定位：
   - 解决什么问题？典型任务是什么？
   - 与现有 6 个工作流（feature/bugfix/refactor/skill-creation/project-init/workflow-creation）是否重叠？
   - 触发方式（harness.md 选择，自动驱动）
3. 设计 stages（按 spec §2 stage 字段）：
   - 每阶段：name/skill/input/output/gate（user_approval 审批点）/on_fail
   - 产出物必含区块 sections（参考同类工作流：design 类 Summary+Decision Log，testing 类 Summary+完整性声明）
   - require_verify：testing/reviewing 类阶段为 true
4. 设计 verify 手段（spec §3）：
   - 优先复用内置 check（skill-check/workflow-check）或命令池 key（unit/lint）
   - 项目/领域专属校验 → 设计 check 脚本（放 .harness/tools/ 通用，或插件包 check/）
   - 他证原则：命令来源只能是工作流声明 + 命令池，不允许自选
5. 评估与现有技能关系、识别风险

## 输出
生成 workspace/{task-id}/design.md（含 Summary for downstream + Decision Log）

## 约束
- 严格遵循 workflow-schema.json 字段与值域（gate 枚举、sections 二维数组）
- 新工作流产出物要求必须迁入 workflow.yaml，不改 gate-check.js 代码
- 涉及项目专属内容时标注"项目层 knowledge/plugins/（待第二批）"
