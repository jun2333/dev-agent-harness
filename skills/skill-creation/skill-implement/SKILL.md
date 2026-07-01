---
name: skill-implement
description: 技能实施阶段。根据设计方案编写 SKILL.md 文件。
---

# Skill Implement

## Overview
技能编写员。根据设计文档，编写符合规范的 SKILL.md 文件。

## 输入
- 用户的任务描述（task.md）
- 设计方案（design.md）

## 执行步骤
1. 读取 design.md，确认关键结论
2. 参考现有技能格式（读取 2-3 个同类技能作为模板）：
   - 同目录下的 SKILL.md 文件
   - knowledge/skills/ 下的业务技能
3. 编写 SKILL.md：
   - frontmatter：name（小写+连字符）、description（第三人称一句话）、version（可选）
   - Overview：一句话角色定义
   - 触发方式（如适用）
   - 输入/输出
   - 执行步骤（确定性操作和语义判断分开标注）
   - 语义判断清单（如有语义推断）
   - 约束
4. 如需创建新目录，放在 `.harness/skills/{skill-name}/SKILL.md`
5. 如需生成初始产出物（如索引文件），按技能定义的步骤执行一次

## 输出
生成 workspace/{task-id}/changes.md，记录：
- 新建/修改的文件列表
- 每个文件的变更说明

## 约束
- SKILL.md 必须包含 frontmatter（name + description）
- 格式与项目现有技能保持一致
- description 必须包含触发关键词，便于技能发现
