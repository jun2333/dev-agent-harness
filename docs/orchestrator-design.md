# 通用编排器设计（CodeBuddy CLI 优先）

> 状态：草案 v0.1，待审阅
> 目标宿主：CodeBuddy CLI（Agent 工具 / AskUserQuestion / hooks 已有适配）
> 设计原则：**流程状态机在程序里，LLM 是执行单元**；确定性事实程序化，语义判断交给 LLM

## 全局约束：脚本参数禁止 LLM 生成（不可违背）

**任何脚本/工具的调用参数，LLM 一律不生成。** 参数只能有两个来源：

1. **文件定义写死**：工作流（workflow.yaml）、项目配置（verify/env-check config.json）、任务清单（task.manifest.json）
2. **脚本生成**：checkpoint 的 current_stage、next 输出的阶段指令、子代理落盘的 stage-result.json

**落地方式：参数落盘替代命令行传参**——LLM 不拼参数、不传 JSON、不复制字段；脚本从文件读参数。

| 命令 | 参数来源（禁止 LLM 生成） |
|---|---|
| `start` | 读 `task.manifest.json`（校验 `user_confirmed` + 一次性确认码 `--code`；未确认/缺码拒绝 exit 2） |
| `next` | 无参数，脚本读 checkpoint |
| `validate` | 读 checkpoint（stage）+ 读 `stage-result.json`（result） |
| `advance` | 读同一份 checkpoint + stage-result.json；`approved` 由独立 approve 命令落盘 |
| `status` | 无参数，脚本自动找最新活跃 checkpoint |

这是 harness「他证原则」的纲领化（verify.js 拒 `--commands`、env-check 拒自选命令的推广）。LLM 唯一涉及参数的点是启动会话（判断工作流 + 起 task-id），且已被 AskUserQuestion 用户确认 + 落盘 manifest + **一次性确认码**三重约束（见 §4.1）。

---

## 1. 背景与目标

### 为什么需要编排器

当前 main 分支的流程执行是"LLM 自读自执行"：

```
workflow.yaml 是文档不是程序 → LLM 读它、自觉按阶段走 → gate-check 事后查产物
```

约束全部落在"LLM 愿意遵守"上。可靠性的上限就是 LLM 的自觉度。而编排器把流程控制权从 LLM 拿到程序手里：

```
程序驱动阶段推进 → 每阶段派独立子代理 → JSON 摘要 schema 校验 → 失败程序化回退
```

### 为什么以 CodeBuddy CLI 为宿主

- 它是当前主力开发环境（taskflow / harness 都在这里迭代）
- 具备编排器所需的全部能力：子代理（Agent 工具）、脚本执行（Bash）、用户确认（AskUserQuestion）、hook 硬门禁（PreToolUse exit 2）
- DSH 的编排器原型（`dsh/orchestrator.workflow.js`）是"DSH workflow 工具专用脚本"，不通用；本次设计要把它从 DSH 绑定中解放出来

### 核心目标

1. **流程确定性**：阶段顺序、校验、回退由程序决定，不依赖 LLM 心情
2. **上下文受控**：每阶段干净子代理 + 产出物摘要传递，读取范围程序化受控（详见 §7.1）；跨阶段防重读靠产出物摘要传递
3. **校验机械性**：子代理返回 JSON 摘要，schema 当场校验（sections_ok 必须 true）
4. **宿主可移植**：核心层零宿主依赖，适配层接口化，先落 CodeBuddy，预留其他宿主

### 编排器的定位：通用工作流执行引擎

编排器**不假设任务类型**——它只做一件事：读工作流（流程 + 测试手段），按阶段可靠执行。

按 harness 工作流规范（`docs/workflow-spec.md`），任何"流程 + 测试手段"的组合都能成为可编排的任务，**不限于代码**：

| 场景 | 工作流示例 | 测试手段（verify.checks） |
|---|---|---|
| 代码开发 | feature / bugfix | 命令池 key：unit / lint / e2e |
| 框架自举 | skill-creation / workflow-creation | 工作流 check/ 脚本：skill-check / workflow-check |
| 用户自定义 | 按规范写 `workflows/{name}/`（或项目层 `knowledge/workflow/{name}/`） | 任意：工作流 check/ 脚本 或 项目命令池 key |

这正是"工作流化"的设计意图：**用户按规范定制自己的 AI 工作流（流程 + 验收 + 测试手段），编排器负责让它被可靠执行**——写新技能、写工作流、做文档/方案/调研等非代码任务同样适用。

对编排器的实现含义：
- 阶段 skill 是任意领域的阶段技能（代码设计、文档写作、方案设计都行），编排器不关心内容，只负责"加载 skill → 派子代理 → 校验产出"
- verify 证据的校验机制是通用的：`resolveVerifyCommands` 解析出的命令（无论来自 check/ 脚本还是命令池）统一按"命令集合执行 + exit code 对账"处理
- 子代理 JSON 摘要协议与产出物校验逻辑与任务类型无关

### 职责分层原则：流程归引擎，质量归技能（2026-08-20 定稿）

编排器（引擎）与阶段技能（SKILL.md）的职责边界，按"能否通用化"划分：

| 层 | 职责 | 保证手段 | 是否通用 |
|---|---|---|---|
| **编排器** | 流程正确（状态机/审批/回退）+ 产物存在性（后阶段依赖的前阶段产物在不在） | `validate` / `gate-check` 机械校验 | 是，与任务类型无关 |
| **阶段技能** | 产出质量（内容对不对、细不细、符不符合领域规范） | SKILL.md 自带质量红线，子代理按技能执行时自证 | 否，依赖领域语义 |

**为什么这样分**：
- 质量验证**无法通用化**——"决策日志好不好""需求覆盖全不全"依赖具体工作流/领域的语义，写成通用校验器要么太松（形同虚设）要么太严（误伤）。
- 质量责任**下沉到技能层**：每个阶段技能自带质量标准，子代理按技能执行即被要求自证质量。
- 编排器**保持小而稳**：不随每个 workflow 的细节演进；新 workflow 只要写好 SKILL.md，质量自然有保障，引擎零改动。

