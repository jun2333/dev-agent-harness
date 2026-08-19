---
name: reviewing
description: 审查阶段技能模板（框架标准版）。knowledge-init 时基于此模板生成项目特定 skill。
---

# Reviewing Skill（框架标准模板）

> **注意**：这是框架级标准模板。`knowledge-init skills` 命令会基于此模板，结合项目 scan 产出（standards/、patterns/）生成项目特定的 reviewing skill。

## 角色
代码审查专家，负责验证变更的质量和设计一致性。

## 输入
- 任务描述（task.md）
- 设计文档（design.md）
- 任务计划（task-plan.md）
- 变更清单（changes.md）
- 测试报告（test-report.md）

## 上下文加载指令
0. **读取已读清单**：读取 workspace/{task-id}/context-ledger.md，已读文件不重复读取（除非确认内容已变更）
1. 精读 changes.md，了解所有变更
2. 读取 design.md，理解设计方案
3. 读取 test-report.md，了解测试结果
4. 读取相关的项目标准（knowledge/standards/code-style.md）
5. 按需加载变更的源码文件

## 执行步骤
0. **启动 Skill Log**:
   ```bash
   node .harness/tools/skill-log.js start \
     --skill knowledge/skills/reviewing/SKILL.md \
     --task-id {task-id} \
     --input-files "task.md,design.md,task-plan.md,changes.md,test-report.md"
   ```

1. 验证实现与设计文档的一致性
2. 检查代码质量（命名、错误处理、安全性等）
3. 检查测试覆盖是否充分
4. 识别潜在问题和风险
5. 生成审查报告（使用 templates/review-report-output.md）

6. **完成 Skill Log**:
   ```bash
   node .harness/tools/skill-log.js complete \
     --task-id {task-id} \
     --skill-name reviewing \
     --output-file review-report.md \
     --confidence {置信度}
   ```

## 输出
生成 workspace/{task-id}/review-report.md

## 约束
- 审查报告必须遵循 templates/review-report-output.md 格式
- 必须包含 Summary for downstream 区块
- 必须包含 Anti-Cherry-Pick Declaration
- 问题必须按严重程度分类（Critical/Warning/Info）
- 如果存在 Critical 问题，结论必须为"需要修改后重新审查"
- **必须生成「建议人工复查清单」区块**（AI 无法自行验证、需要人类语义裁决的文件清单）：
  - 文件集合 = 本任务 git diff 变更文件，只能从中选择
  - 优先级：审查发现 Critical/Warning/P0/P1 所在文件 → 高；交互密集/服务端权限面/数据流变更 → 中；纯类型 → 低
  - 每条理由必须回答「AI 为什么自己验证不了」，不重复列 AI 已确认的问题
- 审查完成后提示用户填写 human-review-feedback.md（模板见 templates/human-review-feedback.md），
  供 reflecting collect 收集人类反馈经验（反馈闭环）
- 涉及前端变更时，视觉审查对照 designing 的「视觉反模式清单」（挤/乱/花/愣/散/虚），
  抽查 implementing 是否执行了「渲染后视觉自查」；组件复用遵守 code-style 组件复用规范

## 产出物规范

### Summary for downstream
审查报告开头必须包含此区块，格式见 templates/review-report-output.md。

### Anti-Cherry-Pick Declaration
审查报告必须包含完整性声明，格式见 templates/review-report-output.md。

核心要求：
- 列出**全部**发现的 issues，按严重程度分类
- 如果存在 Critical 问题，Recommendation 必须为"Reject"或"Conditional Approval with Fixes"
- 不允许只汇报 Warning/Info 而隐藏 Critical 问题

### 建议人工复查清单
审查报告末尾必须包含此区块（AI 盲区清单，非 gate）：
- 高优先必看：审查发现 Critical/Warning/P0/P1 所在文件、交互密集组件
- 每条建议复查原因必须具体到「AI 验证不了什么」
