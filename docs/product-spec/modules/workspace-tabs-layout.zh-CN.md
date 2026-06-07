# Workspace Tabs / Layout

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- workspace tab、顶部 tab 交互。
- workspace UI state 持久化、布局操作、focus/fullscreen。
- 最近查看目标。

不覆盖：
- 文件、Git、终端等面板内容。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| 顶部 workspace tabs | Desktop | 切换、展示 workspace 和 session mini map。 |
| 全屏/专注控件 | Desktop | 切换工作区展示模式。 |
| 工作区导航快捷键 | Desktop | 键盘切换视图或目标。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| WSL-001 | workspace tab 展示 | Implemented | `packages/web/src/features/topbar/components/tab.tsx` | `packages/web/src/features/topbar/components/tab.test.tsx` |
| WSL-002 | workspace session mini map | Implemented | `packages/web/src/features/topbar/components/workspace-session-mini-map.tsx` | `packages/web/src/features/topbar/components/workspace-session-mini-map.test.tsx` |
| WSL-003 | UI state 持久化 | Implemented | `packages/web/src/features/workspace/actions/use-workspace-ui-state-persistence.ts`、`workspace.uiState.set` | `packages/web/src/features/workspace/actions/use-workspace-ui-state-persistence.test.tsx` |
| WSL-004 | 工作区布局操作 | Implemented | `packages/web/src/features/workspace/actions/use-workspace-layout-actions.ts` | 手工验收：侧栏、底栏和布局状态 |
| WSL-005 | 工作区全屏 | Implemented | `packages/web/src/features/workspace/actions/use-workspace-fullscreen.ts`、`workspace-fullscreen-button.tsx` | `packages/web/src/features/workspace/actions/use-workspace-fullscreen.test.tsx` |
| WSL-006 | 最后查看目标持久化 | Implemented | `packages/web/src/features/workspace/actions/use-persist-workspace-last-viewed-target.ts`、`workspace.lastViewedTarget.get/set` | `packages/web/src/features/workspace/actions/use-persist-workspace-last-viewed-target.test.tsx` |
| WSL-007 | 工作区导航快捷键 | Implemented | `packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.ts` | `packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.test.tsx` |
| WSL-008 | 独立 focus mode 组件 | Partial | `packages/web/src/features/focus-mode` | `packages/web/src/features/focus-mode/components/focus-mode.test.tsx` |

## 4. 模块级验收线索

- 切换 workspace tab 后 active workspace 应变化。
- 修改布局后刷新页面应恢复已持久化状态。
- 全屏/专注状态不应破坏 workspace 数据。

## 5. 未确认项

- WSL-008 是否仍是稳定用户入口需在第二轮确认。
