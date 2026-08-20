# DevAgent Harness — 设计文档

## 定位

一套面向**软件开发**的通用 AI 工作流工具箱。不限定语言、不限定领域——前端、后端、基础设施，任何开发任务都能用。

本质是一组精心设计的 **skills（技能提示词）+ workflows（工作流）+ knowledge（经验知识）** 文件集合，让 AI 按照靠谱的流程完成开发任务。

不依赖数据库，不依赖复杂框架——核心产物就是**文件**。

---

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

---

## Skill 分层架构

采用**通用层 + 项目层**的两层结构，类似工作流体系：

```
┌─────────────────────────────────────────────────────────────┐
│                    Harness 仓库（通用层）                     │
│                                                             │
│  ├── workflows/             # 工作流（模板：阶段顺序、gate、sections、verify）│
│  ├── workflow-schema.json   # 工作流 schema（格式校验）       │
│  ├── context-rules/         # 上下文加载策略                  │
│  ├── skill-interface.md     # Skill 接口规范（目录结构、格式）│
│  ├── tools/                 # 运行时工具：verify / workflow-lib / workflow-init / lessons-apply / knowledge-index │
│  ├── hooks/                 # 门禁：gate-check（按工作流定义校验）│
│  └── skills/                # 通用层技能（五组）               │
│      ├── framework/         # 框架层：reflecting/state-checkpoint/hook-init │
│      ├── skill-creation/    # 技能自举：skill-design/evolution/implement/test │
│      ├── workflow-creation/ # 工作流自举：workflow-design/implement/test      │
│      ├── tools/             # 工具类：knowledge-init/project-init/tech-audit │
│      └── domain-templates/  # 框架模板：designing/.../reviewing            │
│                                                             │
│  ▲ 定义 workflow 模板 + skill 接口规范 + 门禁/验证工具        │
│  ▲ 不含任何领域特定的业务 skill                               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                     通过 submodule
                     嵌入到项目
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    目标项目（项目层）                          │
│                                                             │
│  knowledge/skills/                                 │
│  ├── designing/           ← 项目实现的 designing skill       │
│  │   ├── skill.md           （skill 入口 prompt）            │
│  │   ├── templates/         （该技能的产出模板）              │
│  │   │   └── design-output.md                                │
│  │   └── scripts/           （可选，该技能需要的脚本）        │
│  ├── task-planning/                                         │
│  ├── implementing/                                          │
│  ├── testing/                                               │
│  ├── reviewing/                                             │
│  ├── git-operations/                                        │
│  └── project-init/                                          │
│                                                             │
│  knowledge/workflow/                                 │
│  └── {name}/               ← 项目定制的工作流（workflow-init 实例化）│
│      └── workflow.yaml                                       │
│                                                             │
│  knowledge/                                        │
│  ├── standards/           ← 项目编码规范、测试规范            │
│  ├── patterns/            ← 项目最佳实践、代码模式            │
│  ├── lessons/             ← 项目经验教训                      │
│  ├── archive/             ← 归档知识                          │
│  └── _index.md                                              │
│                                                             │
│  ▲ 项目特定的 skill 实现 + 工作流实例 + 知识 + 规范        │
└─────────────────────────────────────────────────────────────┘
```

### 分层职责

| 层级 | 位置 | 内容 | 维护者 |
|------|------|------|--------|
| 通用层 | harness 仓库 | 工作流模板 + skill 接口规范 + 通用层技能（framework / skill-creation / workflow-creation / tools / domain-templates 五组）+ 门禁/验证工具 | harness 维护者 |
| 项目层 | `knowledge/` | 项目特定 skill 实现（含 git-operations）+ **工作流实例（workflow/）** + 项目规范/经验/模板 | 项目团队 + Agent（knowledge-init） |

### Skill 接口规范

每个项目 skill 目录必须包含：

| 文件/目录 | 必需 | 说明 |
|-----------|------|------|
| `skill.md` | 是 | 技能入口，包含角色定义、输入要求、执行步骤、输出规范、上下文指令 |
| `templates/` | 否 | 该技能的产出模板，如 `design-output.md` |
| `scripts/` | 否 | 该技能需要的辅助脚本（如测试执行脚本、lint 脚本等） |

`skill.md` 必须包含以下 section：

```markdown
# [Skill Name] Skill

## 角色
[这个阶段 AI 扮演什么角色]

## 输入
- [需要什么输入]

## 上下文加载指令
1. [如何加载相关上下文]

## 执行步骤
1. [具体做什么]

## 输出
生成 workspace/{task-id}/xxx.md，格式见 templates/xxx.md

## 约束
- [约束条件]
```

### 运行时加载优先级

当项目层和通用层存在同名内容时：

1. **Skill 实现**：`knowledge/skills/{name}/skill.md` 覆盖 harness 默认（如有）
2. **报告模板**：`knowledge/skills/{name}/templates/` > harness 仓库 `templates/`
3. **项目规范**：`knowledge/standards/` 由 skill 的上下文加载指令主动读取
4. **最佳实践**：`knowledge/patterns/` 通过 `_index.md` 语义匹配加载

### 知识库维护入口

知识库的写入/修改**只能通过以下 skill**，避免随意污染：

