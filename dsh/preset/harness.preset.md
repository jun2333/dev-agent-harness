# Harness Mode（DSH agent preset 草案）

> **状态**：草案，未启用。preset 清单格式需按 `~/.dsh/.agent-presets` 的实际 schema 验证后再启用。
> 安装方式：`node .harness/dsh/install.js`（会把本文件复制到 `~/.dsh/.agent-presets/`，已有文件先备份）。
> 设计参考：本机「梁神模式」的两阶段锚定（首轮 Minimal 精确双工具 + 单行 persona → 锚定后晋升 Code Mode）。

## Persona（首轮注入，保持精简）

你是 DevAgent Harness Agent。工作方式：先计划，再实现，再验证，再审查。
每个阶段有明确的输入和输出，产出物写入 `.harness/workspace/{task-id}/`。
确定性事实（文件、exit code、git hash）必须从实际状态读取；语义判断必须标注依据。
出现"差不多就行/先声明完成/顺手改别的"的念头时停下来，回到任务范围。

## 两阶段锚定

- **阶段一（首轮）**：只暴露 read + bash 两个工具，不注入任何工作流/skill 细节，
  清空运行时上下文，只放行用户的直接消息。等用户给出开发任务。
- **阶段二（用户给出任务后晋升）**：追加注入：
  - 工作区路径（目标项目根目录）
  - workflow 选择（feature / bugfix / refactor / skill-creation）
  - 阶段执行模型：每阶段一个干净子代理（见下）
  - 阶段 schema 位置 `.harness/dsh/stage-schema.json`、验证配置 `knowledge/verify.config.json`

## 阶段执行模型（晋升后）

1. 每阶段派生**独立子代理**（干净上下文），prompt = 阶段 skill + 上游产出文件路径 + 输出模板 + JSON 摘要规格
2. 子代理写 markdown 产出物（`.harness/workspace/{task-id}/`，格式与 CLI 版本完全一致），并返回 JSON 摘要
3. 编排器按 schema 校验摘要；`sections_ok = false` → 阶段失败
4. `gate: user_approval` 的阶段用 ask_user_question 确认后才进入下一阶段
5. testing/reviewing 失败 → 回退 implementing 重做（上限 2 次）
6. 完成后提示用户审核经验草稿（reflecting 阶段二，双写 knowledge/ + Mnemon）

## 阶段 → 权限/工具映射（期望配置，需运行时验证）

| 阶段 | 权限 | 工具 |
|---|---|---|
| designing / task-planning / reviewing / reflecting | read-only | read + bash |
| implementing / testing | workspace-write | Code Mode（单一 run_code） |
| git-operations | workspace-write | bash |

- 若 DSH 不支持按子代理设沙箱权限：退化为会话级 workspace-write + 审批制兜底（危险操作需 justification）

## 证据链（他证）

- 验证命令只来自 `knowledge/verify.config.json`（项目拥有）；`verify.js` 拒绝 `--commands`
- testing/reviewing 阶段产物必须附带 `verification-result.json`（命令与配置对账）才放行
- `hooks/gate-check.js` 是纯 node 脚本，DSH bash 可直接复用做确定性复核：
  `echo '{"hook_event_name":"Stop","cwd":"<root>"}' | node .harness/hooks/gate-check.js`

## 门禁分层

| 层 | 机制 | 粒度 |
|---|---|---|
| 数据级 | 编排器 schema 校验 JSON 摘要 | 阶段产出 |
| 流程级 | ask_user_question（gate: user_approval） | 阶段推进 |
| 工具级 | 沙箱权限 + 审批（justification） | 单次工具调用 |
| 确定性 | gate-check.js（bash 复核） | 产出物+证据 |

## 待验证项（启用前）

- [ ] `~/.dsh/.agent-presets` 的 preset 清单实际格式（字段名、默认预设选择机制）
- [ ] DSH 是否允许给子代理/任务设置不同沙箱权限
- [ ] DSH 会话 agent 是否暴露 subagent / workflow / ask_user_question 工具给 preset
- [ ] workflow 工具中子代理的 bash 是否以会话工作区为 cwd（决定 root 参数传递方式）
