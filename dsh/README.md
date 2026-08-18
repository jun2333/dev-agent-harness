# DSH 专属版本（dsh-version 分支）

本分支在通用层（main 分支）之上，为 DSH 运行时构建专属适配层。通用层的
workflows / skills / templates / tools / hooks 原样复用，DSH 只提供**结构性执行能力**。

## 核心理念：把「劝」升级成「卡」

通用层的约束最终都落在"LLM 愿意遵守"上（YAML 是文档不是程序、gate 只查产出物存在性）。
DSH 版本把这些约束迁移到运行时结构：

| 约束 | CLI 版本（main） | DSH 版本（本分支） |
|---|---|---|
| 流程约束 | workflow YAML 由 LLM 自读自执行 | 编排器（workflow 工具）逐阶段驱动，失败程序化回退 |
| 上下文 | context-ledger 记账防重复读 | 每阶段干净子代理，输入白名单由编排器给定（账本消失） |
| 产出门禁 | gate-check.js exit 2（事后存在性检查） | 子代理返回 JSON 摘要 + schema 校验（数据级）+ ask_user_question（流程级） |
| 证据链 | verify.js 命令来自项目配置（v0.4 已修） | 同一配置 + 编排器校验 verify_evidence 字段 |
| 危险操作 | 提示词约定 | 沙箱权限 + 审批（justification） |
| 经验闭环 | 靠 LLM 记得查 knowledge/ | Mnemon 语义召回 + 热内存注入（P2） |

## 目录结构

```
dsh/
├── README.md                    # 本文档
├── ab-experiment-report.md      # A/B 实验报告（编排流优先落地的决策依据）
├── runtime-verification.md      # DSH 运行时能力验证报告（preset 格式/沙箱/工具可用性）
├── install.js                   # DSH 目标安装器（复制 preset 目录到 ~/.dsh/.agent-presets/）
├── preset/
│   └── harness/                 # Harness 模式 preset（目录格式：preset.yml + agent.cordis.yml + NOTICE）
├── stage-schema.json            # 阶段 schema（单一真相源，与 gate-check 的 STAGE_REQUIREMENTS 同步）
└── orchestrator.workflow.js     # 编排器原型（workflow 工具脚本模板）
```

## 门禁分层

| 层 | 机制 | 粒度 | 状态 |
|---|---|---|---|
| 数据级 | 编排器 schema 校验 JSON 摘要（sections_ok / verify_evidence） | 阶段产出 | 原型 |
| 流程级 | ask_user_question（gate: user_approval） | 阶段推进 | 待接 |
| 工具级 | 沙箱权限 + 审批（justification） | 单次工具调用 | 待验证 |
| 确定性 | gate-check.js 经 bash 复用（Stop 收尾复核） | 产出物+证据 | 可复用 |

## Roadmap

### P0 — 编排器 + A/B 验证（当前阶段）
- [x] dsh/stage-schema.json（阶段 schema 单一真相源）
- [x] dsh/orchestrator.workflow.js（通用编排器原型：bootstrap 解析 YAML → 逐阶段子代理 → schema 门禁 → on_fail 回退）
- [x] dsh/preset/harness/（preset 目录：preset.yml + agent.cordis.yml + NOTICE，基于 standard 适配，含 delegation 组）+ dsh/install.js
- [x] **A/B 实验**（2026-08-18，taskflow 看板筛选）：完整报告见 [ab-experiment-report.md](ab-experiment-report.md)。结论：编排流审查更严（独立上下文无锚定偏差）、复盘翻倍、编排器上下文显著更轻、证据链两流均稳 → **编排器作为 DSH 默认执行模型优先落地**
- [x] **运行时验证**（2026-08-18）：见 [runtime-verification.md](runtime-verification.md)。preset=目录（agent.cordis.yml+preset.yml）已按真实格式重写；子代理无独立沙箱（权限会话级，阶段权限走会话默认+审批）；delegation 组（subagent/workflow/ask_user_question）已纳入 preset
- [ ] 剩余验证：DSH 环境新建会话选「Harness 模式」冒烟装载；子代理 cwd 实测

### P1 — 证据链与双轨审查
- [x] **审核简报**（tools/review-brief.js）：git diff 变更表 + 各阶段 Summary + 验证证据 + 审查计数，机械合成一页（减人类审核心智负担）
- [x] **建议人工复查清单**：review-report 新增 AI 盲区清单区块（文件集合机械锚定 + 优先级确定性信号 + 理由必须回答"AI 为何验证不了"）
- [x] **人类反馈闭环**：human-review-feedback 模板 + reflecting collect 吸收人类意见进 lessons（source: human-review）
- [ ] review 阶段双轨：实施与审查用不同 provider/model（workflow 支持 per-phase 覆盖），或 parallel 两个独立审查代理对比
- [ ] 自适应门禁：门禁策略确定性化（任务开头选确认模式），LLM 只执行策略不决定策略

### P2 — 知识层三层架构
- [ ] knowledge/ 文件保持真相源（git 分发不变）
- [ ] reflecting 阶段二双写：markdown 文件 + Mnemon insight（tags/confidence/来源任务）
- [ ] 热内存注入：最热规范+高频 lessons 进运行时内存，每轮在场

### P3 — 任务/状态/可视化
- [ ] 任务看板管理 harness 任务（钉 工作区/模式/权限）+ cron 定时（knowledge-init optimize / skill-evolution review）
- [ ] goal 工具长任务自动续跑 + 阻塞检测
- [ ] aionui-panel 文件树/预览/SCM 面板展示阶段产出与变更

## A/B 实验设计（P0 的关键验收）

1. 选一个真实开发任务（你手头任选）
2. 跑法 A：main 分支现有单会话流程（hook + 提示词）
3. 跑法 B：本分支编排流程（子代理分阶段 + schema 门禁 + ask_user_question 门禁）
4. 指标：阶段返工次数 / 读取文件数与 token 量（context-ledger 可量化）/ 用时 / 产出质量（你主观评审）
5. 通过标准建议：B 的返工次数 ≤ A，且产出质量不降；token 总量预期显著下降

## 与 main 分支的关系

- 本分支基于 main（含 v0.4 验证命令项目化）
- main 分支继续维护跨 CLI 通用层（Qoder/Claude/Codex + hooks）
- 本分支的 stage-schema.json 与 hooks/gate-check.js 的 STAGE_REQUIREMENTS 需保持同步（gate-check 注释已标注）
- 通用层的改进合回 main 后，本分支 rebase 或 merge 跟进