**落地检查**（对照现有实现）：
- `checkStage` 查的 sections 必含区块 = "产物存在性" ✅
- verify 证据对账 = "验证动作发生过" ✅
- 质量细节 → 各阶段 SKILL.md（designing/implementing 等）自己定义 ✅

**边界**：不要在编排器里加"内容质量/一致性"校验（如区块行数、决策覆盖度）——那是技能层的职责。编排器只保证"流程走对了、该有的产物存在"。

---

## 2. CodeBuddy CLI 宿主能力盘点

| 能力 | 工具/机制 | 编排器用途 |
|---|---|---|
| 子代理（交互） | Agent 工具（`subagent_type`: Explore / general-purpose / Plan / fork） | **桥形态**：每阶段独立执行单元 |
| 子代理（进程级） | **headless 模式** `codebuddy -p "<prompt>" -y`（非交互，spawn 独立进程） | **headless 形态**：脚本直调，无主 agent 桥 |
| 脚本执行 | Bash 工具 | 运行编排器核心（node 脚本）/ spawn headless |
| 文件读写 | Read / Write / Edit / Glob / Grep | 阶段产物、checkpoint |
| 用户确认 | AskUserQuestion | `gate: user_approval` 阶段停等 |
| hook | PreToolUse / PostToolUse（stdin JSON + exit 2 阻断） | gate-check 硬门禁、post-tool-log 记账 |
| 后台 | Agent `run_in_background` | （可选）长阶段异步执行 |

**两种执行形态（本设计的核心决策）**：

| | 桥形态（默认） | headless 形态（进阶） |
|---|---|---|
| 子代理怎么执行 | 主 agent 调 Agent 工具（LLM 中转） | 编排器脚本 spawn `codebuddy -p`（脚本直调） |
| 主 agent 桥 | 必需（翻译指令 + 调工具） | 只在确认点需要 |
| 可靠性 | 桥的翻译可能走样（validate 兜底） | 无桥，阶段执行完全程序化 |
| 用户确认 | AskUserQuestion 原生 | 脚本暂停，回交互会话确认 |
| 代价 | 多一跳 LLM 翻译开销 | `-y` 权限 / stdout JSON 提取 / 登录态检查 |
| 适用 | 默认稳定路径 | 需要纯程序化/批处理时 |

**关键约束（桥形态）**：CodeBuddy 的 Agent 工具**只能由主 agent（LLM）调用，脚本无法直接调用**。
→ 桥形态 = "程序状态机 + 主 agent 桥"；headless 形态 = "程序状态机 + 脚本直调子代理"，桥只剩确认点。

---

## 3. 总体架构

```
┌─────────────────── 编排器核心（.harness/orchestrator/，纯 Node，零宿主依赖） ───────────────────┐
│                                                                                                 │
│  ┌──────────────┐   解析   ┌──────────────────────────┐                                       │
│  │ core.js      │────────▶│ workflow.yaml             │                                       │
│  │ 状态机       │         │ simple-yaml 程序化解析     │                                       │
│  └──────┬───────┘         └──────────────────────────┘                                       │
│         │ 组装            ┌──────────────────────────┐                                       │
│         ├───────────────▶│ prompt-builder.js         │                                       │
│         │                │ 阶段指令 = skill + 上游产出 │                                       │
│         │                │          + 模板 + JSON摘要规格                                      │
│         │                └──────────────────────────┘                                       │
│         │ 校验            ┌──────────────────────────┐                                       │
│         ├───────────────▶│ validate.js               │                                       │
│         │                │ JSON 摘要 schema +        │                                       │
│         │                │ sections_ok + verify 证据 │                                       │
│         │                └──────────────────────────┘                                       │
│         │ 状态            ┌──────────────────────────┐                                       │
│         └───────────────▶│ checkpoint.json           │                                       │
│                          │ 阶段推进 / on_fail 回退    │                                       │
│                          └──────────────────────────┘                                       │
└──────────────────────────────────┬───────────────────────────────────────────────────────────┘
                                   │ next 输出阶段指令 / validate / advance
                                   ▼
┌──────────────────── 主 agent 桥（CodeBuddy 会话内） ───────────────────────────────────────────┐
│                                                                                                 │
│   ┌──────────┐  调 Agent 工具  ┌──────────────┐   返回 JSON 摘要    ┌──────────────┐           │
│   │ 主 agent │────────────────▶│ 阶段子代理    │◀───────────────────│ (上一阶段)    │           │
│   │          │                 │ 独立上下文    │                     │              │           │
│   └────┬─────┘                 └──────────────┘                     └──────────────┘           │
│        │ 调 AskUserQuestion                                                                     │
│        ▼                                                                                       │
│   ┌──────────┐                                                                                 │
│   │ 用户确认  │                                                                                 │
│   └──────────┘                                                                                 │
└──────────────────────────────────┬───────────────────────────────────────────────────────────┘
                                   │ 通过 HostAdapter 接口
                                   ▼
┌──────────────────────── 适配层 ────────────────────────────────────────────────────────────────┐
│   HostAdapter 接口 ──▶ codebuddy.adapter.js（阶段指令翻译 + 确认指引）                            │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

**核心层**只做三件事：解析、组装、校验——不碰宿主 API。
**适配层**定义"宿主怎么被调用"：CodeBuddy 的适配器实际是"主 agent 桥的契约"，即指令模板 + 工具调用指引。
**主 agent 桥**是 CodeBuddy 形态特有的：程序 ↔ 宿主子代理能力之间的翻译层。

---

## 4. 编排器 CLI 接口（core.js）

### 4.1 任务启动会话（人机确认，先于 start）

编排器内部用 `task-id` 流转，但任务的**启动**先经过一次人机确认，避免 LLM 单方决策：

```
用户下达自然语言任务
  │
  ▼
