# Workspace Mobile

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 移动端工作区视图。
- Dock、Sheet、Drawer、移动端顶部栏。
- 移动端文件、agent、terminal、supervisor 入口编排。

不覆盖：
- 每个 Sheet 内部业务细节。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| `/workspace` 移动视口 | Mobile | 渲染移动工作区布局。 |
| Mobile Dock | Mobile | 打开 agent、files、terminal、supervisor 等区域。 |
| Workspace Drawer | Mobile | 查看和切换 workspace。 |
| Mobile Topbar | Mobile | 移动端顶栏状态和 workspace 入口。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| WSM-001 | 移动工作区整体渲染 | Implemented | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx` | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx` |
| WSM-002 | 移动端顶部栏 | Implemented | `packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx` | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx` |
| WSM-003 | 移动端 Dock | Implemented | `packages/web/src/features/workspace/views/mobile/mobile-dock.tsx` | `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx` |
| WSM-004 | Agent Sheet | Implemented | `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx` | `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx` |
| WSM-005 | Files Sheet | Implemented | `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx` | `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx` |
| WSM-006 | Workspace Drawer | Implemented | `packages/web/src/features/workspace/views/mobile/mobile-workspace-drawer.tsx` | `packages/web/src/features/workspace/views/mobile/mobile-workspace-drawer.test.tsx` |
| WSM-007 | Mobile explorer panel | Implemented | `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.tsx` | `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx` |
| WSM-008 | 移动布局/动效模式 hook | Internal | `packages/web/src/features/workspace/views/mobile/hooks` | 手工验收：移动视口布局与键盘视口变化 |

## 4. 模块级验收线索

- 移动视口进入工作区时应显示 Dock 驱动布局。
- Dock 打开不同 Sheet 后应保持当前 workspace 上下文。
- Workspace Drawer 能展示 workspace 列表并切换 active workspace。

## 5. 未确认项

- 视觉视口 inset 在不同移动浏览器的边界需后续人工设备验收。
