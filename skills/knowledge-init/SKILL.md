---
name: knowledge-init
description: 知识库初始化与维护。手动触发：用户说"初始化知识库"或"knowledge-init {sub_command}"。子命令：scan（扫描项目生成 standards/patterns）、skills（生成业务 skill 目录和模板）、optimize（整理索引、合并重复、归档过期条目）。
---

# Knowledge Init Skill

## Overview
通过阅读项目代码自动生成和维护知识库，包含扫描、技能生成、优化三个子命令。

## 触发方式
- **触发条件**：用户主动调用
- **调用方式**：
  - 对话中说"初始化知识库"或"knowledge-init"
  - 执行 `knowledge-init {sub_command}`
- **子命令**：scan / skills / optimize

## 子命令：scan
扫描项目，生成 knowledge 初版。

### 执行步骤
1. 读取项目配置文件，识别技术栈和框架
2. 扫描项目目录结构，理解模块划分
3. 分析代码风格（命名规范、文件组织、import 风格等）
4. 分析测试策略（测试框架、测试组织方式、覆盖率配置等）
5. 生成 knowledge/standards/code-style.md
6. 生成 knowledge/standards/testing-rules.md
7. 提取项目中的常见模式到 knowledge/patterns/
8. 生成 knowledge/_index.md 推荐列表

### 输出
- knowledge/standards/code-style.md
- knowledge/standards/testing-rules.md
- knowledge/patterns/*.md
- knowledge/_index.md

### 约束
- 生成的规范必须基于项目实际代码，不臆造

## 子命令：skills
生成业务 skill 目录和默认模板。

### 执行步骤
1. 读取 skill-interface.md 获取接口规范
2. 为每个业务 skill 创建目录（.harness/knowledge/skills/{name}/）
3. 为每个 skill 生成默认 skill.md（基于接口规范）
4. 为每个 skill 的 templates/ 生成默认报告模板

### 输出
- .harness/knowledge/skills/{name}/skill.md
- .harness/knowledge/skills/{name}/templates/*.md

### 约束
- 生成的 skill 必须符合 skill-interface.md 定义的接口规范
- 生成的报告模板作为默认模板，项目可覆盖

## 子命令：optimize
整理索引、合并重复、归档过期条目。

### 执行步骤
1. 扫描 knowledge/lessons/ 和 knowledge/patterns/
2. 识别标签高度重合的条目，建议合并
3. 检查过期条目（90 天未引用），标记 status: archived
4. 更新 _index.md 推荐列表

### 输出
- 更新 knowledge/lessons/*.md（status 字段）
- 更新 knowledge/_index.md

### 约束
- optimize 操作需向用户确认后再执行

## 知识文件格式

所有知识文件使用 frontmatter 携带元数据：

```markdown
---
tags: [concurrency, race-condition]
confidence: 0.8
created: 2026-06-20
last_used: 2026-06-24
use_count: 3
source_task: task-xxx
status: active
---

# 标题

## 场景
...

## 问题
...

## 解决方案
...
```

## 淘汰规则
1. **过期淘汰**：创建超过 90 天且 use_count = 0 → 移入 knowledge/archive/
2. **低置信度淘汰**：confidence < 0.3 → 归档
3. **重复合并**：两条教训标签高度重合且场景相似 → 合并为一条
4. **晋升机制**：use_count >= 5 且 confidence >= 0.8 → 建议提升为 pattern（人工确认）
