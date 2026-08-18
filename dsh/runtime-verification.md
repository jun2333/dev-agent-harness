# DSH 运行时能力验证报告

> 日期：2026-08-18
> 方法：对照本机 `~/.dsh/.agent-presets/liangshen` 实例 + DeepSeek Harness 源码
> （`~/Documents/Jun/code/deepseek-harness`，`packages/preset/agent-presets`、`packages/bundle/base`、`apps/cli/config/agent-presets/standard`）
> 目的：把 preset 启用前的「待验证项」从猜测变成事实，并据此修正 preset/install 草案。

## 3a. preset 实际格式 — 已确认（与草案不同，已修正）

**Preset 是目录，不是单文件。** 装载器为 `@deepseek-ai/dsh-agent-presets`：

```
~/.dsh/.agent-presets/<id>/          # id 须匹配 /^[a-z0-9][a-z0-9-]*$/（目录名 = 稳定标识）
├── agent.cordis.yml                 # 必需：组合文件（顶层 plugin 行列表），discovery 时做健康检查
├── preset.yml                       # 可选：显示元数据（name / description / order，仅展示用）
├── <plugin>.mjs                     # 可选：行引用的插件（如梁神的 tool-bootstrap.mjs）
└── NOTICE
```

- `preset.yml` 只承载展示文本；`id` 来自目录名、`trust` 来自发现根（system/user），均不可在文件内改写
- 组合文件是 **Cordis 文件**：`- id: xxx / name: '@deepseek-ai/dsh-xxx' / config: {...}`，服务行必须位于带 `isolate` realm 的组内
- 沙箱/审批栈、持久化、模型路由归**宿主组合**（base.cordis.yml + web.cordis.yml）所有，preset 不得拥有

**→ 修正**：`dsh/preset/harness/` 目录（agent.cordis.yml + preset.yml + NOTICE）已按此格式重写；
`dsh/install.js` 改为整目录复制。旧 `harness.preset.md` 草案已删除。

## 3b. 子代理沙箱权限 — 已确认：无按子代理的沙箱

- `dsh-tool-subagent` 配置仅支持 `provider` / `toolName` / `backgroundMode`（及产品 provider 的 maxDepth 等），**无 sandbox/permission 选项**
- workflow 工具 `agent()` 的 opts 仅 `schema` / `label` / `phase` / `provider` / `model`，其余选项（effort/isolation/agentType）会被显式拒绝
- 权限域是**会话级 projection**（`permissions` 键按 Session 折叠，由 `permission/preset`、`sandbox/mode`、`approval/policy` 三个会话 knob 驱动）

**→ 推论**：草案中"阶段→权限映射（designing=read-only、implementing=workspace-write…）"**无法按子代理实现**。
落地方式改为：
- 会话级默认权限（建议 workspace-write，实施类任务需要）
- 危险操作依赖审批策略（approval/policy：ask 时升级需 justification；本次会话内已见 danger-full-access 全局放开，说明它是会话 knob）
- 阶段语义约束仍由编排器 prompt + schema 门禁承担（子代理被明确告知当前阶段可做什么）

## 3c. 编排工具可用性 — 已确认：需 preset 显式挂载 delegation 组

内置 `standard` preset 显式挂载了 delegation 组（`isolate: workflowEngine`）：
`dsh-tool-subagent-control` / `list-agents` / `dsh-tool-subagent`（provider: spawn→subagent、fork→subagent_fork）/ `dsh-workflow-worker-thread` + `dsh-tool-workflow` / `dsh-tool-ralph` / `dsh-tool-ask-user` / `dsh-tool-todo`。

**→ 推论**：子代理、workflow、ask_user_question 工具**不是默认就有**，而是 preset 组合决定是否给 agent；
Harness 编排模型（每阶段子代理 + 机械校验 + 人工门禁）必须让 preset 挂载上述 delegation 组。
已纳入 `dsh/preset/harness/agent.cordis.yml`（代码/产品 provider 默认 disabled）。

## 附带确认

- persona 行：`@deepseek-ai/dsh-persona`，`config.text` 支持 `{{model}}` / `{{cwd}}` 占位
- 工作区指令：`@deepseek-ai/dsh-agent-instructions`（maxBytes 65536）
- 技能目录/加载器：`@deepseek-ai/dsh-skill-filesystem` + `@deepseek-ai/dsh-tool-skill`（宿主注册表按 scope 分层）
- goal 工具：`@deepseek-ai/dsh-tool-goal`（preset 决定 agent 能否调用）
- 两阶段锚定（梁神式）需要专属 `tool-bootstrap.mjs` 插件，本期未纳入，列为 P2

## 结论

| 验证项 | 结果 | 落地 |
|---|---|---|
| preset 格式 | 目录 + agent.cordis.yml（+preset.yml） | ✅ 已按真实格式重写 preset/install |
| 子代理沙箱 | 无按子代理沙箱，权限会话级 | 会话默认权限 + 审批策略；阶段语义靠 prompt/schema |
| 编排工具 | 需挂 delegation 组 | ✅ 已纳入 agent.cordis.yml |

剩余未验证项：`agent.cordis.yml` 实际装载（需在 DSH 环境新建会话选「Harness 模式」冒烟）；
subagent 子代理的 cwd（预期继承会话工作区，待实测确认）。
