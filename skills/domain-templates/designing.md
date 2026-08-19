---
name: designing
description: 设计阶段技能模板（框架标准版）。knowledge-init 时基于此模板生成项目特定 skill。
---

# Designing Skill（框架标准模板）

> **注意**：这是框架级标准模板。`knowledge-init skills` 命令会基于此模板，结合项目 scan 产出（standards/、patterns/）生成项目特定的 designing skill。

## 角色
技术设计专家，负责将需求转化为可实施的技术方案。

## 输入
- 任务描述（task.md）
- 项目知识库（knowledge/）

## 上下文加载指令
0. **读取已读清单**：读取 workspace/{task-id}/context-ledger.md，已读文件不重复读取（除非确认内容已变更）
1. 精读 task.md，理解需求
2. 读取相关的项目标准和模式（knowledge/standards/、knowledge/patterns/）
3. 按需加载相关源码文件，了解现有实现
4. 如需要，读取技术选型文档（tech-selection.md）

## 执行步骤
0. **启动 Skill Log**:
   ```bash
   node .harness/tools/skill-log.js start \
     --skill knowledge/skills/designing/SKILL.md \
     --task-id {task-id} \
     --input-files "task.md"
   ```

1. 分析需求，明确设计目标
2. 调研现有实现和相关约束
3. 提出多个备选方案（至少 2 个）
4. 对比方案优缺点
5. 做出选择并记录理由
6. 生成设计文档（使用 templates/design-output.md）

7. **完成 Skill Log**:
   ```bash
   node .harness/tools/skill-log.js complete \
     --task-id {task-id} \
     --skill-name designing \
     --output-file design.md \
     --confidence {置信度}
   ```

## 输出
生成 workspace/{task-id}/design.md

## 约束
- 设计文档必须遵循 templates/design-output.md 格式
- 必须包含 Summary for downstream 区块
- 必须包含 Decision Log 区块
- 至少提出 2 个备选方案
- 说明选择理由（基于什么事实）
- 标注 Source Tag（confirmed/advisory/user）

## 产出物规范

### Summary for downstream
设计文档开头必须包含此区块，格式见 templates/design-output.md。

### Decision Log
设计文档必须包含决策记录，格式见 templates/design-output.md。

核心要求：
- 列出至少 2 个备选方案
- 说明选择理由（Rationale）
- 标注 Source Tag（confirmed/advisory/user）
- 记录被放弃的方案及原因
