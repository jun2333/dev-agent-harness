---
name: orchestrate
description: 编排桥（编排器模式的主 agent 引导）。把编排器 next 输出的阶段指令翻译成 Agent 工具调用，维护 next→Agent→validate→approve/advance 循环。你不生成脚本参数、不做设计决策，只翻译与搬运。
---

# Orchestrate Skill

## 角色

你是 harness 编排器（`.harness/orchestrator/core.js`）的主 agent 桥。**流程状态机在程序里，你是执行单元**：

- 编排器决定：阶段顺序、校验、回退、是否停等确认
- 你负责：把 next 输出的阶段指令翻译成 Agent 工具调用；子代理完成后运行 validate / approve / advance

## 默认强制（何时必须走编排器）

**用户下达的开发/分析任务，默认必须走编排器**（启动会话 → start → 阶段循环）——这是目标执行路径（流程状态机在程序里，可靠性远高于 LLM 自觉执行）。

- **必须走编排器**：涉及多阶段、有明确产出物、需要用户审批的任务（feature / bugfix / requirements / skill-creation / workflow-creation）
- **可跳过编排器**：仅限简单单步操作（改一个配置、修一个 typo、回答一个问题）——复杂度判断标准见项目 AGENTS.md
- CLI 版（LLM 自读 workflow 自觉执行）已降级：编排器任务的 checkpoint 带 `executor: orchestrator` 标记，gate-check 在收尾时会提示未走编排器的任务

## 使用流程

### 1. 启动会话（人机确认，先于 start）

用户下达任务时：

1. 语义判断任务类型 → 给出候选工作流（feature / bugfix / skill-creation / workflow-creation / 项目自定义）
2. 用 AskUserQuestion 一次问齐：
   - **工作流确认**：展示你的判断 + 候选列表，用户选择/纠正
   - **task-id**：用户输入或确认 kebab-case 标识
   - **task-desc**：用户输入一句话描述
3. workspace 目录名 = `{task-id}-{desc}`（全小写 kebab-case，不含中文/空格）
4. 写 `workspace/{dir}/task.manifest.json`：`{ "workflow": <确认的工作流>, "task_id": <dir>, "task_desc": <描述> }`
5. 运行 `node .harness/orchestrator/core.js start --task-id <dir>`

### 2. 阶段循环

每阶段重复以下四步：

```
1. [程序] node .harness/orchestrator/core.js next --task-id <dir>
     → 返回 { stage, skill_path, input_files, output_file, executor, prompt_template }

2. 按 executor 执行：
   - executor=inline（默认）→ [你] 自己按阶段指令直接执行：
       读 skill_path 技能 → 读 input_files → 产出 output_file（遵守模板必含区块）→ 写 stage-result.json
       （inline 阶段不派子代理，工作进主代理上下文，宿主 hook 全部生效）
   - executor=subagent → [你] 调 Agent 工具（general-purpose 或适配当前任务的子代理类型）
       prompt 参数用 next 返回的 prompt_template 原文（不修改、不缩写）
       → 子代理写产出物 + 落盘 stage-result.json
       （subagent 需在 workflow.yaml 显式配置，用于需要上下文隔离的重步骤）

3. [程序] node .harness/orchestrator/core.js validate --task-id <dir>
     → exit 0：通过
     → exit 1：失败（读 failures，反馈重做后回到步骤 2）
     → 若返回 rework=true：编排器已回退到 on_fail 阶段，回到步骤 2 重做该阶段

4. 通过后推进：
     gate=user_approval → [你] AskUserQuestion 问用户 → 用户批准后：
         node ... approve --task-id <dir> --stage <stage>
         node ... advance --task-id <dir>
     gate=none → node ... advance --task-id <dir>
     → advance 返回 done=true 即任务完成；否则返回 next_stage + 下一阶段指令
```

### 3. 任务完成

advance 返回 `done: true` 时，向用户汇总：完成阶段清单、关键产物路径、待用户审阅的 review-report 等。

## 禁止事项（违反即流程损坏）

- **禁止修改 next 输出的任何字段**（stage / skill_path / output_file / prompt_template 原样使用）
- **禁止自行生成脚本参数**（workflow / task-id / approved 一律来自文件或程序输出）
- **禁止从子代理输出中编造未返回的字段**
- **禁止跳过 validate 直接 advance**（advance 内部会校验，但不要尝试绕过）
- **禁止猜测用户未确认的工作流**（必须经 AskUserQuestion 确认）
- **禁止把"桥"做设计决策**（阶段怎么拆、产出物怎么改，是子代理/用户的事）

## 确认点

- 每个 `gate: user_approval` 阶段，产出通过机械校验后，**必须 AskUserQuestion 询问用户**，用户批准后才能 advance
- 用户拒绝时：把拒绝理由反馈给子代理，回到该阶段重做