| Skill | 子命令 | 操作 |
|-------|--------|------|
| knowledge-init | scan | 扫描项目生成 standards / patterns 初版 |
| knowledge-init | skills | 生成业务 skill 目录和默认模板 |
| knowledge-init | workflow-init | 工作流模板实例化：把通用工作流复制到 knowledge/workflow/ 并增强（init/sync/list，绑定项目命令池） |
| knowledge-init | optimize | 整理索引、合并重复、归档过期条目 |
| reflecting | 阶段一 | 生成经验草稿（lessons-draft.md），不直接写入知识库 |
| reflecting | 阶段二 | 收集用户审核通过的经验，写入 lessons/ |

---

## 项目结构

```
dev-agent-harness/
│
├├── workflows/                     # 工作流（5 个，目录式：workflow.yaml + check/）
│   ├── feature/                   # 新功能开发流程（含 verify.checks: [unit, lint]；代码重构也走此流程）
│   ├── bugfix/                    # Bug 修复流程
│   ├── project-init/              # 从零开始的项目初始化流程
│   ├── skill-creation/            # 技能创建/重构流程（含 check/skill-check.js）
│   └── workflow-creation/         # 工作流创建流程（含 check/workflow-check.js）
│
├── workflow-schema.json           # 工作流 schema（格式校验）
├── context-rules/                 # 上下文加载策略
│   ├── file-discovery.md          # 如何定位相关文件
│   └── loading-strategy.md        # 各阶段的上下文加载规则
│
├── skills/                        # 通用层技能（五组，按职责分层）
│   ├── framework/                 # 框架层：reflecting / state-checkpoint / hook-init
│   ├── skill-creation/            # 技能自举：skill-design / skill-evolution / skill-implement / skill-test
│   ├── workflow-creation/         # 工作流自举：workflow-design / workflow-implement / workflow-test
│   ├── tools/                     # 工具类：knowledge-init / project-init / tech-audit
│   └── domain-templates/          # 框架模板：designing / task-planning / implementing / testing / reviewing
│
├── skill-interface.md             # Skill 接口规范
├── docs/                          # 设计文档（DESIGN.md + workflow-spec.md）
│
├── templates/                     # 默认产出模板（可被项目层覆盖）
│
├── tools/                         # 运行时工具：verify.js / workflow-lib.js / workflow-init.js / skill-log.js / review-brief.js / simple-yaml.js / lessons-apply.js / knowledge-index.js
├── hooks/                         # 门禁脚本：gate-check.js / check-verify.js / post-tool-log.js / lib.js / install.js
├── changelog/                     # 版本演进记录
└── workspace/                     # 任务执行空间（产物目录）
    └── {task-id}/
        ├── task.md                # 任务描述（用户输入）
        ├── design.md              # 技术设计产出
        ├── task-plan.md           # 任务计划产出
        ├── changes.md             # 变更清单
        ├── test-report.md         # 测试报告
        ├── review-report.md       # 审查报告
        ├── lessons-draft.md       # 经验草稿（待用户审核）
        ├── checkpoint.json        # 状态检查点（断点恢复用）
        └── verify/verification-result.json  # 验证证据（他证）
```

---

## 各模块设计

### 1. harness.md — 主入口

这是用户启动 harness 时加载的第一个 prompt。它负责：
- 理解用户意图，选择合适的工作流
- 按工作流定义的阶段顺序推进
- 在每个阶段加载对应的 skill
- 管理阶段间的上下文传递

```markdown
# DevAgent Harness Agent

你是一个软件开发 Harness Agent。你的工作方式是：
先计划，再实现，再验证，再审查。每个阶段有明确的输入和输出。

## 工作流程

当用户给你一个开发任务时：

1. 读取 workflows/ 目录，选择匹配的工作流
2. 按工作流定义的阶段顺序执行
3. 每个阶段：
   - 加载对应的 skill 文件
   - 按 context-rules 加载相关上下文
   - 执行任务，输出结构化产物到 workspace/
   - 等待用户确认后再进入下一阶段
4. 任务完成后，执行 reflecting skill 阶段一沉淀经验
5. 用户审核草稿后，通过"收集经验"或"reflecting collect {task-id}"触发阶段二

## 关键原则
- 不要跳步，每个阶段都必须有产出
- 上下文按需加载，不要一次性读取所有文件
- 遇到问题主动询问，不要猜测
- 任务结束后提示用户审核经验草稿并收集
```

---

### 2. Skills — 技能定义

Skill 分为两类（仓库根的 `skills/` 按职责分五组：`framework/`、`skill-creation/`、`workflow-creation/`、`tools/`、`domain-templates/`）：

- **通用/框架 skill**（harness 仓库提供，所有项目共用）：`framework/`（reflecting、state-checkpoint、hook-init）、`skill-creation/`（skill-design、skill-evolution、skill-implement、skill-test）、`tools/`（knowledge-init、project-init、tech-audit）
- **业务 skill**（项目层实现）：designing、task-planning、implementing、testing、reviewing、git-operations，由项目通过 `knowledge-init skills` 基于 `domain-templates/` 的框架模板继承生成或人工编写

#### 通用 Skill 示例：reflecting.md

