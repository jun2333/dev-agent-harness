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
