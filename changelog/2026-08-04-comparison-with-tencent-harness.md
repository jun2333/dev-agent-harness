# 腾讯 Harness Engineering vs dev-agent-harness 对比分析

> 来源文章：《驾驭AI Coding：一份面向团队的Harness Engineering落地规范》（腾讯技术工程）
> 分析日期：2026-08-04

## 一、定位差异（最根本的区别）

| 维度 | 腾讯方案 | dev-agent-harness |
|------|----------|-------------------|
| **目标用户** | 团队管理者，解决"100人用AI标准不一"的问题 | 个人开发者/小团队，解决"AI偷懒/跳步/幻觉"的问题 |
| **核心公式** | 让工具适配规范，而非人适配工具 | 可靠性 = 流程约束 + 精准上下文 + 阶段产出 + 经验闭环 |
| **依赖生态** | 深度绑定 CodeBuddy + Knot 平台 | 工具无关，git submodule 嵌入任意项目 |
| **落地方式** | 平台配置（UI 界面操作） | 代码仓库 + YAML + Markdown 文件 |
| **知识管理** | 上传文档 → AI 引用（静态） | 知识生命周期 + confidence score + 淘汰机制（动态） |
| **质量保障** | 人工 Code Review + 审计 Skill | 反合理化 + 反 Cherry-Pick + verify.js 强制验证 |

## 二、dev-agent-harness 已经做得更好的地方

### 2.1 反合理化机制（Anti-Rationalization）

腾讯完全没有这个。harness.md 中的 6 条红旗表（"差不多就行" → "停下来"）直接对抗 LLM 偷懒本能，是实战中磨出来的。腾讯的 Rules 体系虽然约束了代码风格，但没有约束 AI 的"思维偷懒"。

### 2.2 确定性/语义判断分离

腾讯的 Rules 和 Skills 都是纯文本 Prompt，没有区分"可验证的事实"和"需要判断的语义"。skill-interface.md 明确要求分离两者，配合 verify.js 强制验证确定性输出，比腾讯的做法严谨得多。

### 2.3 Context Ledger（上下文账本）

腾讯讲"上下文管理"但只停留在"按需加载知识库"的层面。dev-agent-harness 直接追踪每个文件的读取记录（File / Reason / Phase / Timestamp），防止重复读取浪费 Token，也便于调试"AI 为什么不知道这个"。

### 2.4 知识生命周期管理

腾讯的知识库就是"上传文档 → AI 引用"，没有淘汰机制。dev-agent-harness 有 confidence score、invalidation_condition、use_count、过期淘汰、低置信度清理。这是"活知识" vs "死文档"的区别。

### 2.5 反 Cherry-Pick 声明

腾讯的测试和审查环节没有防"报喜不报忧"的机制。dev-agent-harness 的 Anti-Cherry-Pick Declaration（PASS / FAIL / NOT-RUN 必须全列）非常实用。

### 2.6 断点恢复（State Checkpoint）

腾讯没有跨会话恢复机制。checkpoint.json + 自动/手动恢复是真正的工程化思维，解决了"AI 对话断了就得从头来"的痛点。

### 2.7 Skill 自进化（skill-evolution）

腾讯的 Skill 创建后就是静态的，靠"月度 Review 会议"人工维护。skill-evolution 通过聚合 skill-logs 自动发现改进点，review → apply 两阶段闭环，是真正的"知识飞轮"。

## 三、腾讯方案值得借鉴的地方（取其精华）

### 3.1 [P0] harness-audit：合规性审计 Skill

腾讯最亮眼的实操产出。项目有完善的规范，但缺少"一键检查项目是否遵循规范"的工具。

**建议**：新增 `skills/tools/harness-audit/SKILL.md`，检查项包括：

- `harness.md` 是否存在且精简（~100 行）
- `workflows/` 目录完整性（是否覆盖 feature/bugfix/refactor）
- `knowledge/` 索引是否膨胀（_index.md 不超过 50 条）
- `workspace/` 是否有未归档的旧任务
- skill-logs 是否正常写入
- context-ledger 是否被使用
- 产出物模板是否包含 Summary 和 Anti-Cherry-Pick 声明

可参考腾讯的 7 维度评分体系（S/A/B/C/D 五级评定），给出改进建议和优先级。

### 3.2 [P1] SOP 标准化操作流程

腾讯把日常开发拆成 SOP-A（新需求）、SOP-B（Bug 修复）、SOP-C（Code Review），每个都有明确的步骤和 Prompt 模板。dev-agent-harness 的 workflow 更偏"AI 执行流程"，缺少"人该怎么跟 AI 配合"的操作手册。

**建议**：新增 `docs/SOP.md`，面向使用者（而非 AI），说明：