[主 agent] 语义判断任务类型 → 给出候选工作流（feature/bugfix/skill-creation/...）
  │
  ▼
[主 agent] AskUserQuestion 让用户提供/确认三件事：
  1. 工作流确认：展示 LLM 的判断 + 候选列表，用户选择/纠正
  2. task-id：用户提供 kebab-case 标识（禁止 LLM/脚本自动生成）
  3. task-desc：用户提供一句话任务描述（用户原文，禁止 LLM/脚本自拟）
  │
  ▼
[程序] harness start --workflow <name> --task-id <id> --desc "<用户原文>"
  │      （创建 workspace/<id>/task.md + manifest，不含 user_confirmed）
  ▼
[程序] core.js start 因未确认拒绝（exit 2，CONFIRM_REQUIRED），生成一次性确认码
  │
  ▼
[主 agent] 用 AskUserQuestion 让用户确认 task-id/task-desc，将 manifest 的 user_confirmed 置 true
  │
  ▼
[程序] core.js start --task-id <id> --code <确认码> 正式进入编排层
```

规则：
- **工作流选择必须经用户确认**——LLM 的候选作为默认推荐，用户可改（这是"任务类型 → 工作流"的唯一 LLM 决策点，且不落单）
- **task-id + task-desc 必须用户提供**，agent/脚本禁止自动生成；用户不提供则不启动
- **一次性确认码**只能经 AskUserQuestion 用户确认后取得，core.js start 强校验（缺码/错码拒绝），agent 无法绕过
- workspace 目录名 = task-id，**编排器内部流转只认这个目录名**（checkpoint / next / validate / advance 全部用它做 task-id）
- 目录名要求：全小写 kebab-case（`[a-z0-9-]`），不含空格/中文（中文描述不进入目录名，仅存在 task-desc 里供人读）
- **启动参数落盘**：`harness start` 写 `workspace/{id}/task.manifest.json`，start 只读文件，LLM 不拼 `--workflow`

### 4.2 CLI 命令（参数禁止 LLM 生成，见「全局约束」）

```
node .harness/orchestrator/core.js <command> [--args]

start    --task-id <id>
         读 workspace/{id}/task.manifest.json 取 workflow 定义；
         经 tools/workflow-lib.js 加载工作流（项目层优先 → 通用层兜底，schema 校验），
         创建 checkpoint、执行 env-check、执行 pre_task 动作
next     --task-id <id>
         读 checkpoint 输出下一阶段的执行指令（JSON）：
         { stage, stage_no, total, skill_path, input_files, output_file, gate, prompt_template }
validate --task-id <id>
         读 checkpoint 取当前 stage + 读 stage-result.json（子代理落盘的 JSON 摘要）；
         校验（exit 0/1 + 失败原因列表）
advance  --task-id <id> [--approved true]
         读同一份 checkpoint + stage-result.json；校验通过后推进状态：
         写 checkpoint、处理 on_fail 回退，输出下一阶段指令
approve  --task-id <id> --stage <name> --yes
         记录人工批准到 checkpoint（gate=user_approval 的确认落盘，不靠命令行传参）
status   --task-id <id>     # 省略 task-id 时自动找最新活跃 checkpoint
         查看进度（当前阶段、已完成、产物清单）
```

**子代理结果落盘（关键）**：子代理执行完，把 JSON 摘要写入 `workspace/{id}/stage-result.json`（用 Write 工具），validate / advance 从文件读——**LLM 不复制字段、不传 JSON**，杜绝主 agent 桥的走样风险。

主 agent 的循环就是 `next → Agent(子代理，落盘 stage-result.json) → validate → advance` 四步，全部确定性操作。

---

## 5. 阶段执行流程（两种形态）

### 5.0 阶段执行方式（executor，stage 级配置）

每个 stage 可配 `executor`（workflow.yaml）：

| executor | 行为 | 适用 |
|---|---|---|
| `inline`（默认） | 主 agent 桥**直接执行**该阶段（读 skill → 读输入 → 写产物 → 落盘 stage-result），不派子代理；工作进主代理上下文，**宿主 hook 全部生效** | 一般步骤；**全 inline 即退化 CLI 模式** |
| `subagent` | 派独立子代理执行（上下文隔离） | 需要隔离的重步骤（大改动/复杂实现），显式配置 |

编排器 `next` 输出 `executor` 字段，主 agent 桥据此决定"派 Agent 子代理"还是"自己执行"。

### 5.1 桥形态（默认，LLM 中转）

```
用户下达任务（先走 §4.1 启动会话：确认工作流 + 输入 task-id/task-desc，定 workspace 目录名）
  │
  ▼
[主 agent] node orchestrator.js start --workflow <name> --task-id <dir-name>
  │        （解析 workflow / 建 checkpoint / env-check）
  ▼
  ┌───────────────────────── 循环 ─────────────────────────┐
  │                                                        │
  │  [程序] node orchestrator.js next --task-id <dir-name>  │
  │         → 返回阶段指令（skill / 输入 / 输出 / 模板 / 摘要规格）│
  │                                                        │
  │  [主 agent] 调 Agent 工具创建子代理                     │
  │         prompt = 阶段指令 + 上游产出物         │
  │         （子代理写产出物 + 落盘 stage-result.json，见 §6）│
  │                                                        │
  │  [程序] node orchestrator.js validate --task-id <dir-name>│
  │         （读 checkpoint 取 stage + 读 stage-result.json）│
  │         ├─ 失败 → advance 触发 on_fail 回退到指定阶段     │
  │         └─ 通过 → gate=user_approval?                   │
  │                    ├─ 是 → [主 agent] AskUserQuestion →  │
  │                    │        approve --stage S --yes 落盘 │
  │                    └─ 否 → 继续                         │
  │  [程序] node orchestrator.js advance --task-id <dir-name>│
  │         （推进阶段 / 返回下一阶段指令）      │
  │                                                        │
  └────────────── 直至全部阶段完成 ────────────────────────┘
  │
  ▼
