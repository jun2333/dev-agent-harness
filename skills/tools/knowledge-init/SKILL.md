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

### 确定性输入（从项目文件读取）
- 项目配置文件（package.json / go.mod / pyproject.toml 等）
- 项目目录结构
- 代码文件的命名和组织方式
- 测试配置文件和测试目录结构

### 语义判断（基于输入推断）
- 代码风格总结（命名规范、import 风格等）
- 测试策略归纳（框架选择、组织方式等）
- 常见模式识别和提炼

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
4. **读取框架标准模板**：从 `.harness/skills/domain-templates/` 加载 5 个标准 skill 模板
   - designing.md
   - task-planning.md
   - implementing.md
   - testing.md
   - reviewing.md
5. 为上述 6 个阶段技能各创建目录（knowledge/skills/{name}/）
6. 为每个 skill 生成 SKILL.md，**基于框架模板 + 项目特定内容**：
   - **保留模板中的通用规范**（Summary for downstream、Anti-Cherry-Pick、Decision Log 等）
   - **填充项目特定内容**：
     - **角色**：基于项目技术栈调整（如"熟悉本项目的 Next.js + tRPC 体系"）
     - **上下文加载指令**：基于项目实际技术栈（从 scan 产出中获取），告诉 AI 该加载哪些文件、参考哪些 pattern
     - **执行步骤**：贴合项目实际的执行流程（如"运行 npx vitest"而非泛泛的"运行测试"）
     - **约束**：引用项目特定的规范文件（如 knowledge/standards/code-style.md）
     - **verification_commands**：根据项目技术栈生成具体的验证命令列表（如 `npm run test:unit`、`npx playwright test`、`npm run build`）
7. 为需要的 skill 生成 templates/ 产出模板（如项目需要覆盖框架默认模板）

### 示例：scan 发现项目使用 tRPC + Prisma + Vitest
则生成的技能中应包含：
- designing 的上下文加载指令应提到"读取 prisma/schema.prisma 了解数据模型"
- implementing 的上下文加载指令应提到"参考 patterns/trpc-router.md 创建新的 router"
- testing 的执行步骤应提到"运行 npx vitest"而非泛泛的"运行测试"
- reviewing 的约束应引用 standards/code-style.md 中的具体规范
- **但所有 skill 都保留框架模板中的通用规范**（Summary、Anti-Cherry-Pick、Decision Log）

### 输出
- knowledge/skills/{name}/SKILL.md
- knowledge/skills/{name}/templates/*.md（如需要）

### 约束
- 所有内容必须基于 scan 产出，不能凭空捏造
- 生成的 skill 必须符合 skill-interface.md 定义的接口规范
- **必须保留框架模板中的通用规范**，不能遗漏
- 生成的报告模板作为默认模板，项目可覆盖

## 子命令：optimize
整理索引、合并重复、归档过期条目。

### 确定性输入（从知识库文件读取）
- knowledge/lessons/ 和 knowledge/patterns/ 下所有文件的 frontmatter
- 各文件的 tags、confidence、use_count、created、last_used
- 各文件的 source_refs 和 invalidation_condition

### 语义判断（基于输入推断）
- 哪些条目重复需要合并（基于标签和场景相似度）
- 哪些条目因回源文件变更而需要更新或归档
- 哪些条目可以晋升为 pattern

### 执行步骤
1. 扫描 knowledge/lessons/ 和 knowledge/patterns/
2. 对有 `source_refs` 的条目，检查关联源码文件是否有变更，有变更则标记待审核
3. 识别标签高度重合的条目，建议合并
4. 检查过期条目（90 天未引用且无 source_refs），标记 status: archived
5. 更新 _index.md 推荐列表

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
invalidation_condition: "当 XX 库升级到 vN 且 API 变更时，本条经验失效"
source_refs: [src/path/to/file.ts, src/path/to/other.ts]
---

# 标题

## 场景
...

## 问题
...

## 解决方案
...
```

### 字段说明
- `invalidation_condition`：描述什么情况下这条经验会过时，必须是具体可验证的条件（如"NextAuth 升级到 v6"、"Prisma 移除单例模式"），不能是模糊描述（如"框架更新时"）
- `source_refs`：关联的源码文件路径列表，用于日后验证经验是否仍然有效。`optimize` 子命令会检查这些文件是否有变更

## 淘汰规则
1. **回源检查**（优先）：`source_refs` 指向的文件存在变更 → 触发失效判断，人工确认后更新或归档
2. **过期淘汰**：创建超过 90 天且 use_count = 0 且无 `source_refs` → 移入 knowledge/archive/
3. **低置信度淘汰**：confidence < 0.3 → 归档
4. **重复合并**：两条教训标签高度重合且场景相似 → 合并为一条
5. **晋升机制**：use_count >= 5 且 confidence >= 0.8 → 建议提升为 pattern（人工确认）
