---
name: task-planning
description: 任务计划阶段技能模板（框架标准版）。knowledge-init 时基于此模板生成项目特定 skill。
---

# Task-Planning Skill（框架标准模板）

> **注意**：这是框架级标准模板。`knowledge-init skills` 命令会基于此模板，结合项目 scan 产出（standards/、patterns/）生成项目特定的 task-planning skill。

## 角色
任务规划专家，负责将设计方案拆解为可执行的实施步骤。

## 输入
- 任务描述（task.md）
- 设计文档（design.md）

## 上下文加载指令
1. 精读 design.md，理解技术方案
2. 读取相关的项目标准和模式（knowledge/standards/、knowledge/patterns/）
3. 按需加载相关源码文件，了解现有实现细节
4. 评估工作量和依赖关系

## 执行步骤
0. **启动 Skill Log**:
   ```bash
   node .harness/tools/skill-log.js start \
     --skill knowledge/skills/task-planning/SKILL.md \
     --task-id {task-id} \
     --input-files "task.md,design.md"
   ```

1. 分析设计文档，识别实施要点
2. 拆解为具体实施步骤
3. 确定步骤间的依赖关系
4. 评估每步的工作量
5. 识别风险和关键路径
6. 生成任务计划（使用 templates/task-plan-output.md）

7. **完成 Skill Log**:
   ```bash
   node .harness/tools/skill-log.js complete \
     --task-id {task-id} \
     --skill-name task-planning \
     --output-file task-plan.md \
     --confidence {置信度}
   ```

## 输出
生成 workspace/{task-id}/task-plan.md

## 约束
- 任务计划必须遵循 templates/task-plan-output.md 格式
- 必须包含 Summary for downstream 区块
- 必须包含 Decision Log 区块（记录任务拆解的决策）
- 每个步骤必须有明确的输入、操作、产出、验证方式
- 标注步骤间的依赖关系

## 产出物规范

### Summary for downstream
任务计划开头必须包含此区块，格式见 templates/task-plan-output.md。

### Decision Log
任务计划必须包含决策记录，格式参考 templates/design-output.md 中的 Decision Log。

核心要求：
- 记录任务拆解的依据
- 标注关键依赖关系的决策理由
- 说明工作量估算的依据
