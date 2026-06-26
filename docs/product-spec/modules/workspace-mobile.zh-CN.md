# Workspace Mobile

> 当前代码基线。本文只记录当前移动端工作区中真实挂载、真实可达的能力。

## 1. 模块范围

覆盖：
- 移动端工作区整体布局。
- 顶部栏、当前会话主区、底部状态栏。
- Agent / Files / Terminal / Supervisor Sheet。
- Workspace Drawer。

不覆盖：
- 各 Sheet 内部的业务细节。
- 未挂载组件或仅代码存在但无入口的移动端 UI。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| `/workspace` 移动视口 | Mobile | 渲染移动工作区布局。 |
| Mobile Top Bar | Mobile | 打开 workspace drawer、文件、终端或 agent 相关入口。 |
| Agent Sheet | Mobile | 创建会话或切换当前 workspace 内的会话。 |
| Files Sheet | Mobile | 浏览文件、搜索、Source Control 和文件详情。 |
| Terminal Sheet | Mobile | 进入全屏终端视图。 |
| Supervisor Sheet | Mobile | 查看当前会话的 supervisor 详情。 |
| Workspace Drawer | Mobile | 查看和切换 workspace，以及切换其他 workspace 的会话。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| WSM-001 | 移动工作区整体渲染 | Implemented | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx` | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx` |
| WSM-002 | 移动端顶部栏 | Implemented | `packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx` | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx` |
| WSM-003 | 当前会话主区与底部状态栏 | Implemented | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`、`packages/web/src/features/workspace/views/shared/workspace-status-bar.tsx` | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx` |
| WSM-004 | Agent Sheet | Implemented | `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx` | `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx` |
| WSM-005 | Files Sheet | Implemented | `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx` | `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx` |
| WSM-006 | Terminal Sheet | Implemented | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`、`packages/web/src/features/terminal-panel` | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx` |
| WSM-007 | Supervisor Sheet | Implemented | `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx` | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx` |
| WSM-008 | Workspace Drawer | Implemented | `packages/web/src/features/workspace/views/mobile/mobile-workspace-drawer.tsx` | `packages/web/src/features/workspace/views/mobile/mobile-workspace-drawer.test.tsx` |
| WSM-009 | Mobile Dock 组件 | Internal | `packages/web/src/features/workspace/views/mobile/mobile-dock.tsx` | 代码存在，但当前 `WorkspaceMobileView` 未挂载 |

## 4. 当前页面事实

- 当前移动端不是 Dock 驱动布局；真实布局是“顶部栏 + 当前会话主区 + Sheet/Drawer + 底部状态栏”。
- `MobileDock` 组件当前仅存在于代码中，未被 `WorkspaceMobileView` 挂载，不能写成已上线功能。
- Files Sheet 当前承担多种视图：
  - `explorer`
  - `search`
  - `source-control`
  - 文件详情 / 编辑器详情
- Terminal 以全屏 Sheet 打开，底部仍可附带 workspace 状态栏。
- Workspace Drawer 会按需 hydrate 非当前 workspace 的会话列表。

## 5. 模块级验收线索

- 移动视口进入 `/workspace` 后，应直接看到当前会话主区，而不是底部 Dock。
- 从顶部栏或其他移动入口打开 Files / Terminal / Supervisor 时，应进入对应 Sheet。
- 打开 Workspace Drawer 后，应能切换 workspace，并查看其他 workspace 的会话列表。
