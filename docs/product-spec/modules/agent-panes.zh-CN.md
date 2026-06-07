# Agent Panes

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- Agent pane 布局树、pane card、draft launcher。
- pane 拖拽、导航、provider launcher。

不覆盖：
- session 生命周期和 provider 配置。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Agent pane 区域 | Both | 展示会话卡片和 draft launcher。 |
| Pane 拖拽 | Desktop | 调整或重排 pane。 |
| Provider launcher | Both | 从 draft pane 选择 provider 启动会话。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| PANE-001 | Agent panes 主入口渲染 | Implemented | `packages/web/src/features/agent-panes/index.tsx` | `packages/web/src/features/agent-panes/index.test.tsx` |
| PANE-002 | pane layout tree | Implemented | `packages/web/src/features/agent-panes/pane-layout-tree.ts` | `packages/web/src/features/agent-panes/pane-layout-tree.test.ts` |
| PANE-003 | pane navigation | Implemented | `packages/web/src/features/agent-panes/pane-navigation.ts` | `packages/web/src/features/agent-panes/pane-navigation.test.ts` |
| PANE-004 | draft launcher | Implemented | `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx` | `packages/web/src/features/agent-panes/views/shared/draft-launcher.test.tsx` |
| PANE-005 | editor pane card | Implemented | `packages/web/src/features/agent-panes/views/shared/editor-pane-card.tsx` | `packages/web/src/features/agent-panes/views/shared/editor-pane-card.test.tsx` |
| PANE-006 | session card | Implemented | `packages/web/src/features/agent-panes/views/shared/session-card.tsx` | `packages/web/src/features/agent-panes/components/session-card.test.tsx` |
| PANE-007 | pane 拖拽控制 | Implemented | `packages/web/src/features/agent-panes/actions/use-pane-drag-controller.ts` | `packages/web/src/features/agent-panes/actions/use-pane-drag-controller.test.tsx` |
| PANE-008 | provider launcher hook | Implemented | `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts` | `packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx` |

## 4. 模块级验收线索

- 没有 session 时应能显示 draft launcher。
- 创建或关闭 session 后 pane 状态应更新。
- pane 拖拽不应丢失会话关联。

## 5. 未确认项

- 移动端是否支持同等 pane 拖拽能力需在移动端规格轮确认。
