# Skill 接口规范

每个 skill 必须是一个目录，包含 SKILL.md 和可选资源：

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter metadata (required)
│   │   ├── name: (required)
│   │   ├── description: (required)
│   │   └── 触发方式、执行步骤、输出规范等
│   └── Markdown instructions (required)
── templates/       (optional) - 该技能的产出模板
├── scripts/         (optional) - 辅助脚本
└── references/      (optional) - 参考文档
```

## SKILL.md 格式规范

SKILL.md 必须包含 YAML frontmatter 和 Markdown 正文：

```markdown
---
name: skill-name
description: 技能描述和触发方式
---

# Skill Title

## Overview
[1-2 句说明]

## 触发方式
[自动/手动/条件触发定义]

## 执行步骤
1. [具体步骤]

## 输出
[产出文件说明]

## 约束
[约束条件]
```

## 运行时加载优先级

当项目层和通用层存在同名内容时：

1. **Skill 实现**：`knowledge/skills/{name}/SKILL.md` 覆盖 harness 默认（如有）
2. **报告模板**：`knowledge/skills/{name}/templates/` > harness 仓库 `templates/`
3. **项目规范**：`knowledge/standards/` 由 skill 的上下文加载指令主动读取
4. **最佳实践**：`knowledge/patterns/` 通过 `_index.md` 语义匹配加载

## 框架标准模板继承机制

### 模板位置
`.harness/skills/domain-templates/` 包含 5 个框架级标准 skill 模板：
- designing.md
- task-planning.md
- implementing.md
- testing.md
- reviewing.md

### 继承规则
1. `knowledge-init skills` 命令基于框架模板生成项目特定 skill
2. 生成的 skill **必须保留**框架模板中的通用规范：
   - Summary for downstream 区块
   - Anti-Cherry-Pick Declaration（测试报告和审查报告）
   - Decision Log（设计文档和任务计划）
   - Lessons Applied（任务计划）：记录命中的既有经验（knowledge/lessons/），引用即消费，命中需递增该 lesson 的 use_count 并更新 last_used
3. 项目特定内容（角色、上下文加载指令、执行步骤、约束）基于 scan 产出填充
4. 项目可通过 `knowledge/skills/{name}/templates/` 覆盖框架默认模板

### 更新机制
- 框架模板更新后，可通过 `knowledge-init skills` 重新生成项目 skill
- 重新生成时保留项目特定内容，更新通用规范部分

## 知识库维护入口

知识库的写入/修改**只能通过以下 skill**，避免随意污染：

| Skill | 子命令 | 操作 |
|-------|--------|------|
| knowledge-init | scan | 扫描项目生成 standards / patterns 初版 |
| knowledge-init | skills | 生成业务 skill 目录和默认模板 |
| knowledge-init | optimize | 整理索引、合并重复、归档过期条目 |
| reflecting | 阶段一 | 生成经验草稿（lessons-draft.md），不直接写入知识库 |
| reflecting | 阶段二 | 收集用户审核通过的经验，写入 lessons/ |
| skill-evolution | review | 汇总 skill-logs，生成技能改进建议草稿 |
| skill-evolution | apply | 用户确认后修改对应 SKILL.md |

## Skill 执行留痕（skill-log）

每个技能执行完后，框架自动写入一条 skill-log 记录。这是技能自成长的数据来源，与项目经验（reflecting）无关。

### 文件位置
`workspace/{task-id}/skill-logs/{skill-name}.md`

### 格式
```markdown
# {skill-name} 执行记录

## {YYYY-MM-DD HH:mm}
- 任务：{task-id} — {任务简述}
- 执行结果：[ ] 顺利 [ ] 有问题
- 问题描述：（遇到什么问题？技能哪里不够用？）
- 改进建议：（技能应该增加/修改什么？）
```

### 生命周期
1. **创建**：技能执行完由框架自动写入空模板
2. **补充**：用户手填，或 agent 在后续对话中察觉问题后补填
3. **汇总**：skill-evolution review 读取所有 skill-logs，提取有价值的改进建议
4. **清理**：skill-evolution review 同时清理空模板（超过 30 天未填写）和已处理的过期记录

### 约束
- 单个技能不需要关心留痕，这是框架层行为
- skill-log 只记录技能自身的使用情况，不记录项目经验
- 空模板（所有 checkbox 未勾选且无文字描述）超过 30 天自动清理

## 确定性输入与语义判断分离

每个 skill 的执行步骤必须明确区分两类工作：

### 确定性输入（从实际状态读取，不臆造）

- 文件列表、目录结构、git commit hash
- 配置文件内容、依赖版本
- 命令执行结果、exit code
- checkpoint 中记录的阶段和进度
- 已有产出物的 Summary 区块内容

### 语义判断（基于确定性输入推断，不伪装成事实）

- 需求理解和范围判断
- 架构方案选择和 trade-off 分析
- 风险评估和影响面评估
- 代码质量判断和 review 结论
- 经验教训提炼和技能改进建议

**规则**：
- 确定性输入必须标注来源（从哪个文件/命令读取）
- 语义判断必须标注依据（基于哪些确定性输入推断）
- 不要把语义判断伪装成确定性事实（例如"测试通过了"必须附带实际运行的命令和输出）
- 不要把确定性工作交给 LLM 判断（例如文件是否存在、git hash 是什么，必须从实际状态读取）

## 验证命令项目化（verify.config.json）

验证命令（测试/构建/lint）是**确定性证据的唯一合法来源**，必须由项目拥有，不允许 LLM 自选：

- 配置位置：`knowledge/verify.config.json`（项目层，随项目版本管理，由 `knowledge-init skills` 生成）
- 格式：
  ```json
  {
    "schema_version": "verify.config.v1",
    "commands": ["npm run test:unit", "npm run build"],
    "timeout_ms": 300000
  }
  ```
- 执行入口：`node .harness/tools/verify.js run` 自动从配置读取命令；传 `--commands` 会被拒绝
- gate 校验：testing/reviewing 阶段的证据（verification-result.json）必须与配置**对账**——
  配置中的命令必须全量执行，证据中不允许出现配置外的命令
- 需要新增任务专项验证命令时，编辑配置文件（项目拥有的变更），而不是在命令行自选
