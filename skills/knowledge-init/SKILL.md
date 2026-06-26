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
9. 在项目根目录生成 AGENTS.md，引导 agent 读取 `.harness/harness.md` 启动工作流

### 输出
- knowledge/standards/code-style.md
- knowledge/standards/testing-rules.md
- knowledge/patterns/*.md
- knowledge/_index.md
- AGENTS.md（项目根目录，引导 agent 使用 harness 工作流）

### 约束
- 生成的规范必须基于项目实际代码，不臆造

## 子命令：skills
基于 scan 产出的知识库（standards/、patterns/），生成贴合项目实际的工作流阶段技能。

**核心原则：所有内容必须从 scan 产出中推导，不能凭空捏造。**

**业务 skill = 工作流的阶段技能**，不是项目的业务领域模块。固定为以下 6 个：
- `designing` — 技术设计阶段
- `task-planning` — 任务计划阶段
- `implementing` — 实施阶段
- `testing` — 测试阶段
- `reviewing` — 审查阶段
- `git-operations` — Git 提交与回滚

### 前置条件
- 必须先执行 `scan`，确保 knowledge/standards/ 和 knowledge/patterns/ 已生成

### 执行步骤
1. 读取 skill-interface.md 获取接口规范
2. 读取 knowledge/standards/ 了解项目编码规范和测试规范
3. 读取 knowledge/patterns/ 了解项目的代码模式和架构惯例
4. 为上述 6 个阶段技能各创建目录（knowledge/skills/{name}/）
5. 为每个 skill 生成 SKILL.md，内容必须包含：
   - **角色**：该阶段的职责定位
   - **输入**：该阶段需要什么
   - **上下文加载指令**：基于项目实际技术栈（从 scan 产出中获取），告诉 AI 该加载哪些文件、参考哪些 pattern
   - **执行步骤**：贴合项目实际的执行流程
   - **输出**：产出文件说明
   - **约束**：基于项目规范的约束条件
6. 为需要的 skill 生成 templates/ 产出模板

### 示例：scan 发现项目使用 tRPC + Prisma + Vitest
则生成的技能中应包含：
- designing 的上下文加载指令应提到"读取 prisma/schema.prisma 了解数据模型"
- implementing 的上下文加载指令应提到"参考 patterns/trpc-router.md 创建新的 router"
- testing 的执行步骤应提到"运行 npx vitest"而非泛泛的"运行测试"
- reviewing 的约束应引用 standards/code-style.md 中的具体规范

### 输出
- knowledge/skills/{name}/SKILL.md
- knowledge/skills/{name}/templates/*.md（如需要）

### 约束
- 所有内容必须基于 scan 产出，不能凭空捏造
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
