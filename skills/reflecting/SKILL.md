---
name: reflecting
description: 复盘总结 + 经验收集。阶段一自动触发：workflow 最后阶段自动调用，生成经验草稿和技能改进建议。阶段二手动触发：用户说"收集经验"或"reflecting collect {task-id}"后调用，将用户选中的经验写入知识库，应用技能改进。
---

# Reflecting Skill

## Overview
两阶段技能：阶段一自动复盘生成草稿，阶段二手动收集用户选中的经验和技能改进。

## 触发方式

### 阶段一：自动触发
- **触发条件**：workflow 最后阶段（post_stage 钩子）
- **调用方式**：`sub_command: reflect`
- **无需用户主动调用**

### 阶段二：手动触发
- **触发条件**：用户审核草稿后
- **调用方式**：
  - 对话中说"收集经验"或"reflecting collect"
  - 执行 `reflecting collect {task-id}`
- **用户需指定编号**：如"收集第 1、3 条"

## 阶段一：自动复盘

### 输入
- workspace/{task-id}/task.md
- workspace/{task-id}/design.md
- workspace/{task-id}/task-plan.md
- workspace/{task-id}/test-report.md
- workspace/{task-id}/review-report.md
- workspace/{task-id}/execution-log.md

### 执行步骤
1. 回顾任务执行全过程
2. 对比计划与实际执行的差异
3. 提炼可复用的经验教训
4. 生成经验草稿到 workspace/{task-id}/lessons-draft.md
5. 回溯每个 skill 的执行情况，评估是否存在不足（来源：agent 自检 + 用户反馈）
6. 如发现技能不足，生成 workspace/{task-id}/skill-improvements-draft.md；如无不足则跳过

### 输出
- workspace/{task-id}/lessons-draft.md
- workspace/{task-id}/skill-improvements-draft.md（可选）

### 约束
- 经验教训必须基于实际执行过程，不臆造
- 每条教训必须有明确的场景、问题和解决方案
- 初始置信度设为 0.5
- 不直接写入知识库，只生成草稿
- 技能改进建议必须指向具体的 skill 文件和修改点

## 阶段二：手动收集

### 输入
- workspace/{task-id}/lessons-draft.md
- workspace/{task-id}/skill-improvements-draft.md（如存在）
- 用户指定的编号（如"收集第 1、3 条"）

### 执行步骤
1. 读取 lessons-draft.md 和 skill-improvements-draft.md（如存在）
2. 根据用户指定的编号，将对应条目标题加上 `✅` 标记
3. 筛选带 `✅` 的经验，生成 frontmatter（tags, confidence, created, use_count, source_task, status）
4. 写入 knowledge/lessons/ 目录
5. 更新 knowledge/_index.md（如需要）
6. 筛选带 `✅` 的技能改进建议，按建议修改对应的 skill 文件
7. 清理已收集的草稿

### 输出
- knowledge/lessons/{id}-{title}.md（新增的经验文件）

### 约束
- 只收集用户勾选的经验
- 生成的文件必须符合 frontmatter 格式规范
- 文件名使用 {id}-{title}.md 格式
- 技能改进直接修改对应 skill 文件，修改前向用户确认

## 草稿格式

### lessons-draft.md
```markdown
# 经验草稿

## 待审核经验

### 经验 1: [标题]
- 标签: [tags]
- 置信度: [0.0-1.0]
- 场景: [什么时候会遇到]
- 问题: [具体问题]
- 解决方案: [怎么解决]

### 经验 2: ...

## 操作指引
请说出需要收集的经验编号（如"收集第 1、3 条"），然后执行 `reflecting collect`。
```

### skill-improvements-draft.md
```markdown
# 技能改进建议

## 待审核改进

### 改进 1: [skill 名称] — [问题简述]
- 文件: [具体文件路径]
- 问题: [具体问题描述]
- 建议: [具体修改建议]

### 改进 2: ...

## 操作指引
请说出需要应用的改进编号（如"应用第 1、2 条"），然后执行 `reflecting collect`。
```
