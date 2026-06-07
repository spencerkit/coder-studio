# Auth

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 登录页、认证状态检查和会话门禁。
- 服务端认证 session、密码失败阻断。

不覆盖：
- Provider 登录或第三方账号体系。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| `/login` | Both | 服务端启用密码保护时进入登录页。 |
| Session Gate | Both | 应用启动时根据认证状态决定是否放行业务页面。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| AUTH-001 | 认证状态检查 | Implemented | `packages/web/src/features/auth/session-gate.tsx`、`packages/server/src/auth` | `packages/web/src/features/auth/session-gate.test.tsx` |
| AUTH-002 | 密码登录页 | Implemented | `packages/web/src/features/auth/index.tsx` | `packages/web/src/features/auth/index.test.tsx` |
| AUTH-003 | 已认证会话放行 | Implemented | `packages/web/src/features/auth/session-gate.tsx` | `packages/web/src/features/auth/session-gate.test.tsx` |
| AUTH-004 | 登录失败与阻断状态 | Implemented | `packages/server/src/auth` | `packages/server/src/__tests__/auth-login-block-repo.test.ts` |
| AUTH-005 | auth session 持久化 | Internal | `packages/server/src/auth` | `packages/server/src/__tests__/auth-session-repo.test.ts` |

## 4. 模块级验收线索

- 未认证且服务端开启认证时，业务页面不可进入。
- 密码错误时登录页显示错误状态。
- 已认证 session 再次访问时应跳过登录页。

## 5. 未确认项

- 当前是否有显式退出登录入口，需在功能规格轮从页面入口核实。