[程序] 收尾：gate-check Stop 复核（复用现有 hook）
```

**主 agent 桥的可靠性保障**：
- 阶段指令是**模板化 JSON**，主 agent 不需要做设计决策，只需翻译成 Agent 调用
- `validate` 失败即阻断推进（exit 1），主 agent 无法跳过校验
- gate-check（PreToolUse）继续兜底防伪造产物

### 5.2 headless 形态（进阶，脚本直调子代理）

```
用户下达任务（§4.1 启动会话照旧）
  │
  ▼
[程序] node orchestrator.js start --workflow <name> --task-id <dir-name>
  │        （解析 workflow / 建 checkpoint / env-check）
  ▼
  ┌───────────────────────── 循环 ─────────────────────────┐
  │                                                        │
  │  [程序] node orchestrator.js next --task-id <dir-name>  │
  │         → 返回阶段指令 + spawn 命令                     │
  │                                                        │
  │  [程序] 编排器脚本 spawn：                             │
  │         codebuddy -p "<阶段prompt + JSON输出约定>" -y   │
  │         （子代理独立进程，执行阶段任务，stdout 输出 JSON 摘要）│
  │                                                        │
  │  [程序] 解析 stdout → 提取 JSON 摘要 → 写入 stage-result.json│
  │         node orchestrator.js validate --task-id <dir-name>│
  │         （读 checkpoint 取 stage + 读 stage-result.json）│
  │         ├─ 失败 → advance 触发 on_fail 回退              │
  │         └─ 通过 → gate=user_approval?                   │
  │                    ├─ 是 → 脚本输出"待确认"标记并暂停，     │
  │                    │        回交互会话由主 agent 用       │
  │                    │        AskUserQuestion 确认 + approve │
  │                    └─ 否 → 继续                         │
  │  [程序] node orchestrator.js advance --task-id <dir-name>│
  │        （推进阶段 / 返回下一阶段指令）       │
  │                                                        │
  └────────────── 直至全部阶段完成 ────────────────────────┘
```

**headless 形态的实现要点**：
- **spawn 命令**：`codebuddy -p "<prompt>" -y`（-y 跳过权限；按宿主 CLI 支持收窄工具集）。prompt = 阶段指令 + 上游产出物 + **"最后输出 ```json {...}```"的 JSON 约定**
- **JSON 提取**：解析 stdout 中最后一个 markdown code block 的 JSON（容错：去掉围栏、容忍尾逗号）
- **登录态检查**：spawn 前执行 `codebuddy --version`（或健康命令）确认凭据有效；失效则提示先交互登录（headless 无法交互式重新登录）
- **环境继承**：spawn 继承 shell env（凭据/模型配置走环境变量时不能丢）
- **确认点**：gate=user_approval 时脚本输出 `CONFIRM_REQUIRED` 标记 + 阶段摘要并暂停，回交互会话确认后继续（advance --approved true）

**为什么两套并存**：桥形态稳定（原生交互确认、无 -y 风险），是默认路径；headless 形态消除主 agent 桥（可靠性问题、多一跳翻译开销一起消失），适合要纯程序化/批处理的场景。切换由配置控制（见 §9）。

---

## 6. 子代理 JSON 摘要协议（落盘 stage-result.json）

每阶段子代理完成后，把 JSON 摘要**写入 `workspace/{task-id}/stage-result.json`**（用 Write 工具落盘，不是"返回给主 agent 传参"——见「全局约束」）。严格 schema，`additionalProperties: false`：

```json
{
  "stage": "designing",
  "output_file": "design.md",
  "sections_ok": true,
  "verify_evidence": "workspace/X/verify/verification-result.json",
  "notes": "关键取舍说明"
}
```

| 字段 | 必填 | 校验规则 |
|---|---|---|
| `stage` | ✅ | 必须等于当前阶段名 |
| `output_file` | ✅ | 文件必须实际存在 |
| `sections_ok` | ✅ | **子代理自报字段，validate 不采信**（通过与否以 validate 机械检查为准，见下） |
| `verify_evidence` | ⭕ | testing/reviewing 阶段必填，且文件存在、`overall_status=passed`、命令与 workflow 声明对账 |
| `notes` | ⭕ | 自由文本 |

### validate 的两层校验

**层 1：结构层（固定协议，不随工作流变）**
- JSON 摘要的字段名/类型校验（`additionalProperties: false`），`stage` 必须等于当前阶段名——纯函数，无文件 IO

**层 2：规则层（schema 驱动，从工作流 stage 定义读）**

校验规则全部来自 `workflow.yaml` 工作流定义，不硬编码：

| 校验项 | 数据来源 |
|---|---|
| 产出物必含区块 | `stages[i].sections`（二维数组：外层"任一满足"、内层"全部满足"） |
| 是否必须 verify 证据 | `stages[i].require_verify` |
| verify 跑哪些命令 | `verify.checks` → `resolveVerifyCommands`（check/ 脚本或命令池） |
| 失败回退到哪 | `stages[i].on_fail` |
| 是否停等用户确认 | `stages[i].gate` |

新工作流 / 新阶段 / 用户自定义工作流 → validate 自动适配，不改代码。

**★ `sections_ok` 不作通过依据**：它是子代理的自我声明，validate 永远以机械检查的结果为准（同源于 workflow.yaml），堵住自证漏洞（与 v0.4 之前 verify 的教训一致）。

---

## 7. 数据流

```
workflow.yaml ──解析──▶ checkpoint.json ──next──▶ 阶段指令 ──Agent prompt──▶ 子代理
                                        ▲                                   │
                                        │                                   │ 返回 JSON 摘要
                                        │                                   ▼
                                        │                                validate ──失败──▶ on_fail 回退
                                        │                                   │
                                        └─────────────通过───────────────────┘
                                                          │
                                            checkpoint.json ──advance──▶ 下一阶段指令
                                              │
                                   注入下一阶段 prompt ◀────────────────────┘
