# DevAgent Harness

一套面向**软件开发**的通用 AI 工作流工具箱。让 AI Agent 按照规范化的流程完成开发任务：先计划，再实现，再验证，再审查。

不限定语言、不限定领域——前端、后端、基础设施，任何开发任务都能用。

## 核心理念

```
可靠性 = 流程约束 + 精准上下文 + 阶段产出 + 经验闭环
```

| 理念 | 含义 |
|------|------|
| 流程约束 | 工作流定义好阶段顺序，AI 不能跳步 |
| 精准上下文 | 每个阶段只加载需要的 skill + 相关文件，不浪费 token |
| 阶段产出 | 每步输出一个 markdown 文件，既是证据也是下游输入 |
| 经验闭环 | 踩坑记录沉淀为 knowledge，下次同类任务自动带上 |

## 架构

采用**通用层 + 项目层**的两层结构：

```
┌─────────────────────────────────────────┐
│         Harness 仓库（本仓库）            │
│                                         │
│  workflows/       工作流编排              │
│  skills/          通用技能                │
│  context-rules/   上下文加载策略          │
│  skill-interface.md  Skill 接口规范       │
│  templates/       默认产出模板            │
└──────────────────┬──────────────────────┘
                   │ 通过 submodule 嵌入
                   ▼
┌─────────────────────────────────────────┐
│            目标项目（项目层）              │
│                                         │
│  knowledge/                             │
│  ├── skills/      项目定制的阶段技能      │
│  ├── standards/   项目编码规范            │
│  ├── patterns/    项目最佳实践            │
│  ├── lessons/     项目经验教训            │
│  └── _index.md    知识索引               │
│                                         │
│  .harness/workspace/  运行时产物          │
└─────────────────────────────────────────┘
```

- **通用层**（本仓库）：定义工作流编排逻辑、Skill 接口规范、通用技能。所有项目共用，由 Harness 维护者更新。
- **项目层**（`knowledge/`）：项目特定的技能实现、编码规范、经验教训。由项目团队 + AI（knowledge-init）共同维护。

## 工作流

内置 4 种工作流，覆盖常见开发场景：

| 工作流 | 阶段 | 适用场景 |
|--------|------|----------|
| **feature** | 设计 → 计划 → 实施 → 测试 → 审查 → 复盘 → Git | 新功能开发 |
| **bugfix** | 计划 → 实施 → 测试 → 审查 → 复盘 → Git | Bug 修复 |
| **refactor** | 设计 → 计划 → 实施 → 测试 → 审查 → 复盘 → Git | 代码重构 |
| **project-init** | 初始化 → 复盘 → Git | 从零搭建项目 |

每个阶段都有明确的输入/输出定义和 gate 控制（需用户确认才能进入下一阶段）。

## 通用技能

| 技能 | 说明 |
|------|------|
| **knowledge-init** | 知识库初始化与维护。扫描项目代码自动生成编码规范、代码模式、阶段技能 |
| **reflecting** | 项目复盘 + 经验收集。两阶段：自动复盘生成草稿 → 手动收集到知识库 |
| **skill-evolution** | 技能自成长。汇总 skill-logs，发现技能不足并持续优化 |
| **state-checkpoint** | 状态记录与断点恢复。支持任务中断后从断点继续 |
| **project-init** | 从零开始的项目初始化（技术选型 + 标准定制 + 脚手架搭建） |

## 使用方式

### 1. 作为 submodule 添加到项目

```bash
git submodule add <harness-repo-url> .harness
```

### 2. 初始化知识库

在 AI 对话中说：

```
初始化知识库
```

AI 会执行 `knowledge-init scan` 扫描项目代码，生成 `knowledge/` 目录下的规范、模式和阶段技能。

### 3. 开始开发

给 AI 一个开发任务，它会自动识别工作流并按阶段执行：

```
实现用户登录注册功能
```

AI 将按 设计 → 计划 → 实施 → 测试 → 审查 的流程逐步推进，每个阶段产出结构化文件并等待确认。

### 4. 收集经验

任务完成后，AI 自动生成经验草稿。审核后可收集到知识库：

```
收集第 1、3 条经验
```

### 5. 技能进化

定期汇总技能执行记录，优化技能：

```
skill-evolution review
```

## 目录结构

```
.harness/
├── harness.md              # Agent 入口（必读）
├── skill-interface.md      # Skill 接口规范
├── context-rules/          # 上下文加载策略
├── docs/                   # 设计文档
├── skills/                 # 通用技能
│   ├── knowledge-init/     # 知识库初始化
│   ├── reflecting/         # 复盘 + 经验收集
│   ├── skill-evolution/    # 技能自成长
│   ├── state-checkpoint/   # 状态记录与断点恢复
│   └── project-init/       # 项目初始化
├── templates/              # 默认产出模板
├── workflows/              # 工作流定义
│   ├── feature.yaml
│   ├── bugfix.yaml
│   ├── refactor.yaml
│   └── project-init.yaml
└── workspace/              # 运行时产物（gitignore）
    └── {task-id}/
        ├── task.md
        ├── design.md
        ├── task-plan.md
        ├── changes.md
        ├── test-report.md
        ├── review-report.md
        ├── lessons-draft.md
        ├── checkpoint.json
        └── skill-logs/
```

## 关键特性

- **流程约束**：工作流定义阶段顺序，AI 不能跳步，每个阶段必须有产出
- **按需加载**：每个阶段只加载需要的 skill 和上下文，不浪费 token
- **阶段产出**：每步输出 markdown 文件，既是证据也是下游输入
- **经验闭环**：踩坑记录沉淀为知识，下次同类任务自动带上
- **技能自成长**：通过 skill-log 记录执行情况，持续优化技能
- **断点恢复**：支持任务中断后从 checkpoint 继续执行
- **零依赖**：核心产物就是文件，不依赖数据库或复杂框架

## License

MIT