```markdown
# Reflecting Skill

## 角色
你是一位善于总结复盘的技术专家，擅长从实践经验中提炼可复用的知识。

## 阶段一：自动复盘（workflow 最后阶段自动调用）

### 输入
- 任务描述（task.md）
- 技术设计（design.md）
- 任务计划（task-plan.md）
- 测试报告（test-report.md）
- 审查报告（review-report.md）

### 执行步骤
1. 回顾任务执行全过程
2. 对比计划与实际执行的差异
3. 提炼可复用的经验教训
4. 生成经验草稿到 workspace/{task-id}/lessons-draft.md
5. 回溯每个 skill 的执行情况，评估是否存在不足（来源：agent 自检 + 用户反馈）
6. 如发现技能不足，生成 workspace/{task-id}/skill-improvements-draft.md；如无不足则跳过

### 输出
- workspace/{task-id}/lessons-draft.md（项目经验草稿，等待用户审核）
- workspace/{task-id}/skill-improvements-draft.md（技能改进建议草稿，有待审核；如无不足则不生成）

### 约束
- 经验教训必须基于实际执行过程，不臆造
- 每条教训必须有明确的场景、问题和解决方案
- 初始置信度设为 0.5，后续根据引用情况调整
- 不直接写入知识库，只生成草稿供用户审核
- 技能改进建议必须指向具体的 skill 文件和修改点，不泛泛而谈

## 阶段二：手动收集（用户通过编号选择后调用）

### 输入
- workspace/{task-id}/lessons-draft.md（项目经验草稿）
- workspace/{task-id}/skill-improvements-draft.md（技能改进建议草稿，如存在）
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
```

#### 通用 Skill 示例：state-checkpoint.md

```markdown
# State Checkpoint Skill

## 角色
你是一位任务状态管理器，负责记录任务执行进度和提供断点恢复能力。

## 使用场景
1. **记录检查点**：每完成一个 stage 后调用，记录当前进度
2. **恢复任务**：启动时检查是否有未完成的 checkpoint，提示用户是否恢复

## 记录检查点
1. 读取当前任务状态（workspace/{task-id}/checkpoint.json）
2. 更新当前 stage、完成时间、产出文件列表
3. 写回 checkpoint.json

## 恢复任务
1. 扫描 workspace/ 目录，查找有 checkpoint.json 的任务
2. 展示未完成的任务列表和当前进度
3. 用户选择要恢复的任务
4. 加载 checkpoint 中记录的 stage 和上下文，从断点继续

## checkpoint.json 格式

```json
{
  "task_id": "task-001",
  "workflow": "feature",
  "current_stage": "implementing",
  "completed_stages": ["designing", "task-planning"],
  "stage_outputs": {
    "designing": "design.md",
    "task-planning": "task-plan.md"
  },
  "last_updated": "2026-06-24T10:30:00Z",
  "git_commit_before_task": "abc123"
}
```

## 约束
- 每个 stage 完成后必须调用此 skill 记录检查点
- 恢复时必须向用户确认
- 记录任务开始前的 git commit hash，用于回滚
```

#### 通用 Skill 示例：knowledge-init.md

```markdown
# Knowledge Init Skill

## 角色
你是一位知识库管理员，负责通过阅读项目代码自动生成和维护知识库。

## 子命令

### knowledge-init scan
扫描项目，生成 knowledge 初版。

1. 读取项目配置文件，识别技术栈和框架
2. 扫描项目目录结构，理解模块划分
3. 分析代码风格（命名规范、文件组织、import 风格等）
4. 分析测试策略（测试框架、测试组织方式、覆盖率配置等）
5. 生成 knowledge/standards/code-style.md
6. 生成 knowledge/standards/testing-rules.md
7. 提取项目中的常见模式到 knowledge/patterns/
8. 生成 knowledge/_index.md 推荐列表

### knowledge-init skills
生成业务 skill 目录和默认模板。

1. 读取 skill-interface.md 获取接口规范
2. 为每个业务 skill 创建目录（knowledge/skills/{name}/）
3. 为每个 skill 生成默认 skill.md（基于接口规范）
4. 为每个 skill 的 templates/ 生成默认报告模板

### knowledge-init optimize
整理索引、合并重复、归档过期条目。

1. 扫描 knowledge/lessons/ 和 knowledge/patterns/
2. 识别标签高度重合的条目，建议合并
3. 检查过期条目（90 天未引用），标记 status: archived
4. 更新 _index.md 推荐列表

## 约束
- 生成的规范必须基于项目实际代码，不臆造
- 生成的 skill 必须符合 skill-interface.md 定义的接口规范
- 生成的报告模板作为默认模板，项目可覆盖
- optimize 操作需向用户确认后再执行
- 这是知识库的写入入口之一
```

#### 业务 Skill 示例（项目层实现）

以下为 knowledge-init 生成的默认 skill 示例，项目可根据需要修改：

##### knowledge/skills/designing/skill.md