```

- **checkpoint.json**：编排器维护的唯一状态源（workflow / stage_outputs / on_fail 回退计数 / pending_confirm）
- **阶段产物 md**：子代理写入 `workspace/{task-id}/`，既是证据也是下游输入
- **跨阶段防重读**：靠**产出物摘要传递**（阶段 prompt 只给 skill + 上游产出物）；主代理工具调用由 `post-tool-log.js` 记录到 `tool-actions/` 按日日志（审计留痕，非防重读）

### 7.1 上下文控制策略（编排器模式，与 CLI 版本质不同）

**CLI 版（单会话流，已降级）**：上下文**累积膨胀**——agent 读了什么都在对话里残留，所以当时的上下文控制目标是"防膨胀省 token"（tool-actions.log 记账 → 已读清单 → 防重读；该机制 2026-08-20 已移除）。

**编排器版**：每阶段是**干净子代理**——读的文件只在子代理上下文里，阶段结束即消失，**不存在累积膨胀**。所以上下文控制的目标变成"**控制每个子代理的读取范围**"（只读需要的），而不是防膨胀。

编排器下上下文控制的两支柱（按可靠性排序）：

| 支柱 | 机制 | 可靠性 | 防什么 |
|---|---|---|---|
| 1. **产出物摘要传递** | 阶段 prompt 只给 skill + 上游产出物（design.md/task-plan.md）——读取范围由阶段 prompt 的输入白名单程序化构造 | 程序化，可靠 | 子代理读取范围本身（"prompt 给了什么"即限定） |
| 2. **干净子代理隔离** | 每阶段独立上下文，阶段结束即回收 | 架构天然 | 累积膨胀（根本不存在） |

**关键事实（2026-08-20 起）**：
- **Context Ledger（已读清单 / context-snapshot）已移除**（用户要求）：子代理上下文由阶段 prompt 输入白名单程序化控制后，"精准上下文"从管理变成构造，不再需要已读清单防重复读取
- **跨阶段防重读依赖产出物摘要传递**（架构天然、程序保证）——下游只消费上游摘要，本来就不需要读原始文件
- 主代理工具调用由 `post-tool-log.js` 确定性记录到 `tool-actions/YYYY-MM-DD.log`（带 task_id），作为**审计留痕**，不是防重读手段

### 7.2 全局任务状态与工具日志

**全局任务状态**（`.harness/workspace/.active-task.json`，编排器维护）：
- `start` 写入（`task_id` + `status: active`）；任务 `done` 时清除（中断保留，方便恢复）
- 目的：`post-tool-log` 据此标注日志的 `task_id`（非任务状态为 null）

**工具日志**（全局按日归档，`tool-actions/YYYY-MM-DD.log`）：
- 每次工具调用一行 JSON（ts / session_id / tool / input / cwd / task_id）
- **只记录主代理（桥）的调用**：子代理的调用 hook 记录不到（实测 2026-08-19），且子代理能读什么能写什么由 prompt + 交接文档限定，不做子代理记账
- 按日归档便于清理；用途是**审计留痕**（按 task_id 检索某任务的工具调用），不是防重读

---

## 8. 与现有机制的关系

| 现有机制 | 编排器中的角色 |
|---|---|
| `gate-check.js`（PreToolUse exit 2） | 保留，兜底防伪造产出物（写入侧硬门禁） |
| `validate.js`（编排器新增） | 数据级门禁：JSON 摘要 schema + 产物存在性 + verify 证据 |
| `env-check.js` | `start` 时执行，环境未就绪不进流程 |
| `verify.js` | testing/reviewing 阶段子代理产出证据，validate 校验对账 |
| `lessons-apply.js` | task-planning 阶段后解析 Lessons Applied，递增经验 use_count（记账） |
| `knowledge-index.js` | 扫描知识库自动生成 `knowledge/_index.md` |
| `post-tool-log.js` | 记录主代理工具调用到 `tool-actions/` 按日日志（审计留痕） |
| `reflecting` / `skill-log` | 收尾阶段照常 |

**双门禁分层**：
- `validate` 管"子代理交卷是否达标"（数据级，当场）
- `gate-check` 管"产物写入是否合规"（确定性，写入时）
两者不重叠：validate 校验的是子代理**返回的摘要**，gate-check 校验的是**落盘的文件**。

### 8.2 共享模块提取：stage-check.js（校验逻辑单一真相源）

validate 的规则层机械检查**复用 gate-check 的 `checkStage` / `checkVerifyEvidence`**，不另写一套。实现方式：从 gate-check.js 提取为共享模块。

```
.harness/tools/
├── stage-check.js        # 新增：从 gate-check 提取 checkStage + checkVerifyEvidence
├── gate-check.js         # 改为 require stage-check.js（行为不变）
└── orchestrator/validate.js  # 也 require stage-check.js
```

**提取后的接口**（stage 可注入，gate 用 checkpoint 填、validate 用命令行填）：

```js
// tools/stage-check.js
checkStage({ root, taskId, stage, wfDef, contentOverride, verifyCommands })
  → string[]   // 失败原因列表，空数组 = 通过
// 内部：
//   1. 产出物存在性：fs.existsSync(workspace/{taskId}/{stage.output})
//   2. sections 内容匹配：content.includes(sec)（外层组"任一满足"）
//   3. require_verify → checkVerifyEvidence（证据存在 + passed + 命令对账）
// 纯字符串匹配 + 文件 IO，无 LLM 参与

checkVerifyEvidence({ root, taskId, verifyCommands })
  → string[]   // verify 证据校验失败列表