- 新需求来了怎么发起对话、该给什么输入
- Bug 修复时该怎么描述问题、该引用哪些文件
- Code Review 时该给 AI 什么输入、期望什么产出
- 简单需求（< 半天）的快捷流程 vs 复杂需求的完整流程

### 3.3 [P1] 反模式清单

腾讯列了 8 个反模式（巨型 Prompt、跳过审核、Rules 不维护、MCP 过度接入、Skill 不原子化、盲目信任 AI、Chat 历史当文档、一个 PR 改所有）。dev-agent-harness 的 changelog 记录了"未采纳的设计"，但缺少面向用户的"常见错误用法"。

**建议**：在 README.md 或单独文档中加 Anti-Patterns 章节，例如：

| 反模式 | 现象 | 正确做法 |
|--------|------|----------|
| 跳过 designing 直接编码 | "需求简单"就跳过设计阶段 | 任何需求都走 designing，哪怕只花 5 分钟 |
| 不写 Summary for downstream | 阶段产出没有下游摘要 | 每个阶段必须输出 Summary 区块 |
| 知识不淘汰 | knowledge/ 堆积几百条经验 | 定期 reflecting，清理低置信度条目 |
| 不做 verify | AI 说"测试通过"就信了 | 必须用 verify.js 跑实际命令 |
| 巨型任务不拆分 | 一个 task 包含 5 个不相关功能 | 一个 task 只解决一个问题 |

### 3.4 [P2] Rules 分层体系

腾讯把 Rules 分成 User → Team → Project 三层，优先级明确（高优先级覆盖低优先级）。dev-agent-harness 的 `context-rules/` 只有 loading-strategy 和 file-discovery，缺少"代码风格约束"和"安全约束"这类分层规则。

**建议**：在 `context-rules/` 下增加分层概念：

```
context-rules/
├── loading-strategy.md      # 已有：上下文加载策略
├── file-discovery.md        # 已有：文件发现策略
├── code-style.md            # 新增：代码风格约束（可被项目覆盖）
└── security.md              # 新增：安全红线（不可被覆盖，最高优先级）
```

### 3.5 [P2] human_review 显式标注

腾讯的 4-Stage 流程（Plan → 审核 → Agent 执行 → 归档）更强调 requirements.md 作为人工审核的锚点。dev-agent-harness 的 workflow 虽然有"等用户确认"，但没有在 YAML 中显式标注哪些阶段**必须**人工审核。

**建议**：在 YAML workflow 中加 `human_review: required` 字段：

```yaml
stages:
  - name: designing
    human_review: required  # 设计文档必须人工确认后才进入下一阶段
    skills: [designing]
    output: design-output.md
  - name: task-planning
    human_review: optional  # 任务计划可由 AI 自主推进
    skills: [task-planning]
    output: task-plan-output.md
```

### 3.6 [P3] 成熟度模型

腾讯的审计结果给出 S/A/B/C/D 五级评定 + 成熟度路线图（当前阶段 → 下一阶段目标 → 预计达成时间）。dev-agent-harness 缺少"衡量当前使用效果"的机制。

**建议**：等 harness-audit 做完后，在输出中加入评分和路线图建议，形成"体检 → 诊断 → 开方 → 复查"的闭环。

## 四、优先级总结

| 优先级 | 借鉴项 | 理由 | 预计工作量 |
|--------|--------|------|------------|
| **P0** | harness-audit Skill | 已有完整规范，缺"自动检查是否被遵循"，投入产出比最高 | 1-2 天 |
| **P1** | SOP 文档 | 降低使用门槛，让"人"知道怎么配合 AI | 半天 |
| **P1** | 反模式清单 | 防止常见误用，成本低收益高 | 2 小时 |
| **P2** | Rules 分层 | context-rules 偏技术，缺少代码风格/安全约束 | 半天 |
| **P2** | human_review 字段 | YAML 中显式标注审核节点 | 1 小时 |
| **P3** | 成熟度模型 | 等 audit 做完后自然可以加评分 | 2 小时 |

## 五、核心结论

两个方案解决的是不同层面的问题：

- **dev-agent-harness** 解决的是"AI 执行可靠性"——怎么让 AI 不偷懒、不幻觉、不跳步、可追溯
- **腾讯方案** 解决的是"团队规模化管理"——怎么让 100 个人用 AI 的标准一致、可审计、可度量

两者互补性很好。dev-agent-harness 在 AI 执行层面的设计深度（反合理化、Context Ledger、知识生命周期、断点恢复、Skill 自进化）远超腾讯方案；腾讯方案在团队管理层面的实操经验（审计 Skill、SOP、反模式、分层规则）值得吸收。

建议优先落地 P0 的 harness-audit，这是"规范的可执行版本"，能让整套体系从"写了规范"升级到"自动检查规范"。