```markdown
# Designing Skill

## 角色
你是一位资深软件架构师，擅长需求分析、技术选型和架构设计。

## 输入
- 用户的任务描述（task.md）
- 项目上下文（通过 context-rules 加载）

## 上下文加载指令
1. 读取 knowledge/_index.md 查找相关经验
2. 如有相关经验，加载对应的 knowledge 文件
3. 根据任务关键词，定位项目中的相关目录和文件：
   - 读取项目配置文件（如 package.json / go.mod / Cargo.toml / pyproject.toml）了解技术栈
   - 扫描相关目录的文件列表（不读内容，只看结构）
   - 只深入读取与任务直接相关的文件（不超过 5 个）
4. 读取 knowledge/standards/ 下的项目规范

## 执行步骤
1. 分析任务需求，提取关键功能点
2. 评估影响范围（哪些文件需要改/新增）
3. 技术方案设计（架构选型、接口设计、数据模型等）
4. 识别风险点和技术决策
5. 如有多个方案，给出对比分析并推荐

## 输出
生成 workspace/{task-id}/design.md，格式见 knowledge/skills/designing/templates/design-output.md

## 约束
- 方案必须贴合项目现有技术栈，不引入不必要的新技术
- 必须列出所有受影响的文件和模块
- 如果任务范围过大，建议拆分为多个子任务
```

##### knowledge/skills/git-operations/skill.md

```markdown
# Git Operations Skill

## 角色
你是一位 Git 版本控制专家，负责代码提交和回滚操作。

## 子命令

### git-operations commit
提交本次任务的代码变更。

1. 读取 workspace/{task-id}/changes.md 了解变更内容
2. 读取 review-report.md 了解审查结果
3. 执行 git status / git diff 检查实际变更
4. 根据项目提交规范生成 commit message（如 Conventional Commits）
5. 执行 git add 和 git commit
6. 如用户要求，执行 git push

### git-operations rollback
回滚代码或任务状态。

1. 读取 checkpoint.json 获取 git_commit_before_task
2. 向用户确认回滚目标（代码回滚 / 阶段回滚）
3. 代码回滚：执行 git checkout {commit} -- .（不修改 git 历史）
4. 阶段回滚：删除目标 stage 之后的产出文件，更新 checkpoint.json
5. 保留 workspace 中的日志文件，不删除执行记录

## 约束
- 提交前必须向用户确认 commit message
- 回滚前必须向用户确认目标
- 遵循宿主项目的提交规范（如 commit message 格式、分支策略等）
- 代码回滚使用 git checkout，不修改 git 历史
```

##### knowledge/skills/project-init/skill.md

```markdown
# Project Init Skill

## 角色
你是一位资深技术顾问，擅长技术选型、项目架构设计和工程化搭建。你通过交互式对话引导用户完成从 0 到 1 的项目初始化。

## 输入
- 用户的项目需求描述（口头或 task.md）
- 用户的技术偏好和约束（如有）

## 执行步骤

### 阶段一：需求分析
1. 与用户对话，明确项目类型（Web/CLI/库/微服务等）
2. 了解核心功能和非功能需求（性能、并发、部署环境等）
3. 确认团队技术背景和偏好
4. 确认约束条件（预算、时间、合规要求等）

### 阶段二：技术选型
1. 基于需求分析，提出 2-3 套技术方案
2. 每套方案包含：语言/框架、数据库、部署方案、关键依赖
3. 对比各方案的优缺点、学习成本、社区生态
4. 给出推荐方案并说明理由
5. 等待用户确认或调整

### 阶段三：标准定制
1. 基于选定的技术栈，生成 coding standards（命名规范、文件组织、import 风格等）
2. 定义测试策略（测试框架、目录结构、覆盖率要求）
3. 定义 Git 工作流（分支策略、commit 规范、PR 流程）
4. 定义 CI/CD 方案（如需要）
5. 等待用户确认或调整

### 阶段四：项目脚手架
1. 生成项目目录结构
2. 生成配置文件（package.json / go.mod / pyproject.toml 等）
3. 生成 .gitignore、README.md、LICENSE
4. 生成 CI/CD 配置文件（如需要）
5. 生成初始代码骨架（如 main 入口、基础目录结构）
6. 等待用户确认

## 输出
- workspace/{task-id}/tech-selection.md（技术选型文档）
- workspace/{task-id}/project-standards.md（项目规范文档）
- 项目脚手架文件（直接生成到项目目录）

## 约束
- 技术选型必须基于用户需求，不推荐用户不熟悉的复杂方案
- 每套方案必须有明确的适用场景和限制
- 项目脚手架必须可运行（至少能启动/编译通过）
- 所有决策必须经用户确认
```

---

### 3. Workflows — 工作流定义

YAML 文件定义阶段序列和阶段间的依赖关系。

#### 示例：workflows/feature/workflow.yaml（工作流结构示意）

