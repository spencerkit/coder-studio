# Notifications

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- Toast container。
- 会话完成通知。
- 浏览器焦点相关通知抑制。
- 通知文案格式化。

不覆盖：
- 操作系统级通知权限设置。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Toast 区域 | Both | 显示错误、成功或状态通知。 |
| Session completion | Both | Agent session 完成时触发通知。 |
| 浏览器焦点变化 | Both | 根据焦点决定通知策略。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| NOTIFY-001 | Toast container | Implemented | `packages/web/src/features/notifications/toast-container.tsx` | `toast-container.test.tsx` |
| NOTIFY-002 | Toast state atoms | Implemented | `packages/web/src/features/notifications/atoms.ts` | Toast 组件测试 |
| NOTIFY-003 | session notifications hook | Implemented | `use-session-notifications.ts` | `use-session-notifications.test.tsx` |
| NOTIFY-004 | 焦点 session 判断 | Implemented | `focus-session.ts` | `focus-session.test.ts` |
| NOTIFY-005 | 通知格式化 | Implemented | `format.ts` | `format.test.ts` |
| NOTIFY-006 | UI toast primitive | Implemented | `packages/web/src/components/ui/toast` | `components/ui/toast/index.test.tsx` |

## 4. 模块级验收线索

- 操作失败时应显示 error toast。
- 会话完成且页面不在焦点时应触发通知提示。
- Toast 应可关闭且不阻断主要操作。

## 5. 未确认项

- 浏览器原生 notification 权限流程需在第二轮确认。