```

**validate 完整流程（结合共享模块）**：

```
validate --task-id X --stage S --result '<json>'
  ├─ 1. 结构层校验（纯函数，无文件 IO）：result 字段合法？stage == S？
  ├─ 2. 加载工作流定义：
  │      wfDef = loadWorkflowDefinition(root, checkpoint.workflow)
  │      verifyCommands = resolveVerifyCommands(root, wfDef)
  ├─ 3. 机械检查（调 stage-check.js）：
  │      failures = checkStage({ root, taskId, stage: S, wfDef, verifyCommands })
  │      ★ 不采信 result.sections_ok——通过与否只看 checkStage 结果
  └─ 4. failures 空 → exit 0；非空 → exit 1 + 失败原因列表
```

**为什么提取而不是 validate 内嵌 gate-check.js**：
- gate-check.js 是 hook 脚本（依赖 stdin 事件契约），validate 是 CLI 工具，直接 require 它语义别扭且耦合
- 提取后校验逻辑**只有一份**，gate-check 与 validate 读同一份代码、同一份工作流定义，杜绝两套实现漂移
- stage 参数可注入（gate 从 checkpoint 读，validate 从命令行读），共享同一核心

### 8.1 与工作流化机制的对齐（关键）

编排器**复用 `tools/workflow-lib.js`** 作为工作流读取的单一入口，不自行解析 workflow.yaml——与 gate-check / verify.js 共享同一套工作流逻辑，杜绝"编排器一套解析、gate 一套解析"的漂移。

| 工作流化能力 | 编排器怎么用 |
|---|---|
| 工作流发现（项目层 `knowledge/workflow/` 优先 → 通用层 `.harness/workflows/` 兜底） | `loadWorkflowDefinition(root, name)`——start 时加载，不自己找文件 |
| verify.checks 两级解析（工作流 `check/` 脚本 → 命令池 key） | `resolveVerifyCommands(root, wfDef)`——validate 校验 verify 证据时对账用 |
| 工作流 check/ 脚本（含项目层专属 `knowledge/workflow/{name}/check/`） | `findCheckScript(root, workflowName, check)`——子代理执行 verify 时调用 |
| workflow-schema.json 格式校验 | start 加载工作流后过 schema，非法定义拒绝启动 |
| `pre_task` / `post_stage` / `sub_command` / `optional` | 编排器逐项执行：pre_task 在 start、post_stage 在 advance、sub_command 拼进阶段 prompt、optional 阶段跳过或询问用户 |
| 工作流自带 `templates/` 产出物模板 | prompt-builder 优先引用工作流 templates（项目层 → 通用层），fallback 到通用 `.harness/templates/` |

**对 gate 与 validate 的连带影响**：sections 的二维语义（外层组"任一满足"、内层"全部满足"）、require_verify、on_fail 都从工作流 stage 定义读取，validate 内嵌的 checkStage 逻辑必须复用 `loadWorkflowDefinition` 解析出的同一份 stage 对象，保证与 gate-check 行为一致。

---

## 9. 适配层设计

### HostAdapter 接口（核心层唯一依赖的抽象）

```js
interface HostAdapter {
  // 生成"阶段指令 → 宿主子代理调用"的翻译提示（桥形态：主 agent 照抄进 Agent 工具）
  buildSubagentPrompt(stageInstruction, context) → string;
  // 生成 spawn 命令与完整 headless prompt（headless 形态：脚本直调）
  buildSpawnCommand(stageInstruction, context) → { command: string, args: string[] };
  // 用户确认的调用指引（CodeBuddy：AskUserQuestion）
  buildApprovalPrompt(stage, context) → string;
  // 登录态检查（headless 形态用：凭据失效时 headless 无法交互重新登录）
  checkAuth(context) → boolean;
  // 宿主上下文
  getContext() → { cwd, root, session_id };
}
```

### 两个 adapter（切换由配置控制）

```
.harness/orchestrator/config.json 或环境变量：
  { "subagent": "bridge" | "headless", "headless_cli": "codebuddy" }
```

**bridge.adapter.js（默认，LLM 中转）**——产出的不是 API 调用，而是"翻译好的阶段指令"，主 agent 照抄进 Agent 工具的 prompt 参数：

```js
// adapters/bridge.js
buildSubagentPrompt: (ins, ctx) => `
你是 harness 任务「${ctx.taskId}」的「${ins.stage}」阶段代理（工作流 ${ins.workflow}）。
工作目录：${ctx.root}
1. 先读取并遵循技能：.harness/${ins.skill_path}
2. 阶段输入文件（存在则读）：${ins.input_files}
3. 必须写出的产出物：.harness/workspace/${ctx.taskId}/${ins.output_file}（遵守模板必含区块）
4. 若为 testing/reviewing：用 node .harness/tools/verify.js run 产出证据（命令来自 knowledge/verify.config.json，禁止 --commands）
5. 完成后返回 JSON 摘要：{ stage, output_file, sections_ok, verify_evidence, notes }
`,
buildApprovalPrompt: (stage) =>
  `阶段「${stage.name}」产出已完成，是否确认进入下一阶段？（批准后才推进）`,
