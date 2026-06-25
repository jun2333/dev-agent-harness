---
name: state-checkpoint
description: 状态记录与断点恢复。自动触发：workflow 的 pre_task 和 post_stage 钩子自动调用。手动触发：用户说"恢复任务"或启动时自动检测未完成的 checkpoint。
---

# State Checkpoint Skill

## Overview
记录任务执行进度，提供断点恢复能力。每个 stage 完成后自动记录检查点，启动时自动检测未完成的任务。

## 触发方式

### 自动触发
- **触发条件**：
  - workflow 开始前（pre_task 钩子）：action: init
  - 每个 stage 完成后（post_stage 钩子）：action: save
  - 任务完成时（post_stage 钩子）：action: complete
- **调用方式**：workflow YAML 中定义，无需用户主动调用

### 手动触发
- **触发条件**：用户说"恢复任务"或启动时检测到未完成的 checkpoint
- **调用方式**：对话中说"恢复任务"或自动提示

## 记录检查点

### 执行步骤
1. 读取当前任务状态（workspace/{task-id}/checkpoint.json）
2. 更新当前 stage、完成时间、产出文件列表
3. 写回 checkpoint.json

### checkpoint.json 格式
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

### 输出
- workspace/{task-id}/checkpoint.json（更新）

## 恢复任务

### 执行步骤
1. 扫描 workspace/ 目录，查找有 checkpoint.json 的任务
2. 展示未完成的任务列表和当前进度
3. 用户选择要恢复的任务
4. 加载 checkpoint 中记录的 stage 和上下文，从断点继续

### 输出
- 恢复任务执行状态

## 约束
- 每个 stage 完成后必须调用此 skill 记录检查点
- 恢复时必须向用户确认
- 记录任务开始前的 git commit hash，用于回滚