```yaml
name: feature
description: 新功能开发与代码重构流程

# 任务开始前
pre_task:
  - skill: skills/state-checkpoint.md    # 记录任务开始前的 git commit
    action: init

stages:
  - name: precondition
    skill: .harness/skills/framework/precondition/SKILL.md   # 确认验收标准来源（需求文档引用或简要需求文档），无则不进入设计
    input: task.md
    output: task.md
    gate: user_approval

  - name: designing
    skill: knowledge/skills/designing/skill.md
    input: task.md
    output: design.md
    gate: user_approval
    post_stage:
      - skill: skills/state-checkpoint.md
        action: save                     # 记录检查点

  - name: task-planning
    skill: knowledge/skills/task-planning/skill.md
    input: [task.md, design.md]
    output: task-plan.md
    gate: user_approval
    post_stage:
      - skill: skills/state-checkpoint.md
        action: save

  - name: implementing
    skill: knowledge/skills/implementing/skill.md
    input: [task.md, design.md, task-plan.md]
    output: changes.md
    gate: none
    post_stage:
      - skill: skills/state-checkpoint.md
        action: save

  - name: testing
    skill: knowledge/skills/testing/skill.md
    input: [task.md, task-plan.md, changes.md]
    output: test-report.md
    gate: user_approval
    on_fail: implementing
    post_stage:
      - skill: skills/state-checkpoint.md
        action: save

  - name: reviewing
    skill: knowledge/skills/reviewing/skill.md
    input: [design.md, changes.md, test-report.md]
    output: review-report.md
    gate: user_approval
    on_fail: implementing
    post_stage:
      - skill: skills/state-checkpoint.md
        action: save

  - name: reflecting
    skill: skills/reflecting.md
    sub_command: reflect                  # 阶段一：自动复盘
    input: [task.md, design.md, task-plan.md, test-report.md, review-report.md]
    output: [lessons-draft.md, skill-improvements-draft.md]
    post_stage:
      - skill: skills/state-checkpoint.md
        action: save

  - name: git-operations
    skill: knowledge/skills/git-operations/skill.md
    sub_command: commit
    input: [changes.md, review-report.md]
    output: changes.md
    gate: user_approval
    optional: true
    post_stage:
      - skill: skills/state-checkpoint.md
        action: complete                 # 标记任务完成

# 任务结束后（可选）
# 用户审核草稿后，通过以下方式调用阶段二：
#   - 对话中说"收集经验"或"reflecting collect"
#   - 执行 reflecting collect {task-id}
post_task:
  - skill: skills/reflecting.md
    sub_command: collect                  # 阶段二：手动收集
    trigger: manual
```

---

### 3.5 工作流机制（2026-08 演进）

工作流从"单 YAML 定义"演进为**自包含工作流**，分两批落地：

#### 第一批：工作流 + 运行时数据驱动

```
workflows/{name}/workflow.yaml     # 步骤定义（stages）+ 产出物要求（sections）+ 测试手段（verify.checks）
workflows/{name}/check/            # 工作流专属校验脚本（可选）
```

- **单一真相源**：产出物必含区块（sections/require_verify）从 gate-check 硬编码迁入 workflow.yaml——新工作流免改 harness 代码
- **gate 数据驱动**：`gate-check.js` 按 `checkpoint.workflow` 加载工作流定义校验产出物；WorkBuddy 用 PreToolUse exit 2 硬阻断，Claude 等宿主用 PostToolUse（脚本双事件兼容）
- **verify 手段两层**：工作流 `check/` 脚本（可编程校验）+ 项目命令池 key（`knowledge/verify.config.json` 的 commands 对象）——他证原则：命令来源只能是工作流声明 + 项目配置，LLM 不能自选
- **文档/技能任务验证对象正确**：skill-creation 只跑 skill-check、workflow-creation 只跑 workflow-check，不再跑项目 vitest/lint
- **创建工作流的流程**：workflow-creation 工作流 + workflow-design/implement/test 技能（与 skill-creation 对称，自身闭环）

#### 第二批：模板语义 + 项目实例化

- **通用工作流 = 模板**：骨架（步骤/产出要求）通用，但测试命令、通过标准必须项目定制（"改代码用什么测试命令、怎么测算通过"由项目决定）
- **项目层 `knowledge/workflow/`**（git 跟踪，与 skills/standards 同属项目层）：项目定制工作流
- **解析顺序**：`knowledge/workflow/{name}/`（项目优先）→ `.harness/workflows/{name}/`（通用兜底）；同名项目版覆盖
- **workflow-init**（knowledge-init 子命令）：`init`（模板实例化 + 命令池强校验 + `--as` 改名 + 溯源注释）/ `sync`（只补齐未定制部分，定制保留报告）/ `list`
- **check 脚本回归工作流**：校验脚本随工作流自包含（非通用脚本不放 tools/），新增 check 零 harness 代码改动

详细规范见 `docs/workflow-spec.md`。

### 3.6 宿主执行差异（CLI/WorkBuddy vs DSH）

同一套通用层机制（工作流 / gate 数据驱动 / verify 他证），在不同宿主环境下**执行方式不同**——机制不变，载体变：

| 维度 | CLI / WorkBuddy（hook 驱动） | DSH（编排器驱动） |
|------|------------------------------|-------------------|
| 流程执行 | LLM 自读 workflow.yaml 按阶段推进（提示词约定） | 编排器（orchestrator）逐阶段驱动干净子代理，失败程序化回退（on_fail） |
| 产出物门禁 | gate-check.js：PreToolUse exit 2 硬阻断（WorkBuddy）/ PostToolUse（Claude） | 数据级：子代理返回 JSON 摘要 + schema 校验（sections_ok/verify_evidence） |
| 人工门禁 | 提示词约定停等 + Stop 收尾提醒 | 流程级：ask_user_question（gate: user_approval 程序化） |
| 危险操作 | 提示词约定 | 工具级：沙箱权限 + 审批（justification，permission/tools 字段驱动） |
| 验证证据 | verify.js 手动执行落盘 verification-result.json | 同一配置 + 编排器校验 verify_evidence 字段 |
| 确定性兜底 | gate-check（产出物+证据对账） | 复用 gate-check.js（bash 直调） |
| 上下文 | 单会话加载 context-rules | 每阶段干净子代理 + 输入白名单（账本消失） |

