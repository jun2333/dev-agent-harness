// ============================================================================
// DSH Harness 编排器（workflow 工具脚本模板）— v0.1 原型
//
// 用法：在 DSH 会话中，把本文件内容作为 workflow 工具的 script 参数运行，
//       args 传入 { root: <目标项目绝对路径>, workflowName: "feature|bugfix|...", taskId: "task-xxx" }
//
// 设计（与讨论结论一致）：
//   - 阶段定义单一真相源 = .harness/workflows/*.yaml（本脚本不重复定义阶段，由 bootstrap 子代理解析）
//   - 每阶段一个干净上下文的子代理：prompt 只含 阶段 skill + 上游产出文件 + 输出模板 + JSON 摘要规格
//   - 数据级门禁 = agent() 的 schema 校验（子代理必须返回 JSON 摘要，sections_ok 必须为 true）
//   - 流程级门禁（gate: user_approval）由主代理在 workflow 返回后用 ask_user_question 执行
//   - 确定性复核：主代理可用 `echo <json> | node .harness/hooks/gate-check.js`（DSH bash 直接复用）
//   - on_fail 回退：testing/reviewing 失败 → 回到 implementing 重做（有重做次数上限）
//
// 注意：workflow 脚本无文件系统/网络访问，读文件全部交给子代理（bootstrap 也如此）。
// ============================================================================

const { root, workflowName, taskId } = args || {};
if (!root || !workflowName || !taskId) {
  return { error: 'args 需要 { root, workflowName, taskId }' };
}

// 阶段 JSON 摘要 schema（编排器数据级门禁）
const stageResultSchema = {
  type: 'object',
  properties: {
    stage: { type: 'string' },
    output_file: { type: 'string' },
    sections_ok: { type: 'boolean' },
    verify_evidence: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
  required: ['stage', 'output_file', 'sections_ok', 'verify_evidence'],
  additionalProperties: false,
};

// ------------------------------------------------------------------ Phase 1
phase('解析工作流');

const parsed = await agent(
  `你是 harness 编排引导。请读取 ${root}/.harness/workflows/${workflowName}.yaml 和 ` +
    `${root}/.harness/dsh/stage-schema.json（阶段 schema）。返回该工作流的阶段列表：` +
    `每个阶段含 { name, skill, input, output, gate, on_fail }（字段来自 YAML，input 转数组）。`,
  {
    label: 'bootstrap: parse workflow',
    phase: '解析工作流',
    schema: {
      type: 'object',
      properties: {
        workflow: { type: 'string' },
        stages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              skill: { type: 'string' },
              input: { type: 'array', items: { type: 'string' } },
              output: { type: 'string' },
              gate: { type: 'string' },
              on_fail: { type: ['string', 'null'] },
            },
            required: ['name', 'skill', 'input', 'output', 'gate'],
            additionalProperties: false,
          },
        },
      },
      required: ['workflow', 'stages'],
      additionalProperties: false,
    },
  }
);

if (!parsed || !parsed.stages || parsed.stages.length === 0) {
  return { error: '工作流解析失败：检查 workflowName 与 YAML 格式' };
}

// ------------------------------------------------------------------ Phase 2
phase('阶段执行');

const results = [];
const maxRework = 2;
let reworkLeft = maxRework;
let idx = 0;

while (idx < parsed.stages.length) {
  const stage = parsed.stages[idx];
  const stageNum = idx + 1;

  const inputs = (stage.input || [])
    .map(f => `${root}/.harness/workspace/${taskId}/${f}`)
    .join(', ');

  const result = await agent(
    `你是 harness 任务「${taskId}」的「${stage.name}」阶段代理（工作流 ${workflowName}）。\n` +
      `工作目录：${root}\n` +
      `1. 先读取并遵循技能：${root}/.harness/${stage.skill}\n` +
      `2. 阶段输入文件（存在则读）：${inputs}\n` +
      `3. 必须写出的产出物：${root}/.harness/workspace/${taskId}/${stage.output}（遵守模板必含区块）\n` +
      `4. 若为 testing/reviewing 阶段：用 node .harness/tools/verify.js run 执行验证（命令来自 ` +
      `${root}/knowledge/verify.config.json，禁止 --commands 自选），证据写 ` +
      `.harness/workspace/${taskId}/verify/verification-result.json\n` +
      `5. 完成后返回 JSON 摘要：{ stage, output_file, sections_ok, verify_evidence, notes }。` +
      `sections_ok 必须为 true 才能声明完成。`,
    {
      label: `stage: ${stage.name}`,
      phase: `阶段执行 (${stageNum}/${parsed.stages.length})`,
      schema: stageResultSchema,
    }
  );

  if (!result) {
    results.push({ stage: stage.name, status: 'failed', reason: '子代理失败或摘要未通过 schema' });
  } else {
    results.push({
      stage: stage.name,
      status: result.sections_ok ? 'passed' : 'failed',
      output_file: result.output_file,
      verify_evidence: result.verify_evidence,
      notes: result.notes || null,
    });
  }

  // on_fail 回退：testing/reviewing 未通过 → 回到 implementing 重做
  const last = results[results.length - 1];
  if (last.status === 'failed' && stage.on_fail && reworkLeft > 0) {
    const back = parsed.stages.findIndex(s => s.name === stage.on_fail);
    if (back !== -1) {
      log(`阶段「${stage.name}」未通过，回退到「${stage.on_fail}」重做（剩余 ${reworkLeft - 1} 次）`);
      results.push({ stage: `${stage.name}->rework:${stage.on_fail}`, status: 'rework' });
      idx = back;
      reworkLeft -= 1;
      continue;
    }
  }
  idx += 1;
}

return {
  workflow: workflowName,
  taskId,
  results,
  summary: {
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length,
    rework: results.filter(r => r.status === 'rework').length,
  },
  next_steps:
    '主代理对 gate=user_approval 的阶段逐一向用户确认（ask_user_question）；' +
    '确认后可用 `echo \'{"hook_event_name":"Stop","cwd":"' + root + '"}\' | node .harness/hooks/gate-check.js` 做确定性收尾复核。',
};
