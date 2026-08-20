# DevAgent Harness 编排器

程序驱动的流程执行引擎：把工作流工作流（workflow.yaml）变成**可强制执行的阶段状态机**。
流程状态、校验、回退在程序里，LLM 是执行单元（子代理或主 agent 桥）。

## 核心命令

```
node .harness/orchestrator/core.js <command> [--args]

start    --task-id <id>       读 manifest（必须含 user_confirmed: true）初始化任务，
                              执行 pre_task（env-check 等），写 .active-task.json
next     --task-id <id>       输出当前阶段的执行指令（含 executor / prompt_template / spawn）
run-stage --task-id <id>      headless 形态：脚本 spawn 子代理执行当前阶段 → 解析 stdout JSON
                              写 stage-result.json → validate；user_approval 阶段生成确认码暂停
validate --task-id <id>       校验当前阶段（结构层 + 机械检查 + verify 证据对账）
advance  --task-id <id>       推进状态（user_approval 阶段必须先 approve --code），执行 post_stage 记账，
                              任务完成时生成审核简报并清除 .active-task.json
approve  --task-id <id> --stage <name> --code <code>   落盘人工批准（须携带一次性确认码，防主 agent 自我批准）
status   --task-id <id>       查看进度（不传 task-id 时找最新活跃任务）
```

**退出码**：`0`=成功 `1`=校验失败/错误 `2`=需要人工确认（CONFIRM_REQUIRED）

## 启动会话（start 前置）

用户下达任务 → 主 agent 用 AskUserQuestion 确认**三件事**：工作流 / task-id / task-desc →
写 `workspace/{task-id}/task.manifest.json`（含 `user_confirmed: true`）→ 再 `start`。

> `start` 校验 `user_confirmed: true`，缺失拒绝启动——防止跳过人工确认。

## executor：阶段执行方式可配置

每个 stage 可配 `executor`（workflow.yaml）：

| executor | 行为 | 适用 |
|---|---|---|
| `inline`（默认） | 主 agent 桥直接执行（不派子代理，宿主 hook 全部生效） | 一般步骤；全 inline 即退化 CLI 模式 |
| `subagent` | 派独立子代理执行（上下文隔离） | 需要隔离的重步骤（大改动/复杂实现），显式配置 |

## 执行形态：bridge vs headless

整体执行形态由 `orchestrator/config.json` 的 `subagent` 字段切换（默认 `bridge`）：

| 维度 | bridge（LLM 中转，默认） | headless（脚本直调） |
|---|---|---|
| 阶段执行 | 主 agent 桥用 **Agent 工具**调子代理（executor=subagent），或桥直接执行（executor=inline） | 编排器脚本 **spawn `codebuddy -p`**（每阶段一个独立 headless 进程） |
| 主 agent 桥 | 必需（翻译指令 + 调工具） | 只在确认点需要（其余纯程序化） |
| 阶段隔离 | subagent executor 隔离；inline 无（进主代理上下文） | 天然隔离（独立进程） |
| 用户确认 | **AskUserQuestion 原生** | 脚本输出 `CONFIRM_REQUIRED` 暂停，**回交互会话确认** |
| `-y` 权限 | 无 | 需要（跳过权限检查） |
| stdout JSON | 不依赖 | 依赖（prompt 约定 JSON code block + 脚本提取） |
| 登录态 | 会话内，天然有效 | spawn 前需 `checkAuth`（headless 无法交互重新登录） |
| 适用 | 默认稳定路径（交互确认友好、无权限风险） | 批处理 / 需要纯程序化执行的场景 |

> executor（阶段级）与执行形态（整体）是**两个维度**：bridge 形态下阶段可以是 inline 或 subagent；headless 形态天然每阶段独立进程，executor 主要影响桥形态。

## 全局任务状态

`.harness/workspace/.active-task.json`（编排器维护）：
- `start` 写（task_id + active）
- 任务 `done` 清除（中断保留，方便恢复）
- `post-tool-log` 据此把工具日志标注 `task_id`（非任务状态为 null）

## 产物结构（workspace/{task-id}/）

```
task.manifest.json   任务清单（workflow/task-id/task-desc/user_confirmed）
checkpoint.json      阶段状态（current_stage/completed_stages/approved_stages/executor 标记）
task.md / design.md / task-plan.md / changes.md / test-report.md / review-report.md / lessons-draft.md
stage-result.json    当前阶段结果（子代理落盘）
stage-runs/          run-stage 的 spawn 执行日志（含子代理原始 stdout/stderr）
skill-logs/          阶段 skill 执行记录（编排器程序化记账）
tool-actions/        全局按日工具日志（task_id 标注，审计留痕）
review-brief.md      任务完成时自动生成的审核简报
```

## 工具日志

- **全局按日**：`.harness/workspace/tool-actions/YYYY-MM-DD.log`，每条带 `task_id`
- **只记主代理**：子代理的调用 hook 记录不到（实测），子代理能读什么由 prompt + 交接文档限定
- context-ledger 已移除（2026-08-20）：subagent 隔离后上下文可控，工具日志仅作审计留痕

## 与 CLI 版的关系

- CLI 版（LLM 自读 workflow 自觉执行）仍是简单任务/历史任务的路径，gate-check Stop 会提示"建议走编排器"
- 编排器任务的 checkpoint 带 `executor: orchestrator` 标记
- 全局约束：脚本参数禁止 LLM 生成（参数来自文件定义或脚本生成，见 docs/orchestrator-design.md）

## 测试

```
node --test test/orchestrator.test.js      # 编排器状态机
node --test test/requirements-flow.test.js # requirements 全流程
node --test test/*.test.js                 # 全部
```
