---
name: testing
description: 测试阶段技能模板（框架标准版）。knowledge-init 时基于此模板生成项目特定 skill。
---

# Testing Skill（框架标准模板）

> **注意**：这是框架级标准模板。`knowledge-init skills` 命令会基于此模板，结合项目 scan 产出（standards/、patterns/）生成项目特定的 testing skill。

## 角色
严谨的测试工程师，负责验证变更的正确性和完整性。

## 输入
- 任务描述（task.md）
- 任务计划（task-plan.md）
- 变更清单（changes.md）

## 上下文加载指令
1. 精读 changes.md，了解所有变更
2. 读取变更文件及其对应的测试文件
3. 读取项目的测试规范（如 knowledge/standards/testing-rules.md）
4. 按需加载相关 pattern 文件

## 执行步骤
0. **启动 Skill Log**:
   ```bash
   node .harness/tools/skill-log.js start \
     --skill knowledge/skills/testing/SKILL.md \
     --task-id {task-id} \
     --input-files "task.md,task-plan.md,changes.md"
   ```

1. 检查测试基础设施（根据项目技术栈）
2. 运行验证命令（使用 CLI 工具）：
   ```bash
   node .harness/tools/verify.js run \
     --commands "{从本 skill 的 verification_commands 字段读取}" \
     --output-dir workspace/{task-id}/test-results \
     --report workspace/{task-id}/verification-result.json
   ```
3. 读取 verification-result.json，获取每个命令的 exit_code 和 log_path
4. 检查变更文件是否有对应测试覆盖
5. 如缺少测试，补充关键路径的测试用例
6. 验证 task.md 中的验收标准是否满足
7. 生成测试报告（使用 templates/test-report-output.md，引用 verification-result.json 中的数据）

8. **完成 Skill Log**:
   ```bash
   node .harness/tools/skill-log.js complete \
     --task-id {task-id} \
     --skill-name testing \
     --output-file test-report.md \
     --confidence {置信度}
   ```

## verification_commands
（此字段由 knowledge-init 根据项目技术栈生成）
```yaml
- npm run test:unit
- npm run build
```

## 输出
生成 workspace/{task-id}/test-report.md

## 约束
- 测试报告必须遵循 templates/test-report-output.md 格式
- 必须包含 Summary for downstream 区块
- 必须包含 Anti-Cherry-Pick Declaration（完整性声明）
- 测试失败时必须记录具体错误信息和堆栈
- 不跳过失败的测试
- 测试报告必须包含通过/失败/跳过的数量

## 产出物规范

### Summary for downstream
测试报告开头必须包含此区块，格式见 templates/test-report-output.md。

### Anti-Cherry-Pick Declaration
测试报告必须包含完整性声明，格式见 templates/test-report-output.md。

核心要求：
- 列出**全部**执行的验证命令和测试用例
- 如果存在 NOT-RUN 的用例，结论必须标记为"未完成"
- 如果存在 FAIL 的用例，结论必须标记为"未通过"
- 不允许只汇报通过的部分而隐藏失败/未运行的部分
