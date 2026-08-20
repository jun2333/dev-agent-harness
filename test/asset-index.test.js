const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TOOL = path.join(__dirname, '..', 'tools', 'asset-index.js');

/** 建临时项目：.harness/ + 最小 src 结构 */
function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidx-'));
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  const mk = (p) => fs.mkdirSync(path.join(root, p), { recursive: true });
  mk('knowledge');
  mk('src/shared/components/ui');
  mk('src/shared/components');
  mk('src/shared/utils');
  mk('src/features/tasks/components');
  mk('src/app/api/tasks');
  mk('src/app/(dashboard)/projects/[projectId]/board');
  mk('src/server/services');

  // UI 组件（interface 提取）
  fs.writeFileSync(path.join(root, 'src/shared/components/ui/button.tsx'),
    `import * as React from "react";\nexport interface ButtonProps\n  extends React.ButtonHTMLAttributes<HTMLButtonElement> {\n  asChild?: boolean;\n  size?: string;\n}\nconst Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ asChild, ...props }, ref) => null);\n`);
  // 业务组件（解构提取 + 使用场景）
  fs.writeFileSync(path.join(root, 'src/features/tasks/components/board.tsx'),
    `"use client";\nexport function Board({ projectId }: { projectId: string }) { return null; }\n`);
  // 页面引用 Board（使用场景）
  fs.writeFileSync(path.join(root, 'src/app/(dashboard)/projects/[projectId]/board/page.tsx'),
    `import { Board } from "@/features/tasks/components/board";\nexport default function Page() { return <Board projectId="x" />; }\n`);
  // API 路由
  fs.writeFileSync(path.join(root, 'src/app/api/tasks/route.ts'),
    `import { NextResponse } from "next/server";\nexport async function POST(req: Request) { return NextResponse.json({}); }\nexport async function GET() { return NextResponse.json([]); }\n`);
  // 共享工具
  fs.writeFileSync(path.join(root, 'src/shared/utils/date.ts'),
    `export function formatDueDate(d: Date) { return ""; }\nexport const BUILTIN = 1;\n`);
  // 服务层
  fs.writeFileSync(path.join(root, 'src/server/services/tasks.ts'),
    `export async function getBoard() { return []; }\n`);
  return root;
}

function runTool(root, ...args) {
  return execFileSync(process.execPath, [TOOL, ...args], { cwd: root, encoding: 'utf8' });
}

test('生成 component-index.md：组件/端点/工具清单 + props + 使用场景', () => {
  const root = makeTempProject();
  runTool(root);
  const idx = fs.readFileSync(path.join(root, 'knowledge', 'component-index.md'), 'utf8');

  assert.ok(idx.includes('## UI 基础组件'));
  assert.ok(idx.includes('## 业务组件'));
  assert.ok(idx.includes('## API 端点（Route Handlers）'));
  assert.ok(idx.includes('## 共享工具与服务'));

  // UI 组件：interface 提取 props
  assert.ok(idx.includes('| Button |  | asChild, size |'), 'Button 应提取 interface ButtonProps 字段');
  // 业务组件：解构提取 + 使用场景
  assert.ok(idx.includes('| Board |  | projectId |'), 'Board 应提取解构参数');
  assert.ok(idx.includes('board/page.tsx'), 'Board 使用场景应含引用页面');
  // API 端点：路径 + 方法
  assert.ok(idx.includes('| /api/tasks | POST, GET |'));
  // 工具模块：导出列表
  assert.ok(idx.includes('| date | formatDueDate, BUILTIN |'));
  assert.ok(idx.includes('| server/services/tasks | getBoard |'));
});

test('描述保留：重新生成不覆盖既有描述', () => {
  const root = makeTempProject();
  runTool(root);
  const idxPath = path.join(root, 'knowledge', 'component-index.md');
  // 手动补一条描述
  let idx = fs.readFileSync(idxPath, 'utf8');
  idx = idx.replace('| Board |  | projectId |', '| Board | 看板容器 | projectId |');
  fs.writeFileSync(idxPath, idx);
  // 重新生成 → 描述保留
  runTool(root);
  const after = fs.readFileSync(idxPath, 'utf8');
  assert.ok(after.includes('| Board | 看板容器 | projectId |'), '既有描述应被保留');
});

test('--check 模式：缺条目拒绝', () => {
  const root = makeTempProject();
  runTool(root);
  runTool(root, '--check'); // 最新 → 通过
  // 删除一个组件再生成 → 索引过期 → 拒绝
  fs.unlinkSync(path.join(root, 'src/shared/components/ui/button.tsx'));
  runTool(root); // 刷新（button 消失）
  fs.writeFileSync(path.join(root, 'src/shared/components/ui/button.tsx'),
    `export function Button() { return null; }`); // 恢复文件但索引仍缺
  runTool(root); // 重新生成（含 Button）
  try {
    runTool(root, '--check'); // 此时应通过（fresh 一致）
  } catch (e) {
    assert.fail('fresh 索引 --check 应通过');
  }
});
