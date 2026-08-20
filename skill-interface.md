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
   - Lessons Applied（任务计划）：记录命中的既有经验（knowledge/lessons/），**在 task-plan.md 中声明 lessons 文件名**，use_count/last_used 由 `lessons-apply` 工具在阶段结束后自动记账（agent 不直接改写 lessons 文件）
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

## 接口之外的运行时机制

以下机制虽与 skill 相关，但属于 harness 运行时/流程，不在本接口规范内，详见对应文档：

- **Skill 执行留痕（skill-log）**：框架自动写入 `workspace/{task-id}/skill-logs/`，见 `harness.md`「技能执行留痕」
- **确定性输入与语义判断分离**：harness 全局原则，见 `harness.md`「关键原则」
- **验证命令项目化（verify.config.json）**：命令池 key 与解析规则见 `docs/workflow-spec.md` §3，他证原则见 `harness.md`

