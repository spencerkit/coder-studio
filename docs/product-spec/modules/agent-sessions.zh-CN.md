# Agent Sessions

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- Agent session 创建、列表、停止、关闭、移除。
- 会话 prompt 提交、session metadata、session review 和 analysis。

不覆盖：
- pane 布局，写入 Agent Panes。
- provider 配置，写入 Providers。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Agent pane / draft launcher | Both | 选择 provider 并创建会话。 |
| Session card | Both | 停止、关闭、继续输入或查看状态。 |
| Agent terminal | Both | 通过 terminal 输入继续会话。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| SESSION-001 | 创建 Agent session | Implemented | `packages/server/src/commands/session.ts`、`session.create` | `packages/server/src/__tests__/session-commands.test.ts` |
| SESSION-002 | 拉取 session 列表 | Implemented | `session.list`、`packages/web/src/features/agent-panes/actions/use-workspace-sessions.ts` | `packages/server/src/__tests__/session-commands.test.ts` |
| SESSION-003 | 停止 session | Implemented | `packages/web/src/features/agent-panes/actions/use-session-actions.ts`、`session.stop` | `packages/web/src/features/agent-panes/actions/use-session-actions.test.tsx` |
| SESSION-004 | 关闭或移除 session | Implemented | `use-session-actions.ts`、`session.close`、`session.remove` | `packages/server/src/__tests__/session-remove.test.ts` |
| SESSION-005 | 向 session terminal 提交 prompt | Implemented | `use-session-actions.ts`、`wsClient.sendTerminalInput` | `packages/web/src/features/agent-panes/actions/use-session-actions.test.tsx` |
| SESSION-006 | session metadata 读取 | Implemented | `packages/server/src/commands/session-metadata.ts`、`session.metadata.get` | `packages/server/src/__tests__/session-metadata-command.test.ts` |
| SESSION-007 | 添加 session 验证记录 | Internal | `session.verification.add` | `packages/server/src/__tests__/session-metadata-command.test.ts` |
| SESSION-008 | session review summary/diff | Internal | `packages/server/src/commands/session-review.ts` | `packages/server/src/__tests__/session-review-command.test.ts` |
| SESSION-009 | session analysis get/run | Internal | `session.analysis.get`、`session.analysis.run` | `packages/server/src/__tests__/session-analysis-commands.test.ts` |
| SESSION-010 | 会话恢复和 hydration | Implemented | `packages/server/src/session` | `packages/server/src/__tests__/session-hydrate-restart.test.ts` |

## 4. 模块级验收线索

- 创建会话后列表中出现新 session，并能看到运行状态。
- 停止运行中的 session 后状态应结束或进入可移除状态。
- 关闭 session 不应破坏其他 workspace 的 session。

## 5. 功能点规格

### SESSION-001 创建 Agent session

状态：`Implemented`

用户行为：
- 用户从 draft launcher 选择 provider 启动 agent session。

系统响应：
- 前端先加载 `provider.runtimeStatus`。
- 如果 provider 可用，前端调用 `session.create`，传入 `workspaceId`、`providerId` 和当前 terminal theme background。
- 服务端校验 workspace 存在、provider 存在且 CLI 可用。
- 创建前服务端同步 workspace agent instructions。
- 创建成功后写入 session metadata，包括 provider、objective 和 baseline git head。

状态与边界：
- Loading：provider card 进入 loading。
- Success：调用 `onSessionCreated`，pane 中出现新 session。
- Error：workspace 不存在返回 `workspace_not_found`；provider 不存在返回 `unknown_provider`；CLI 不可用返回 `provider_cli_missing` 并带 missing commands。
- Install：provider 不可用且支持自动安装时，前端先启动安装并轮询 install job。

验收标准：
- Given 已打开 workspace 且 provider runtime 可用
- When 用户从 draft launcher 启动该 provider
- Then 服务端创建 session
- And 前端 pane 显示该 session
- And provider card 退出 loading 状态

代码索引：
- `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`
- `packages/server/src/commands/session.ts`

### SESSION-002 拉取 session 列表

状态：`Implemented`

用户行为：
- 用户进入 workspace 或切换 workspace。

系统响应：
- 前端按 workspace 读取会话列表。
- 服务端 `session.list` 返回该 workspace 下的 sessions。

状态与边界：
- Empty：workspace 没有 session 时，Agent pane 应显示 draft launcher。
- Success：返回的 session 用于渲染 session card 或 pane layout。
- Error：拉取失败时不应影响 workspace 其他区域可用性。

验收标准：
- Given workspace 中已有两个 session
- When 用户进入该 workspace
- Then Agent pane 能展示这两个 session
- And 不展示其他 workspace 的 session

代码索引：
- `packages/web/src/features/agent-panes/actions/use-workspace-sessions.ts`
- `packages/server/src/commands/session.ts`

### SESSION-003 停止 session

状态：`Implemented`

用户行为：
- 用户点击运行中 session 的停止入口。

系统响应：
- 前端调用 `session.stop`。
- 服务端调用 session manager 停止目标 session。
- 前端失败时在控制台记录错误；具体 UI 错误反馈需后续确认。

状态与边界：
- Success：session 进入结束流程。
- Error：停止失败时不移除 session。

验收标准：
- Given 一个运行中的 session
- When 用户触发停止
- Then 前端发送 `session.stop`
- And session 不应被立即从列表中无条件删除

代码索引：
- `packages/web/src/features/agent-panes/actions/use-session-actions.ts`
- `packages/server/src/commands/session.ts`

### SESSION-004 关闭或移除 session

状态：`Implemented`

用户行为：
- 用户关闭 session pane，或移除已结束 session。

系统响应：
- 如果 disposition 是 `remove`，前端直接调用 `session.close`。
- 如果 session 已结束，前端调用 `session.remove`。
- 如果 session 未结束，前端先调用 `session.stop`，轮询等待 ended，再调用 `session.remove`。
- 服务端 `session.close` 会等待 session 结束，并按 pane disposition 更新 workspace pane layout。

状态与边界：
- Success：session 从 manager 和 metadata 中删除。
- Timeout：前端最多等待 5 秒；服务端 close 也有 5 秒等待窗口。
- Error：非 ended session 调用 `session.remove` 返回 `invalid_state`。

验收标准：
- Given 一个已结束 session
- When 用户关闭该 session
- Then 前端发送 `session.remove`
- And session 从列表中移除

- Given 一个运行中 session
- When 用户关闭该 session
- Then 系统先停止 session
- And 只有 session 结束后才移除

代码索引：
- `packages/web/src/features/agent-panes/actions/use-session-actions.ts`
- `packages/server/src/commands/session.ts`

### SESSION-005 向 session terminal 提交 prompt

状态：`Implemented`

用户行为：
- 用户在 session 输入区提交 prompt。

系统响应：
- 前端 trim prompt。
- prompt 为空或 WebSocket client 不存在时直接返回 false。
- 有效 prompt 通过 `sendTerminalInput` 发送到 session terminal，activity 为 `submit`，submittedText 为原 prompt。

状态与边界：
- Success：返回 true。
- Error：发送异常时记录 console error 并返回 false。
- Empty：空 prompt 不发送。

验收标准：
- Given session terminal 可用
- When 用户提交非空 prompt
- Then 前端向 terminal 发送以回车结尾的输入
- And activity 标记为 `submit`

代码索引：
- `packages/web/src/features/agent-panes/actions/use-session-actions.ts`

## 6. 未确认项

- session review 和 analysis 的稳定用户入口需在 Work Analysis 或 Agent Context 规格轮确认。
