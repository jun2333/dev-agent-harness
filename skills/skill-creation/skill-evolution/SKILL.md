---
name: skill-evolution
description: 技能自成长。手动触发：用户说"技能进化"或"skill-evolution {sub_command}"。子命令：review（汇总 skill-logs，清理空模板，生成改进建议草稿）、apply（用户确认后修改对应 SKILL.md）。与项目经验（reflecting）完全解耦。
---

# Skill Evolution

## Overview
通过汇总技能执行记录（skill-logs），发现技能不足并持续优化。独立于项目开发流程，手动触发。

## 触发方式
- **触发条件**：用户主动调用
- **调用方式**：
  - 对话中说"技能进化"或"skill-evolution"
  - 执行 `skill-evolution {sub_command}`
- **子命令**：review / apply

## 子命令：review
汇总所有 skill-logs，清理无效记录，生成改进建议草稿。

### 执行步骤
1. 扫描所有 `workspace/*/skill-logs/` 目录
2. **清理空模板**：删除超过 30 天且未填写的空模板（checkbox 未勾选 + 无文字描述）
3. **清理已处理记录**：删除标记为已应用的旧记录
4. 读取所有有内容的 skill-log，提取问题描述和改进建议
5. 按技能分组，合并同类建议
6. 生成改进建议草稿到 `workspace/skill-evolution/improvements-draft.md`
7. 展示汇总结果：各技能的使用次数、问题数量、改进建议数

### 输出
- `workspace/skill-evolution/improvements-draft.md`

### 草稿格式
```markdown
# 技能改进建议

## 汇总
| 技能 | 使用次数 | 有问题 | 改进建议数 |
|------|---------|--------|-----------|
| implementing | 5 | 2 | 3 |
| testing | 3 | 0 | 0 |

## 待审核改进

### 改进 1: implementing — 缺少 @dnd-kit 跨列拖拽指导
- 来源：task-003, task-007
- 问题：跨列拖拽时需要手动计算 position，技能未提及
- 建议：在 implementing 的上下文加载指令中增加"参考 @dnd-kit multi-container 示例"

### 改进 2: ...

## 清理记录
- 已删除空模板：3 个（task-001/designing, task-002/testing, ...）
- 已删除过期记录：1 个

## 操作指引
请说出需要应用的改进编号（如"应用第 1、3 条"），然后执行 `skill-evolution apply`。
```

### 约束
- 清理操作前向用户展示将要删除的文件列表
- 改进建议必须指向具体的 skill 文件和修改点，不泛泛而谈
- 合并同类建议时保留所有来源 task-id

## 子命令：apply
根据用户选择的改进建议，修改对应的 SKILL.md。

### 输入
- `workspace/skill-evolution/improvements-draft.md`
- 用户指定的编号（如"应用第 1、3 条"）

### 执行步骤
1. 读取 improvements-draft.md
2. 根据用户指定的编号，将对应条目标记为 `✅`
3. 逐条应用：读取对应 SKILL.md，按建议修改
4. 修改前向用户展示 diff
5. 用户确认后写入
6. 在已应用的 skill-log 记录中标记 `已应用`
7. 清理已应用的改进条目

### 输出
- 修改后的 SKILL.md 文件
- 更新后的 improvements-draft.md（已应用条目标记删除）

### 约束
- 修改 SKILL.md 前必须向用户展示 diff 并确认
- 只修改用户选择的条目
- 保留修改记录（在 SKILL.md 末尾追加变更日志）