**单一真相源**：两种宿主都从工作流 `workflow.yaml` 读定义（sections/permission/tools/verify）——`dsh/stage-schema.json` 已删除，不再有第二份阶段定义。

---

### 4. Context Rules — 上下文加载策略

这是让 AI 精准控制上下文的关键。

#### context-rules/loading-strategy.md

```markdown
# 上下文加载策略

## 总原则
- 先概览后细节：先读目录结构，再读文件列表，最后才读文件内容
- 按需加载：只加载当前阶段需要的文件
- 知识库优先：先查 knowledge/，用已有经验指导行动

## 各阶段加载规则

### Designing 阶段
- [必读] task.md, knowledge/_index.md, knowledge/standards/
- [扫描] 项目目录结构（ls 级别，不读文件内容）
- [精读] 与任务直接相关的文件（最多 5 个）
- [选读] 相关 experience 文件（通过 _index.md 匹配）
- Token 预算：~15K tokens

### Task Planning 阶段
- [必读] task.md, design.md
- [参考] knowledge/patterns/ 中相关模式
- Token 预算：~8K tokens

### Implementing 阶段
- [必读] task.md, design.md, task-plan.md
- [精读] task-plan.md 中列出的需要修改的文件
- [参考] knowledge/patterns/ 中相关模式
- Token 预算：~30K tokens

### Testing 阶段
- [必读] task.md, task-plan.md, changes.md
- [精读] 变更的文件 + 对应的测试文件
- [参考] knowledge/standards/testing-rules.md
- Token 预算：~20K tokens

### Reviewing 阶段
- [必读] design.md, changes.md, test-report.md
- [精读] 所有变更文件（完整 diff）
- [参考] knowledge/standards/code-style.md
- Token 预算：~25K tokens
```

#### context-rules/file-discovery.md

```markdown
# 文件发现策略

当需要定位与任务相关的文件时，按以下顺序：

1. 读项目配置文件（package.json / go.mod / Cargo.toml / pyproject.toml 等）→ 确定技术栈和项目结构
2. 扫描源码目录 → 获取模块划分概览
3. 根据任务关键词匹配模块目录
4. 在匹配目录中扫描文件名 → 定位具体文件
5. 只深入读取匹配到的文件

不要：
- 一次性读取所有源代码文件
- 读取依赖目录（node_modules / vendor / .venv 等）、构建产物（dist / build / target 等）
- 读取与任务无关的模块代码
```

---

### 5. Knowledge — 知识库

#### knowledge/_index.md（推荐列表）

```markdown
# 知识推荐

## 高频经验（按使用频率排序）
- lessons/001-xxx.md - 并发请求竞态问题
- lessons/003-yyy.md - 异步加载竞态

## 项目规范
- standards/code-style.md
- standards/testing-rules.md

## 最佳实践
- patterns/error-handling.md - 分层错误处理策略
```

经验文件的格式：

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

# 并发请求竞态问题

## 场景
什么时候会遇到这个问题

## 问题
具体是什么问题

## 解决方案
怎么解决的

## 代码示例
（如适用）
```

---

### 6. Templates — 产出模板

模板现在属于各 skill 目录的一部分（`knowledge/skills/{name}/templates/`）。

harness 仓库的 `templates/` 目录存放默认模板，knowledge-init 初始化时会基于这些默认模板生成项目层的模板。项目可覆盖或自定义。

#### 默认模板示例：task-input.md

```markdown
# 任务：[标题]

## 描述
[要做什么]

## 验收标准
- [ ] 标准 1
- [ ] 标准 2

## 约束
- 技术栈限制：
- 兼容性要求：

## 相关文件（可选）
- path/to/related/files
```

#### 默认模板示例：design-output.md

```markdown
# 技术设计：[任务标题]

## 需求分析
[对任务的理解]

## 影响范围
| 文件/模块 | 操作 | 说明 |
|-----------|------|------|
| path/to/file | 修改 | 添加 xxx 功能 |

## 技术方案
### 架构设计
[整体方案描述]

### 接口/数据模型设计
（如适用）

### 方案对比（如有多个方案）
| 方案 | 优点 | 缺点 | 推荐 |
|------|------|------|------|

## 风险与决策
| 风险 | 影响 | 缓解措施 |
|------|------|---------|
```

#### 默认模板示例：task-plan-output.md

```markdown
# 任务计划：[任务标题]

## 基于设计文档
design.md

## 实施步骤
### Step 1: [步骤名]
- 输入：
- 操作：
- 产出：
- 验证方式：
- 预估工作量：

### Step 2: ...

## 步骤依赖关系
[步骤间的依赖说明]

## 总工作量估算
[预估]
```

---

## 执行流程示意

```
用户: "实现一个用户注册功能"
  │
  ▼
[加载 harness.md] → 识别为 feature 类型 → 加载 workflows/feature/workflow.yaml（工作流）
  │
  ▼
