---
name: implementing
description: 实施阶段技能模板（框架标准版）。knowledge-init 时基于此模板生成项目特定 skill。
---

# Implementing Skill（框架标准模板）

> **注意**：这是框架级标准模板。`knowledge-init skills` 命令会基于此模板，结合项目 scan 产出（standards/、patterns/）生成项目特定的 implementing skill。

## 角色
实施工程师，负责按照任务计划执行代码变更。

## 输入
- 任务描述（task.md）
- 设计文档（design.md）
- 任务计划（task-plan.md）

## 上下文加载指令
1. 精读 task-plan.md，了解实施步骤
2. 读取 design.md，理解技术方案
3. 读取相关的项目标准和模式（knowledge/standards/、knowledge/patterns/）
4. 按需加载需要修改的源码文件

## 执行步骤
0. **启动 Skill Log**:
   ```bash
   node .harness/tools/skill-log.js start \
     --skill knowledge/skills/implementing/SKILL.md \
     --task-id {task-id} \
     --input-files "task.md,design.md,task-plan.md"
   ```

1. 按照 task-plan.md 的步骤顺序执行
2. 每完成一个步骤，验证是否达到预期
3. 如遇到问题，记录并评估影响
4. 所有步骤完成后，生成变更清单
5. 更新 Context Ledger（如适用）

6. **完成 Skill Log**:
   ```bash
   node .harness/tools/skill-log.js complete \
     --task-id {task-id} \
     --skill-name implementing \
     --output-file changes.md \
     --confidence {置信度}
   ```

## 输出
- 代码变更（实际修改的文件）
- workspace/{task-id}/changes.md（变更清单）

## 约束
- 严格按照 task-plan.md 的步骤执行
- 不跳过验证环节
- 变更清单必须列出所有修改的文件
- 如偏离计划，必须在 changes.md 中说明原因

## 产出物规范

### Summary for downstream
变更清单开头必须包含此区块，格式如下：

```markdown
## Summary for downstream

- **Goal**: [本阶段核心目标，1-2 句话]
- **Key Decisions**: 
  - 决策 1: [是什么 + 为什么]
- **Known Risks**: 
  - 风险 1: [描述 + 影响面]
- **Downstream Files**: 
  - `src/xxx.ts` (+45 lines)
  - `src/yyy.ts` (+30 lines)
- **Verification**: 
  - ✅ 步骤 1 验证通过
  - ✅ 步骤 2 验证通过
- **Limitations**: 
  - 未测试并发场景
```
