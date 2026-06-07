# App Shell

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 应用级 providers、WebSocket 生命周期和全局连接态。
- 桌面/移动 shell 选择。
- 全局连接横幅、激活租约和非活动标签页保护。

不覆盖：
- 具体业务页面能力，分别写入对应模块。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| 应用启动 | Both | 初始化 providers、认证门禁、WebSocket 连接和工作区数据。 |
| 桌面 shell | Desktop | 宽屏环境加载桌面壳层。 |
| 移动 shell | Mobile | 移动视口加载移动壳层。 |
| 连接状态横幅 | Both | 连接断开、重连或标签页被拒绝时显示状态。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| APP-001 | 应用 providers 初始化 | Implemented | `packages/web/src/app/providers.tsx` | `packages/web/src/app/providers.test.tsx` |
| APP-002 | WebSocket 连接和重连 | Implemented | `packages/web/src/ws/client.ts`、`packages/web/src/ws/reconnect.ts` | `packages/web/src/ws/__tests__/client.test.ts`、`packages/web/src/ws/subscription.test.ts` |
| APP-003 | 桌面壳层渲染 | Implemented | `packages/web/src/shells/desktop-shell.tsx` | `packages/web/src/shells/desktop-shell.test.tsx` |
| APP-004 | 移动壳层渲染 | Implemented | `packages/web/src/shells/mobile-shell/index.tsx` | `packages/web/src/shells/mobile-shell/index.test.tsx` |
| APP-005 | 全局连接状态横幅 | Implemented | `packages/web/src/shells/shared/connection-status-banner.tsx` | `packages/web/src/shells/shared/connection-status-banner.test.tsx` |
| APP-006 | 活跃标签页租约保护 | Implemented | `packages/server/src/commands/activation.ts`、`packages/server/src/ws/dispatch.ts` | `packages/server/src/__tests__/activation-commands.test.ts`、`packages/server/src/__tests__/dispatch.test.ts` |
| APP-007 | 连接探测命令 | Implemented | `packages/server/src/commands/connection.ts` | `connection.probe` 手工命令验收 |
| APP-008 | 服务端恢复协调 | Internal | `packages/server/src/commands/recovery.ts` | `packages/server/src/__tests__/session-hydrate-restart.test.ts`、`packages/server/src/__tests__/workspace-watcher-hydrate-restart.test.ts` |

## 4. 模块级验收线索

- 启动应用后能建立 WebSocket 连接，并在断开后进入重连状态。
- 非活动标签页调用非 allowlist command 时返回 `activation_required`。
- 桌面与移动视口能加载不同 shell。

## 5. 未确认项

- APP-008 是否需要暴露为产品级恢复功能，需在流程规格轮结合用户入口确认。
