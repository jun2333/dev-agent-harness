---
name: reflecting
description: 项目复盘 + 经验收集。阶段一自动触发：workflow 最后阶段自动调用，生成经验草稿。阶段二手动触发：用户说"收集经验"或"reflecting collect {task-id}"后调用，将用户选中的经验写入知识库。技能改进由 skill-evolution 独立处理。
---

# Reflecting Skill

## Overview
两阶段技能：阶段一自动复盘生成项目经验草稿，阶段二手动收集用户选中的经验。技能自身的改进由 skill-evolution 负责，不在此技能范围内。

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

### 确定性输入（从以下文件读取，不臆造）
- workspace/{task-id}/task.md
- workspace/{task-id}/design.md
- workspace/{task-id}/task-plan.md
- workspace/{task-id}/test-report.md
- workspace/{task-id}/review-report.md

### 语义判断（基于上述输入推断，标注依据）
- 哪些经验值得沉淀（基于问题的影响面和复用概率）
- 计划与实际执行的差异分析（基于对比两份文档）
- skill 执行中的不足评估（基于 agent 自检 + 用户反馈）
- 技能改进建议的优先级

### 执行步骤
1. 回顾任务执行全过程
2. 对比计划与实际执行的差异
3. 提炼可复用的项目经验教训
4. 生成经验草稿到 workspace/{task-id}/lessons-draft.md

### 输出
- workspace/{task-id}/lessons-draft.md

### 约束
- 经验教训必须基于实际执行过程，不臆造
- 每条教训必须有明确的场景、问题和解决方案
- 初始置信度设为 0.5
- 不直接写入知识库，只生成草稿
- 不评估技能改进（由 skill-evolution 通过 skill-logs 处理）

## 阶段二：手动收集

### 确定性输入（从以下文件读取）
- workspace/{task-id}/lessons-draft.md
- workspace/{task-id}/review-report.md 的「## 人工反馈」区块（人类审核反馈已内嵌在审查报告末尾，优先读取）
- workspace/{task-id}/human-review-feedback.md（如存在，兼容旧格式）
- 用户指定的编号（如"收集第 1、3 条"）

### 语义判断（基于输入推断）
- 生成的 frontmatter 是否准确（tags、confidence 等）
- 失效条件（invalidation_condition）是否具体可验证
- 回源路径（source_refs）是否指向正确的源码文件
- 人类反馈中「建议沉淀 = 是」的条目是否值得转为经验（基于问题的影响面和复用概率）

### 执行步骤
1. 读取 lessons-draft.md；读取 review-report.md 的「## 人工反馈」区块（无则查 human-review-feedback.md 兼容）
2. 根据用户指定的编号，将 lessons-draft 对应条目标题加上 `✅` 标记
3. 筛选带 `✅` 的经验，生成 frontmatter（tags, confidence, created, use_count: 1, source_task, status, invalidation_condition, source_refs）。`use_count` 初始值固定为 **1**——经验因实际使用踩坑而被收集，收集即首次使用；后续由 task-planning 阶段在命中时递增（引用即消费）
4. 将人工反馈区块中「建议沉淀 = 是」的条目转为经验条目，frontmatter 增加 `source: human-review`，与步骤 3 的条目一起写入 knowledge/lessons/ 目录
5. 更新 knowledge/_index.md（如需要）
6. 清理已收集的草稿（lessons-draft.md 与已处理完的反馈区块/兼容文件）

### 输出
- knowledge/lessons/{id}-{title}.md（新增的经验文件，含 human-review 来源）

### 约束
- 只收集用户勾选的经验 + 人类反馈中明确「建议沉淀 = 是」的条目
- 生成的文件必须符合 frontmatter 格式规范
- 文件名使用 {id}-{title}.md 格式
- 人类反馈「AI 审查是否遗漏 = 是」的条目同时是审查技能改进信号，记录到 skill-log 供 skill-evolution 使用

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
- 失效条件: [什么情况下这条经验会过时，必须是具体可验证的条件]
- 回源路径: [关联的源码文件路径列表，用于日后验证经验是否仍然有效]

### 经验 2: ...

## 操作指引
请说出需要收集的经验编号（如"收集第 1、3 条"），然后执行 `reflecting collect`。
```