┌─ Stage 1: Designing ─────────────────────────────┐
│  加载: knowledge/skills/designing/       │
│         skill.md                                  │
│  上下文:                                          │
│    - knowledge/_index.md → 匹配到认证相关经验      │
│    - 项目配置 → 发现技术栈                         │
│    - 目录扫描 → 定位相关模块                       │
│  产出: workspace/task-001/design.md               │
│  Gate: 用户确认 ✅                                 │
└──────────────────────────────────────────────────┘
  │
  ▼
┌─ Stage 2: Task Planning ─────────────────────────┐
│  加载: knowledge/skills/task-planning/   │
│         skill.md                                  │
│  上下文:                                          │
│    - design.md（技术方案作为输入）                  │
│  产出: workspace/task-001/task-plan.md            │
│  Gate: 用户确认 ✅                                 │
└──────────────────────────────────────────────────┘
  │
  ▼
┌─ Stage 3: Implementing ──────────────────────────┐
│  加载: knowledge/skills/implementing/    │
│         skill.md + task-plan.md                   │
│  上下文:                                          │
│    - task-plan.md 中列出的文件（精读）              │
│    - knowledge/patterns/ 中的相关模式              │
│  执行: 按 task-plan 的步骤逐个实现                 │
│  产出: workspace/task-001/changes.md              │
└──────────────────────────────────────────────────┘
  │
  ▼
┌─ Stage 4: Testing ───────────────────────────────┐
│  加载: knowledge/skills/testing/         │
│         skill.md                                  │
│  上下文:                                          │
│    - changes.md（知道改了什么）                     │
│    - 变更文件 + 对应测试文件                        │
│  执行: 运行测试、检查覆盖率、验证验收标准           │
│  产出: workspace/task-001/test-report.md          │
│  Gate: 用户确认 ✅                                 │
└──────────────────────────────────────────────────┘
  │
  ▼
┌─ Stage 5: Reviewing ─────────────────────────────┐
│  加载: knowledge/skills/reviewing/       │
│         skill.md                                  │
│  上下文: diff + 项目规范                           │
│  执行: 按 checklist 审查                           │
│  产出: workspace/task-001/review-report.md        │
│  Gate: 用户确认 ✅                                 │
└──────────────────────────────────────────────────┘
  │
  ▼
┌─ Stage 6: Reflecting（阶段一：自动复盘）──────
│  加载: skills/reflecting.md（通用 skill）          │
│  执行: 复盘本次任务                                │
│  产出:                                            │
│    - workspace/task-001/lessons-draft.md          │
│    - workspace/task-001/skill-improvements-draft.md│
│      （如有技能不足；如无则不生成）                  │
│  提示: 请用户审核草稿后调用"收集经验"              │
└──────────────────────────────────────────────────┘
  │
  ▼
┌─ 用户审核经验草稿 ───────────────────────────────┐
│  用户对话中说"收集第 1、3 条"                      │
│  AI 标记 ✅ 后执行 reflecting collect task-001：   │
│    - 勾选的项目经验 → 写入 knowledge/lessons/      │
│    - 勾选的技能改进 → 修改对应 skill 文件          │
└──────────────────────────────────────────────────┘
```

---

## 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 存储 | 文件系统 (markdown/yaml) | 零依赖，可读性好，Git 友好 |
| 技能定义 | Markdown + 目录结构 | LLM 天然擅长理解 markdown，目录结构支持模板/脚本 |
| 工作流 | YAML | 结构清晰，易于编辑和版本管理 |
| 上下文控制 | 规则文件 + 阶段隔离 | 简单直接，不需要向量数据库 |
| 知识检索 | frontmatter + 推荐列表 | 文件自带元数据，AI 可直接扫描，无需维护完整索引 |
| 经验沉淀 | 草稿审核 + 手动收集 | 用户把关质量，避免无关经验污染知识库 |
| 状态管理 | checkpoint.json | 支持断点恢复和回滚，轻量可靠 |
| 阶段门禁 | 用户确认 | 关键节点人工把关，最可靠的质检 |
| 产出格式 | Markdown 模板 | 结构化、可追溯、可归档 |
| 工作流形态 | 自包含工作流（workflow.yaml + check/） | 步骤/产出要求/测试手段内聚；新工作流免改 gate/verify 代码 |
| 工作流分层 | 通用模板（.harness/workflows/）+ 项目实例（knowledge/workflow/） | 父类纯净、项目可定制（测试命令/通过标准项目决定） |
| 校验脚本归属 | 随工作流 check/ | 工作流专属校验自包含，新增 check 零 harness 代码改动 |
| 验证他证 | verify.js 执行 + verification-result.json 证据 | 命令只能来自工作流声明 + 项目命令池，LLM 不能自选；gate 对账 |

---

## 知识生命周期

知识库需要一套机制避免无限膨胀，保持高质量。

### 知识文件格式

每个知识文件使用 **frontmatter** 携带元数据，便于 AI 直接扫描判断相关性：

```markdown
---
tags: [concurrency, race-condition]
confidence: 0.8
created: 2026-06-20
last_used: 2026-06-24
use_count: 3
source_task: task-xxx
status: active          # active / archived
---

# 并发请求竞态问题

## 场景
什么时候会遇到这个问题

## 问题
具体是什么问题

## 解决方案
怎么解决的

## 代码示例
（如适用）
```

### 知识索引机制

`_index.md` 降级为**推荐列表**，只列出高频/高价值知识，不是完整索引：

```markdown
# 知识推荐

