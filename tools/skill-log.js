#!/usr/bin/env node

/**
 * Harness Skill Log Tool
 * 
 * 自动记录技能执行的时间戳和基本信息，便于追溯和技能进化。
 * 
 * 用法：
 *   node skill-log.js start \
 *     --skill knowledge/skills/testing/SKILL.md \
 *     --task-id task-123 \
 *     --input-files "task.md,task-plan.md,changes.md"
 * 
 *   node skill-log.js complete \
 *     --task-id task-123 \
 *     --skill-name testing \
 *     --output-file test-report.md \
 *     --issues "Lint failed with 2 warnings" \
 *     --confidence 0.9
 */

const fs = require('fs');
const path = require('path');

function startSkillLog(skill, taskId, inputFiles) {
  const logDir = path.join('workspace', taskId, 'skill-logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const skillName = path.basename(skill, '.md');
  const logFile = path.join(logDir, `${skillName}.md`);

  const content = `# ${skillName} 执行记录

## ${new Date().toISOString()}
- **Skill**: ${skill}
- **Task ID**: ${taskId}
- **Started At**: ${new Date().toISOString()}
- **Input Files**: ${inputFiles}
- **执行结果**: [ ] 顺利 [ ] 有问题
- **问题描述**: （遇到什么问题？技能哪里不够用？）
- **改进建议**: （技能应该增加/修改什么？）
- **Completed At**: [待填充]
`;

  fs.writeFileSync(logFile, content);
  console.log(`Skill log started: ${logFile}`);
  return logFile;
}

function completeSkillLog(taskId, skillName, outputFile, issues, confidence) {
  const logDir = path.join('workspace', taskId, 'skill-logs');
  const logFile = path.join(logDir, `${skillName}.md`);

  if (!fs.existsSync(logFile)) {
    console.error(`Skill log not found: ${logFile}`);
    console.error('Did you call "start" first?');
    process.exit(1);
  }

  let content = fs.readFileSync(logFile, 'utf8');

  // 更新完成时间
  content = content.replace(
    /- \*\*Completed At\*\*: \[待填充\]/,
    `- **Completed At**: ${new Date().toISOString()}`
  );

  // 更新输出文件
  if (outputFile) {
    content = content.replace(
      /- \*\*Input Files\*\*: (.+)/,
      `- **Input Files**: $1\n- **Output File**: ${outputFile}`
    );
  }

  // 更新问题描述
  if (issues) {
    content = content.replace(
      /- \*\*问题描述\*\*: （遇到什么问题？技能哪里不够用？）/,
      `- **问题描述**: ${issues}`
    );
  }

  // 更新置信度
  if (confidence) {
    content = content.replace(
      /- \*\*改进建议\*\*: （技能应该增加\/修改什么？）/,
      `- **改进建议**: （技能应该增加/修改什么？）\n- **Confidence**: ${confidence}`
    );
  }

  fs.writeFileSync(logFile, content);
  console.log(`Skill log completed: ${logFile}`);
}

// CLI 入口
const args = process.argv.slice(2);
const subcommand = args[0];

if (subcommand === 'start') {
  const skillArg = args.find(arg => arg.startsWith('--skill='));
  const taskIdArg = args.find(arg => arg.startsWith('--task-id='));
  const inputFilesArg = args.find(arg => arg.startsWith('--input-files='));

  if (!skillArg || !taskIdArg || !inputFilesArg) {
    console.error('Usage: node skill-log.js start --skill=<skill> --task-id=<id> --input-files=<files>');
    process.exit(1);
  }

  startSkillLog(
    skillArg.split('=')[1],
    taskIdArg.split('=')[1],
    inputFilesArg.split('=')[1]
  );
} else if (subcommand === 'complete') {
  const taskIdArg = args.find(arg => arg.startsWith('--task-id='));
  const skillNameArg = args.find(arg => arg.startsWith('--skill-name='));
  const outputFileArg = args.find(arg => arg.startsWith('--output-file='));
  const issuesArg = args.find(arg => arg.startsWith('--issues='));
  const confidenceArg = args.find(arg => arg.startsWith('--confidence='));

  if (!taskIdArg || !skillNameArg) {
    console.error('Usage: node skill-log.js complete --task-id=<id> --skill-name=<name> [--output-file=<file>] [--issues=<text>] [--confidence=<num>]');
    process.exit(1);
  }

  completeSkillLog(
    taskIdArg.split('=')[1],
    skillNameArg.split('=')[1],
    outputFileArg ? outputFileArg.split('=')[1] : null,
    issuesArg ? issuesArg.split('=')[1] : null,
    confidenceArg ? confidenceArg.split('=')[1] : null
  );
} else {
  console.error('Usage: node skill-log.js <start|complete> ...');
  console.error('Subcommands:');
  console.error('  start    - Create a new skill log entry');
  console.error('  complete - Complete an existing skill log entry');
  process.exit(1);
}
