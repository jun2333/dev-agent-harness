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

1. **Skill 实现**：`.harness/knowledge/skills/{name}/SKILL.md` 覆盖 harness 默认（如有）
2. **报告模板**：`.harness/knowledge/skills/{name}/templates/` > harness 仓库 `templates/`
3. **项目规范**：`.harness/knowledge/standards/` 由 skill 的上下文加载指令主动读取
4. **最佳实践**：`.harness/knowledge/patterns/` 通过 `_index.md` 语义匹配加载

## 知识库维护入口

知识库的写入/修改**只能通过以下 skill**，避免随意污染：

| Skill | 子命令 | 操作 |
|-------|--------|------|
| knowledge-init | scan | 扫描项目生成 standards / patterns 初版 |
| knowledge-init | skills | 生成业务 skill 目录和默认模板 |
| knowledge-init | optimize | 整理索引、合并重复、归档过期条目 |
| reflecting | 阶段一 | 生成经验草稿（lessons-draft.md），不直接写入知识库 |
| reflecting | 阶段二 | 收集用户审核通过的经验，写入 lessons/ |
