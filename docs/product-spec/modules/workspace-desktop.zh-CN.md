# Workspace Desktop

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 桌面工作区视图。
- 活动栏、侧栏、主区、底部终端组合。
- 桌面专属工作区控件。

不覆盖：
- 各子面板内部功能，分别写入对应模块。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| `/workspace` 宽屏视口 | Desktop | 渲染桌面工作区布局。 |
| Workspace activity bar | Desktop | 切换 Files、Git、Search、Skills 等区域。 |
| 顶栏和底部面板 | Desktop | workspace 操作和终端面板入口。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| WSD-001 | 桌面工作区整体渲染 | Implemented | `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx` | `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx` |
| WSD-002 | 桌面活动栏 | Implemented | `packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx` | `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx` |
| WSD-003 | 桌面 explorer 面板组合 | Implemented | `packages/web/src/features/workspace/views/shared/explorer-panel.tsx` | `packages/web/src/features/workspace/views/shared/explorer-panel.test.tsx` |
| WSD-004 | 桌面工作区状态栏 | Implemented | `packages/web/src/features/workspace/views/shared/workspace-status-bar.tsx` | 手工验收：桌面工作区底部/状态区域 |
| WSD-005 | observer banner 展示 | Implemented | `packages/web/src/features/workspace/views/shared/observer-banner.tsx` | `packages/web/src/features/workspace/views/shared/observer-banner.test.tsx` |

## 4. 模块级验收线索

- 宽屏进入 `/workspace` 时应显示桌面多区域工作台。
- 活动栏切换不应丢失当前 workspace。
- 子面板错误不应破坏整体布局。

## 5. 未确认项

- 各面板的精确视觉尺寸和 resize 行为在 Workspace Tabs / Layout 模块细化。
