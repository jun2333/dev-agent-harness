# 工作流插件规范（Workflow Plugin Spec）

> 把 harness 工作流定义为**自包含插件包**：每个工作流 = 一个目录，内含步骤定义、产出物要求、测试手段定义，插入即用。
> 本规范是插件包的**设计指南**（格式合法性由 `workflow-schema.json` 强校验）。

## 1. 目录结构

```
.harness/workflows/{name}/            # 通用层（submodule 内，所有项目共享）
│                                    # 项目层（第二批）：knowledge/plugins/{name}/（项目仓库内）
├── workflow.yaml                    # 工作流定义（必填）
├── check/                           # 通用校验脚本（可选，随插件包分发）
│   └── *.js                         #   脚本以项目根为 cwd 运行，exit 0 通过
└── templates/                       # 产出物模板（可选）
```

命名：目录名 kebab-case（`feature`、`skill-creation`），与 `workflow.yaml` 的 `name` 一致。

## 2. workflow.yaml 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | kebab-case，与目录名一致 |
| `description` | ✅ | 工作流用途 |
| `verify.checks` | 否 | 测试手段声明：内置 check 名或命令池 key（见 §3） |
| `pre_task` / `post_task` | 否 | 任务前后动作（state-checkpoint init/collect 等） |
| `stages` | ✅ | 阶段数组 |

### stage 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 阶段名，工作流内唯一 |
| `skill` | ✅ | 本阶段加载的 skill 路径 |
| `sub_command` | 否 | skill 子命令 |
| `input` / `output` | 否/✅ | 输入文件；产出物（gate 按它定位） |
| `sections` | 否 | **产出物必含区块**（gate 校验）：二维数组，外层每组"任一满足" |
| `require_verify` | 否 | testing/reviewing 阶段必须 verify 证据 |
| `gate` | 否 | `user_approval`（产出后停等人工确认）或 `none` |
| `on_fail` | 否 | 失败回退到的阶段名 |
| `optional` | 否 | 是否可选阶段 |
| `permission` / `tools` | 否 | DSH 沙箱权限/工具集（通用层承载，DSH 消费） |
| `post_stage` | 否 | 阶段后动作（state-checkpoint save、skill-log 等） |

## 3. 测试手段（verify.checks）

`checks` 数组按序执行，全部通过才算验证通过。每个 check 按顺序解析：

| 类型 | 写法 | 解析 |
|------|------|------|
| **插件包 check 脚本** | `skill-check` / `workflow-check` 等 | 查**当前工作流插件包**的 `check/{name}.js`（项目层优先 → 通用层）——校验脚本随插件包自包含，加新 check 不用改 harness 代码 |
| **命令池 key** | `unit` / `lint` / `e2e` | 从项目 `knowledge/verify.config.json` 的 `commands` 对象按 key 取实际命令 |

```yaml
# feature：需要项目单元测试 + lint（命令从项目命令池取）
verify:
  checks: [unit, lint]

# skill-creation：只需技能结构校验（通用脚本，不依赖项目技术栈）
verify:
  checks: [skill-check]
```

**他证原则（不可违背）**：`checks` 只能引用插件包 `check/` 脚本或命令池 key，LLM 不能自选任意命令——验证命令来源必须可审计。

### 命令池格式（knowledge/verify.config.json）

```jsonc
{
  "schema_version": "verify.config.v2",
  "commands": {
    "unit": "npx vitest run",
    "lint": "npm run lint",
    "e2e": "npx playwright test"
  },
  "timeout_ms": 300000
}
```

兼容：v1 的数组格式（`"commands": ["npx vitest run", ...]`）仍被支持，视为无 key 的默认命令集（仅当工作流未声明 checks 时使用）。

## 4. 运行时行为

- **gate-check.js**：按 `checkpoint.workflow` 加载对应插件包 `workflow.yaml`（经 schema 校验），用当前 stage 的 `sections`/`require_verify` 校验产出物；testing/reviewing 阶段对账 verify 证据（命令 = 工作流 checks 解析结果）。插件包缺失 → 降级不阻塞（stderr 提示）。
- **verify.js**：`--workflow <name>` 读取 `verify.checks` 并解析执行；无 workflow/checks 时 fallback 到命令池默认命令集。
- **发现顺序（已实现，项目层优先）**：
  1. `knowledge/plugins/{name}/`（项目定制，优先）
  2. `.harness/workflows/{name}/`（通用模板，兜底）
  项目层与通用层同名时，项目版覆盖。`node .harness/tools/workflow-init.js list` 可列出全部可用工作流。

## 4.5 工作流模板语义与项目实例化

- **通用工作流 = 工作流模板**：骨架（步骤/产出要求）通用，但测试命令、通过标准必须项目定制（"改代码用什么测试命令、怎么测算通过"由项目决定）。
- **项目层目录 `knowledge/plugins/`**（项目根，git 跟踪，与 knowledge/ 同属项目层）：放项目定制工作流插件包。
- **实例化**：`knowledge-init workflow-init init <name>`（或 `node .harness/tools/workflow-init.js init <name>`）把模板复制到项目层并绑定项目命令池；`sync <name>` 同步上游模板更新（只补齐未定制部分）；`list` 列出可用工作流。
- 项目版可自由增删阶段、改 gate、改 sections、绑定项目命令——不碰通用模板（父类保持纯净）。

## 5. 自定义工作流步骤（如何新增插件包）

1. 建目录 `workflows/{name}/`，写 `workflow.yaml`（按 §2 字段）
2. 声明 `verify.checks`（内置 check 或命令池 key）
3. 需要项目专属校验时：命令池加 key，或内置 check 提交到 `.harness/tools/`（通用）——**项目专属脚本**放项目层插件包 `check/`（第二批 knowledge/plugins 支持）
4. 用 `node .harness/tools/workflow-validate.js` 校验插件包合法性
5. harness.md 启动时选择该工作流即可

## 6. 与 DSH 的关系

- 本规范是**通用层**能力（main 分支），不依赖 DSH 环境
- DSH 编排器与确定性门禁从工作流插件包读取定义（sections/permission/tools/verify 均来自 workflow.yaml）——`dsh/stage-schema.json` 已删除，数据迁入插件包，单一真相源不分裂
- DSH preset 可消费工作流插件包（可选适配，非必需）