## 高频经验（按使用频率排序）
- lessons/001-xxx.md - 并发请求竞态问题
- lessons/003-yyy.md - 异步加载竞态

## 项目规范
- standards/code-style.md
- standards/testing-rules.md

## 最佳实践
- patterns/error-handling.md - 分层错误处理策略
```

AI 在需要时可以：
1. 先读 `_index.md` 获取推荐知识
2. 直接 `ls knowledge/lessons/` 扫描目录
3. 读取文件头部 frontmatter 判断相关性

### 经验审核机制

reflecting 阶段一产出的经验**不直接写入知识库**，而是先写草稿：

```
workspace/{task-id}/lessons-draft.md            ← 项目经验草稿
workspace/{task-id}/skill-improvements-draft.md  ← 技能改进建议草稿（如有不足）
```

#### 项目经验草稿格式

```markdown
# 经验草稿

## 待审核经验

### 经验 1: 并发请求竞态问题
- 标签: concurrency, race-condition
- 置信度: 0.7
- 场景: 多个异步操作共享状态时
- 问题: 后发起的请求覆盖了先发起请求的结果
- 解决方案: 使用 AbortController 或请求队列

### 经验 2: 异步加载竞态
- 标签: async, loading
...

## 操作指引
请说出需要收集的经验编号（如"收集第 1、3 条"），然后执行 `reflecting collect`。
```

#### 技能改进建议草稿格式

```markdown
# 技能改进建议

## 待审核改进

### 改进 1: designing skill — 缺少数据库迁移文件扫描
- 文件: knowledge/skills/designing/skill.md
- 问题: 上下文加载指令未提及扫描 migration 文件，导致设计时遗漏了数据库变更影响
- 建议: 在"上下文加载指令"中增加一步："扫描 db/migrations/ 目录，了解最近的数据库变更"

### 改进 2: testing skill — 测试报告模板缺少性能指标
- 文件: knowledge/skills/testing/templates/test-report-output.md
- 问题: 模板中没有性能测试相关字段
- 建议: 在模板中增加"性能指标"section

## 操作指引
请说出需要应用的改进编号（如"应用第 1、2 条"），然后执行 `reflecting collect`。
```

#### 审核流程

1. reflecting 阶段一生成草稿（经验 + 技能改进建议）
2. 用户对话中说"收集第 1、3 条"或"应用第 1、2 条"
3. AI 将选中的条目标题加上 `✅` 标记
4. 用户执行 `reflecting collect {task-id}`：
   - 勾选的项目经验 → 写入 `knowledge/lessons/`
   - 勾选的技能改进 → 直接修改对应的 skill 文件
5. 如果 agent 和用户均未发现技能不足，不生成 skill-improvements-draft.md，跳过此环节

### 知识分级

| 级别 | 来源 | 保留策略 |
|------|------|---------|
| 规范 (standards) | knowledge-init scan 生成 + 人工维护 | 永久保留，通过 knowledge-init optimize 优化 |
| 模式 (patterns) | knowledge-init scan 生成 + 人工注入 + reflecting 阶段二收集 | 长期保留，定期审核 |
| 教训 (lessons) | reflecting 阶段二收集（经用户审核） | 有生命周期，按规则淘汰 |

### 淘汰规则（由 knowledge-init optimize 执行）

1. **过期淘汰**：创建超过 90 天且 use_count = 0 → 移入 `knowledge/archive/`
2. **低置信度淘汰**：confidence < 0.3 → 归档
3. **重复合并**：两条教训标签高度重合且场景相似 → 合并为一条
4. **晋升机制**：use_count >= 5 且 confidence >= 0.8 → 建议提升为 pattern（人工确认）

### 索引膨胀控制

- `_index.md` 只保留推荐条目（不超过 50 条）
- 归档条目不删除文件，但 status 标记为 archived
- AI 扫描时自动跳过 status: archived 的文件

---

## 使用方式

### 项目结构

harness agent 作为一个独立 Git 仓库维护：

```
dev-agent-harness/         ← 本仓库（通用 harness 定义）
├── harness.md
├── skills/
├── workflows/
├── knowledge/             ← 初始为空，使用时积累
├── context-rules/
├── templates/
└── workspace/             ← 任务产物
```

### 在目标项目中使用

**方式一：Git Submodule（推荐）**

```bash
cd my-project
git submodule add <harness-repo-url> .harness
```

好处：
- harness 版本可锁定，团队共享一致
- 各项目独立积累 knowledge，互不干扰
- harness 更新时各项目按需升级

项目结构：

```
my-project/
├── .harness/              ← harness agent (submodule)
│   ├── harness.md
│   ├── skills/
│   ├── knowledge/         ← 该项目的专属知识
│   └── workspace/
├── src/                   ← 你的项目代码
├── tests/
└── ...
```

**方式二：子目录（简单场景）**

```bash
cd my-project
git clone <harness-repo-url> .harness
```

简单直接，但 harness 更新不如 submodule 方便。

### 与 QoderCLI 集成

harness 设计为与 QoderCLI 天然兼容：

1. **harness.md** 可作为 QoderCLI 的 AGENT.md 或自定义 skill 加载
2. **workspace/** 产物文件可在项目 .gitignore 中排除或按需提交
3. **knowledge/** 随项目版本管理，团队共享经验
