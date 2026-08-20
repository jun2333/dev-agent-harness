---
name: tech-audit
description: 生成/刷新技术资产索引 knowledge/component-index.md。清单骨架由 asset-index.js 脚本机械生成（组件/API 端点/工具模块，永不过期），LLM 补充职责/功能/用途描述。手动触发，用于设计阶段快速了解已有资产。
---

# Tech Audit Skill

## Overview
项目资产审计员。负责维护 `knowledge/component-index.md`——"项目有什么"的资产地图，供 designing 等阶段按需读取，避免全量扫描代码。

## 触发方式
- 纯手动，开发者在对话中要求"跑一下 tech-audit"、"更新组件索引"或类似指令时触发
- 不绑定 workflow 阶段，独立技能
- 典型触发时机：完成一个需求后归档新资产，或开始新需求设计前更新索引

## 分工原则（脚本管清单，LLM 管描述）

| 环节 | 谁做 | 内容 |
|------|------|------|
| **清单骨架** | `asset-index.js` 脚本 | 组件/端点/工具模块清单、props、HTTP 方法、使用场景（import 引用）、导出列表——机械提取，永不过期 |
| **职责/功能/用途描述** | LLM（本技能） | 每条组件"是干嘛的"、API 端点"什么功能"、工具"什么用途"——语义判断 |

> 为什么要分工：清单过期会误导设计（以为组件不存在/存在），脚本保证"有什么"永远准确；描述是语义的，脚本猜不准，交给 LLM 精读代码后补。

## 执行步骤

1. **脚本生成骨架**（确定性操作）：
   ```
   node .harness/tools/asset-index.js
   ```
   生成 `knowledge/component-index.md`，包含全部资产清单 + 从代码提取的机械信息。既有描述自动保留，新条目描述留空。

2. **LLM 补描述**（语义操作）：精读代码，为**描述为空**的条目补上职责/功能/用途，直接编辑索引文件：
   - 组件：读组件源码（JSX 结构 + 调用的 hooks/mutations），一句话描述职责
   - API 端点：读 route.ts，看调用的服务层函数，一句话描述功能
   - 工具/服务模块：读导出函数实现，一句话描述用途
   - 已有描述不重复改，只补空的和明显过时的

3. **校验**（可选）：
   ```
   node .harness/tools/asset-index.js --check
   ```
   校验清单是否与代码一致（缺/多条目 exit 1）。

4. **报告**：告知更新了多少条目、补了多少描述。

## 扫描范围（脚本自动覆盖）

| 分类 | 目录 | 条目粒度 |
|------|------|---------|
| UI 基础组件 | `src/shared/components/ui/*.tsx` | 每文件 = 一组件 |
| 业务组件 | `src/features/*/components/*.tsx` | 每文件 = 一组件，按 feature 分组 |
| 通用组件 | `src/shared/components/*.tsx`（非 ui） | 每文件 = 一组件 |
| API 端点 | `src/app/api/**/route.ts` | 每文件 = 一端点，含 HTTP 方法 |
| 共享工具 | `src/shared/utils/*.ts` | 每文件 = 一模块，含导出列表 |
| 前端 API 客户端 | `src/lib/api/*.ts` | 每文件 = 一模块 |
| 服务层 | `src/server/services/*.ts` | 每文件 = 一模块 |

## 语义判断清单（LLM 负责，依据代码推断）

| 判断项 | 推断依据 |
|--------|---------|
| 组件职责一句话 | 组件名 + 内部 JSX 结构 + 调用的 hooks/mutations |
| API 端点功能 | route.ts 调用的服务层函数 + 请求/响应形状 |
| 工具/服务函数用途 | 函数名 + 实现逻辑 |

## 约束

- 描述控制在一句话内（不超过 20 字），保持表格简洁
- 只补空描述和明显过时的描述；已有准确描述不重写
- 不修改脚本生成的清单结构（组件名/端点路径/方法列）——那会与 --check 冲突
- 不扫描 `node_modules`、`.next`、`.harness`、`knowledge/` 等非业务目录（脚本已排除）
- 生成的索引文件必须可直接被 designing 技能引用（designing 第 2 步读取）