```

**headless.adapter.js（进阶，脚本直调）**——产出的是一条 spawn 命令，编排器脚本直接执行：

```js
// adapters/headless.js
buildSpawnCommand: (ins, ctx) => {
  const prompt = `
你是 harness 任务「${ctx.taskId}」的「${ins.stage}」阶段代理（工作流 ${ins.workflow}）。
工作目录：${ctx.root}
1. 先读取并遵循技能：.harness/${ins.skill_path}
2. 阶段输入文件（存在则读）：${ins.input_files}
3. 必须写出的产出物：.harness/workspace/${ctx.taskId}/${ins.output_file}（遵守模板必含区块）
4. 若为 testing/reviewing：用 node .harness/tools/verify.js run 产出证据（禁止 --commands）
5. 完成后，最后输出一个 JSON 代码块：\`\`\`json
{ "stage": "${ins.stage}", "output_file": "${ins.output_file}",
  "sections_ok": true, "verify_evidence": "...", "notes": "..." }
\`\`\``;
  return { command: 'codebuddy', args: ['-p', prompt, '-y'] };
},
checkAuth: () => {
  // 执行 codebuddy --version，非零退出即凭据/环境异常
},
```

**为什么桥形态的适配器是"指令翻译"而不是"直接调用"**：CodeBuddy 的 Agent 工具只能由主 agent 调用，桥形态下适配层产出的不是 API 调用，而是翻译好的阶段指令；headless 形态则直接产出 spawn 命令。两种形态共用同一份阶段指令数据（next 的输出），差异只在"怎么执行"。

---

## 10. 目录结构

```
.harness/
├── orchestrator/
│   ├── core.js              # 状态机（start/next/validate/advance/status）
│   │                        # 工作流读取复用 tools/workflow-lib.js（loadWorkflowDefinition /
│   │                        #   resolveVerifyCommands / findCheckScript），不自行解析 workflow.yaml
│   ├── prompt-builder.js    # 阶段指令组装（skill + 输入 + 输出 + 摘要规格 + 工作流 templates）
│   ├── validate.js          # JSON 摘要校验（结构层纯函数）+ 调 stage-check.js 做规则层机械检查
│   ├── config.json          # 执行形态开关：{ "subagent": "bridge" | "headless", "headless_cli": "codebuddy" }
│   ├── adapters/
│   │   ├── bridge.js        # 默认：LLM 中转（生成阶段指令，主 agent 照抄进 Agent 工具）
│   │   └── headless.js      # 进阶：脚本直调（生成 codebuddy -p spawn 命令 + JSON 输出约定）
│   ├── test/                # 状态机单元测试
│   └── README.md            # 编排器使用说明
├── tools/
│   └── stage-check.js       # 新增：从 gate-check 提取的产出物机械检查（checkStage/checkVerifyEvidence）
│                            #   gate-check.js 与 validate.js 共用，单一真相源
├── docs/orchestrator-design.md   # 本文档
└── (dsh/orchestrator.workflow.js # 保留为 DSH 专属参考，本次不动)
```

---

## 11. 实施路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| **MVP** | 提取 `tools/stage-check.js`（从 gate-check 拆分，gate-check 行为不变）+ core.js 状态机 + prompt-builder + validate（结构层纯函数 + 调 stage-check）+ **bridge adapter（默认）** + 主 agent 桥 skill（`orchestrate`：告诉主 agent 如何四步循环） | taskflow 跑通一个 **feature（代码）任务** + 一个 **skill-creation（非代码）任务**——验证编排器与任务类型无关；validate 以机械检查为准（sections_ok 不采信）、拦截伪摘要、on_fail 回退生效 |
| 加固 | 启动会话强校验（task-id/desc 必须用户提供 + 一次性确认码）、env-check 接入 start、收尾 gate-check 复核、use_count 记账（lessons-apply）、知识库索引脚本（knowledge-index） | 全链路与现有机制打通 |
| 进阶 | **headless adapter**（脚本直调）：spawn 命令 + stdout JSON 提取 + checkAuth + 确认点回交互 | headless 形态跑通同一套任务，无主 agent 桥（确认点除外） |
| 扩展 | 其他宿主 adapter（DSH / Claude Code） | HostAdapter 接口只加实现不改核心 |

**桥形态的 `orchestrate` skill 是 MVP 的隐形关键**：主 agent 必须严格按 `next → Agent → validate → advance` 循环执行，所以需要一份明确的 skill 描述"你的角色是编排桥，不做设计决策，只翻译指令"。headless 形态不需要此 skill（阶段执行已程序化），确认点仍由主 agent 引导。

---

## 12. 风险与限制

> 前两条风险**仅存在于桥形态**——headless 形态（脚本直调）从架构上消除了它们。风险 6/7 是 headless 形态的代价。

1. **主 agent 桥的可靠性（仅桥形态）**：LLM 可能不按循环走（跳过 validate 直接 advance）。
   → 缓解：`advance` 要求传上一阶段摘要并内部校验（不校验不推进）；gate-check 兜底；skill 写死流程。**切 headless 形态即可根治**。
2. **多一跳 LLM 桥的开销（仅桥形态）**：每次阶段多一次主 agent 翻译。
   → 接受：桥形态下这是"脚本无法调 Agent 工具"的宿主约束下的最优解。**headless 形态无此开销**。
3. **子代理上下文隔离的代价**：每阶段重新加载 skill + 产出物，首次读取开销存在。
   → 缓解：阶段 prompt 只给上游产出物摘要，缺细节才重读（2026-08-20 起已读清单移除，跨阶段防重读靠产出物传递）。
4. **双门禁的维护成本**：validate 与 gate-check 的校验规则需保持同步（同源于 workflow.yaml 的 sections/require_verify）。
   → 约定：workflow.yaml 是唯一真相源，validate 与 gate-check 都从它解析。
5. **子代理可能不写产出物直接声明完成**：validate 检查 output_file 实际存在，缺失即失败。
6. **headless 的 `-y` 权限风险**：spawn 需跳过权限检查才能写文件/执行命令。
   → 缓解：按宿主 CLI 支持收窄工具集（如 `--allowedTools`）；仅受信环境开启。
7. **headless 的 stdout JSON 提取**：LLM 输出可能不严格按 JSON code block。
   → 缓解：prompt 约定 + 容错解析（去围栏、容忍尾逗号、取最后一个 code block）；提取失败则该阶段视为未达标（validate 拦截）。

---

## 13. 强制进编排层（执行路径的演进）

**背景**：编排器出现之前，harness 的流程执行靠"LLM 自读 workflow 自觉执行"（CLI 版）。编排器把流程状态机放进程序（阶段推进/校验/回退程序化），可靠性不依赖 LLM 自觉；工作流化工作流的"流程即数据"只有在程序驱动的执行器下才有意义。但当前使用仍依赖 LLM 自觉选择（用户下达任务 → 主 agent 可走编排器，也可走 CLI 版）。

**目标**：编排器成为**默认且强制**的任务驱动路径，CLI 版降级为"简单单步任务专用"并最终废弃。

**强制设计（三层）**：

| 层 | 机制 | 现状 |
|---|---|---|
| 1. checkpoint 标记 | 编排器 start 创建 checkpoint 时写入 `executor: 'orchestrator'`——任务由编排器驱动的机器可识别标记 | ✅ 已实现 |
| 2. 入口强制 | orchestrate skill：用户下达任务必须先走编排器启动会话（确认工作流 → manifest → start）；仅简单单步任务可跳过 | ✅ 已实现（skill 声明） |
| 3. gate-check 兜底 | Stop 收尾时若 checkpoint 无 `executor: orchestrator`（CLI 版任务）→ 提醒"建议走编排器"；**过渡期软提示不硬拦**（兼容历史 CLI 任务） | ✅ 已实现 |

**未来硬强制路径**（编排器端到端验证通过后）：
- gate-check 对"新任务未走编排器"从提醒升级为**拦截**（PreToolUse 阻断 CLI 版路径）
- CLI 版从 harness.md / AGENTS.md 中移除（仅保留简单任务说明）
- 历史 CLI 任务兼容期后清理

**过渡期策略**：先"软强制"（标记 + 入口声明 + 收尾提示），用户跑一段时间编排积累实际数据（返工率、token、质量），确认端到端可靠后再升级为硬强制。

---

## 已发现问题（实测记录，待改进）

1. **【已实测 2026-08-19】启动会话不完整——主 agent 桥可跳过 task-id/task-desc 确认**：跑 requirements 流程时，主 agent（桥）只向用户确认了工作流和范围，**擅自用推荐值写 manifest 的 task-id/task-desc，未让用户确认**（违背 orchestrate skill"AskUserQuestion 一次问齐三件事"的约定）。这是"主 agent 桥可靠性"的具体实例——桥没按 skill 完整执行启动会话。
   → **【2026-08-20 已实现，比预期更强】**：`harness start` 强制 `--task-id` + `--desc`（禁止自动生成），manifest 不再自动置 `user_confirmed`；`core.js start` 未确认 → 拒绝（exit 2）并生成**一次性确认码**，已确认还需 `--code` 才启动——agent 无法靠改 manifest 绕过（见 §4.1）。

---

## 待确认的问题（审阅后需拍板）

1. MVP 范围：是否包含 on_fail 回退和 verify 证据校验？（建议包含，这是编排器区别于 skill 引导的核心价值）
@ok
2. 主 agent 桥 skill（`orchestrate`）放哪：通用层 `skills/framework/` 还是 CodeBuddy 专属？
@通用的就是放通用层啊，我们只是从codebuddy做实验，为啥要它专属
3. 是否保留 `dsh/orchestrator.workflow.js` 的现有原型不动，还是把通用层做出来后让它薄壳化引用核心？
@先留着，做出通用层之后再看怎么处理它
4. 编排器推进时的 checkpoint 与现有 state-checkpoint skill 的关系：由编排器程序化维护，skill 是否降级为仅文档说明？
@如果可以完全取缔就取缔吧，不能就先留着
5. **【已实测 2026-08-19】hook 不覆盖子代理的工具调用**：用 CodeBuddy 调 Agent 工具（general-purpose 子代理）执行 2 次 Bash + 1 次 Write（cwd 在 taskflow 内），tool-actions.log 行数零变化——**子代理的工具调用不触发 PreToolUse/PostToolUse hook**。结论：
   - **gate-check 在编排器模式下无法拦截子代理写产出物**（写入时兜底失效）→ validate 必须独立承担机械文件检查（stage-check.js 是必需不是可选）；gate-check 仅保留 Stop 收尾复核（主 agent 会话事件，可能仍触发）
   - **post-tool-log 不记录子代理的工具调用** → 桥形态（Agent 工具子代理）下 tool-actions.log 只有主 agent 的调用，已读清单会漏记子代理的读取。桥形态的记账局限待解决（见 #6 对 headless 的期望）；headless 形态是独立进程，若其 hook 配置生效则已读清单完整（待实测）
@先测试吧，看结果
6. **【已实测 2026-08-19】headless spawn 技术可行，hook 不记录 headless 进程；【已实测 2026-08-19 完整流程】headless 编排器流程跑通**：`codebuddy -p "<prompt>" -y` 成功执行 Bash + Write（产物落盘正确）、`-y` 权限正常、登录态继承、stdout 输出约定 JSON code block（可直接解析）；headless 进程的工具调用**不写入 tool-actions.log**（hook 只记录当前交互会话的主 agent 调用）。完整 headless 编排器流程实测：切换 `config.subagent=headless` 后，`next` 输出 spawn 命令 → 执行 `codebuddy -p` 完成 elicitation → stdout JSON code block 提取成功 → validate 通过。
   → **记账设计调整（最终）**：子代理的读取行为不做记账（hook 记录不到，且子代理能读什么由 prompt + 交接文档限定）——**只记录主代理**。已读清单（context-snapshot）从**全局按日日志**（`tool-actions/YYYY-MM-DD.log`，带 task_id）按 task_id 过滤生成（详见 §7.2）；跨阶段防重读依赖**产出物传递**。
   （注：2026-08-20 已读清单/context-snapshot 机制已整体移除——子代理读取范围由阶段 prompt 输入白名单控制，无需防重读；tool-actions 日志仅作审计留痕，见 §7.1）
7. **执行形态默认值**：默认 `bridge`，`headless` 作为可切换进阶——是否接受这个默认？headless 的确认点"脚本暂停回交互会话"的用户体验是否可接受？
@接受
8. **【已实测 2026-08-19】on_fail 回退真实触发验证通过**：构造 requirements 流程 drafting 阶段产物缺 `## 范围` 区块 → validate 拦截 → advance 返回 `rework: true, from: drafting, to: elicitation, rework_left: 1` → checkpoint 回退到 elicitation、rework_count 递增。
