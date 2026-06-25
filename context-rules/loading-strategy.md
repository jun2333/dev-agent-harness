# 上下文加载策略

## 总原则
- 先概览后细节：先读目录结构，再读文件列表，最后才读文件内容
- 按需加载：只加载当前阶段需要的文件
- 知识库优先：先查 knowledge/，用已有经验指导行动

## 各阶段加载规则

### Designing 阶段
- [必读] task.md, knowledge/_index.md, knowledge/standards/
- [扫描] 项目目录结构（ls 级别，不读文件内容）
- [精读] 与任务直接相关的文件（最多 5 个）
- [选读] 相关 experience 文件（通过 _index.md 匹配）
- Token 预算：~15K tokens

### Task Planning 阶段
- [必读] task.md, design.md
- [参考] knowledge/patterns/ 中相关模式
- Token 预算：~8K tokens

### Implementing 阶段
- [必读] task.md, design.md, task-plan.md
- [精读] task-plan.md 中列出的需要修改的文件
- [参考] knowledge/patterns/ 中相关模式
- Token 预算：~30K tokens

### Testing 阶段
- [必读] task.md, task-plan.md, changes.md
- [精读] 变更的文件 + 对应的测试文件
- [参考] knowledge/standards/testing-rules.md
- Token 预算：~20K tokens

### Reviewing 阶段
- [必读] design.md, changes.md, test-report.md
- [精读] 所有变更文件（完整 diff）
- [参考] knowledge/standards/code-style.md
- Token 预算：~25K tokens
