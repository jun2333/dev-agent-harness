---
name: tech-audit
description: 扫描项目前后端技术资产（组件、API、工具），生成结构化索引到 knowledge/component-index.md。手动触发，用于设计阶段快速了解已有资产，避免全量扫描代码。
---

# Tech Audit Skill

## Overview
项目资产审计员。扫描项目源码，提取组件/API/工具的结构化信息，生成可查阅的技术资产索引。

## 触发方式
- 纯手动，开发者在对话中要求"跑一下 tech-audit"、"更新组件索引"或类似指令时触发
- 不绑定 workflow 阶段，独立技能
- 典型触发时机：完成一个需求后归档新资产，或开始新需求设计前更新索引

## 扫描范围

按以下顺序扫描 6 类资产，每类有明确的目录和提取规则：

### 1. UI 基础组件
- **目录**：`src/shared/components/ui/`
- **粒度**：每个 `.tsx` 文件 = 一个组件
- **提取**：组件名（PascalCase 文件名）、关键 props（从函数参数/interface 提取）、职责（基于组件名+代码推断）

### 2. 业务组件
- **目录**：`src/features/*/components/`
- **分组**：按 feature 目录分组（auth、projects、tasks、admin 等）
- **粒度**：每个 `.tsx` 文件 = 一个组件
- **提取**：组件名、职责、关键 props、使用场景
- **使用场景推断**：grep 组件名在 `src/app/` 和其他 feature 中的 import 引用

### 3. 通用组件
- **目录**：`src/shared/components/` 下非 `ui/` 子目录的 `.tsx` 文件
- **提取**：同业务组件

### 4. API 路由
- **目录**：`src/app/api/`
- **粒度**：每个 `route.ts` 文件 = 一个 API 端点
- **提取**：路径、HTTP 方法、功能简述、输入参数、返回格式
- **特殊处理**：`[...nextauth]` 和 `[trpc]` 是框架路由，简要标注即可

### 5. tRPC Routers
- **目录**：`src/server/trpc/routers/`
- **粒度**：每个 router 文件 = 一个 API 模块，每个 procedure key = 一个 API
- **提取**：router 名、procedure 名、类型（query/mutation）、输入 schema 摘要、功能简述

### 6. 共享工具
- **目录**：`src/shared/utils/`
- **粒度**：每个 `.ts` 文件 = 一个工具模块
- **提取**：模块名、export 的函数/常量列表、每个的用途

## 输出格式

写入 `knowledge/component-index.md`，覆盖写入。格式如下：

```markdown
# 项目技术资产索引

> 最后更新：{YYYY-MM-DD}
> 生成方式：tech-audit 技能

## UI 基础组件

| 组件 | 职责 | 关键 Props |
|------|------|-----------|
| Button | 基础按钮，支持变体和尺寸 | variant, size, disabled, className |

## 业务组件

### Auth

| 组件 | 职责 | 关键 Props | 使用场景 |
|------|------|-----------|---------|
| LoginForm | 邮箱密码登录表单 | 无 | /login 页面 |

### Projects
...

### Tasks
...

### Admin
...

## 通用组件

| 组件 | 职责 | 关键 Props | 使用场景 |
|------|------|-----------|---------|
| Header | 全局顶部导航栏 | 无 | dashboard, admin |

## API 路由

| 路径 | 方法 | 功能 | 输入 | 返回 |
|------|------|------|------|------|
| /api/upload | POST | 文件上传 | multipart file | { url, filename } |

## tRPC Routers

### auth

| Procedure | 类型 | 功能 | 输入 |
|-----------|------|------|------|
| register | mutation | 邮箱验证码注册 | email, password, name, code |

### projects
...

## 共享工具

| 模块 | 导出 | 用途 |
|------|------|------|
| cn | cn(...classes) | Tailwind class 合并 |
```

## 执行步骤

1. **收集文件列表**（确定性操作）
   - 扫描上述 6 个目录，列出所有目标文件
   - 排除 `index.ts`、`types.ts` 等纯导出/类型文件（除非包含组件定义）

2. **逐个读取文件，提取信息**（确定性 + 语义判断混合）
   - 确定性：组件名、文件名、procedure 名、HTTP 方法、export 列表
   - 语义判断：职责描述、功能简述、使用场景（基于代码内容推断）

3. **推断使用场景**（确定性操作）
   - 对业务组件和通用组件，grep 组件名在 `src/app/` 中的引用
   - 确定被哪些页面使用

4. **组装 Markdown**
   - 按上述格式组装表格
   - 空分组（如某个 feature 下没有组件）不输出该分组

5. **写入文件**
   - 覆盖写入 `knowledge/component-index.md`
   - 报告生成了多少条目

## 语义判断清单

以下信息无法从代码结构直接得出，需要基于代码内容推断：

| 判断项 | 推断依据 |
|--------|---------|
| 组件职责一句话 | 组件名 + 内部 JSX 结构 + 调用的 hooks/mutations |
| 组件使用场景 | grep import 引用 + 所在页面路由 |
| Procedure 功能简述 | procedure 名 + 内部逻辑（查/写/删） |
| 工具函数用途 | 函数名 + 实现逻辑 |

## 约束

- 索引文件使用 Markdown 表格，保持简洁，不展开代码细节
- 职责描述控制在一句话内（不超过 20 字）
- 不扫描 `node_modules`、`.next`、`.harness`、`knowledge/` 等非业务目录
- 不做组件依赖关系图（需要时 grep 即可）
- 如果某个目录不存在，跳过该分类，不报错
- 生成的索引文件必须可直接被 designing 技能引用
