# Terminal

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- Shell terminal 创建、列表、输入、关闭、resize、snapshot、replay。
- Agent terminal 输出承载。
- 恢复协调、hydration、移动端软键和长按复制。
- 终端粘贴/拖拽上传。

不覆盖：
- Agent session 生命周期本身。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| 底部 Terminal Panel | Desktop | 创建、切换、关闭 shell terminal。 |
| Mobile Terminal Sheet | Mobile | 移动端终端输入和软键。 |
| Agent session terminal | Both | 显示 agent 运行输出并接收输入。 |
| 粘贴/拖拽文件 | Desktop | 上传文件并插入终端命令。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| TERM-001 | terminal 列表 | Implemented | `terminal.list`、`use-terminal-actions.ts` | `packages/server/src/__tests__/terminal-commands.test.ts` |
| TERM-002 | 创建 shell terminal | Implemented | `terminal.create`、`use-create-shell-terminal.ts` | `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.test.tsx` |
| TERM-003 | terminal 输入 | Implemented | `terminal.input`、`wsClient.sendTerminalInput` | `packages/server/src/__tests__/terminal-commands.test.ts` |
| TERM-004 | terminal resize | Implemented | `terminal.resize`、`xterm-host.tsx` | `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx` |
| TERM-005 | terminal close | Implemented | `terminal.close`、`use-terminal-actions.ts` | `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx` |
| TERM-006 | snapshot / replay | Implemented | `terminal.snapshot`、`terminal.replay`、`replay-state.ts` | `packages/server/src/__tests__/terminal-ring-buffer-tail.test.ts` |
| TERM-007 | hydration 和 recovery coordinator | Implemented | `hydration-coordinator.ts`、`recovery-coordinator.ts` | `hydration-coordinator.test.ts`、`recovery-coordinator.test.ts` |
| TERM-008 | terminal theme background sync | Implemented | `terminal.syncThemeBackground` | 手工验收：主题切换后终端背景 |
| TERM-009 | 移动端软键 | Implemented | `mobile/virtual-terminal-keys.ts`、`mobile-terminal-input-bar.tsx` | `virtual-terminal-keys.test.ts`、`mobile-terminal-input-bar.test.tsx` |
| TERM-010 | 移动端长按复制行 | Implemented | `mobile/long-press-copy-line.ts` | `mobile/long-press-copy-line.test.ts` |
| TERM-011 | 粘贴/拖拽上传 | Implemented | `uploads/use-paste-drop-upload.ts`、`uploads/upload-files.ts` | `use-paste-drop-upload.test.tsx`、`upload-files.test.ts` |
| TERM-012 | shell quote 上传路径 | Implemented | `uploads/quote-shell.ts` | `quote-shell.test.ts` |

## 4. 模块级验收线索

- 新建 terminal 后应出现在 tab 列表并自动激活。
- 输入命令后终端应显示输出。
- 刷新或重连后应能 replay 终端快照。
- 移动端软键应能发送常用控制输入。

## 5. 功能点规格

### TERM-001 terminal 列表

状态：`Implemented`

用户行为：
- 用户进入已打开的 workspace，并查看 terminal panel。

系统响应：
- 前端调用 `terminal.list`。
- 服务端返回所有属于该 workspace 的 terminal DTO。
- 前端只把 kind 为 `shell` 的 terminal 加入 shell terminal tab 列表。

状态与边界：
- Loading：切换 workspace 时先清空当前 terminal ids 和 active terminal。
- Success：恢复 shell terminal metadata，并默认激活第一个 shell terminal。
- Error：拉取失败时显示 error toast。

验收标准：
- Given workspace 中存在两个 shell terminal 和一个 agent terminal
- When terminal panel 拉取列表
- Then shell terminal tab 只显示两个 shell terminal
- And agent terminal 不出现在 shell tab 列表中

代码索引：
- `packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts`
- `packages/server/src/commands/terminal.ts`

### TERM-002 创建 shell terminal

状态：`Implemented`

用户行为：
- 用户点击新建 terminal。

系统响应：
- 前端调用 `terminal.create`。
- 服务端校验 workspace 存在。
- 如果传入 `cwdPath`，必须是 workspace-relative，且必须存在并是目录。
- 服务端根据平台选择 shell：Windows 使用 `ComSpec`/`COMSPEC`/`cmd.exe`，其他平台使用 `SHELL` 或 `/bin/bash -i`。
- 创建成功后通过 terminal created 事件加入 tab 并激活。

状态与边界：
- Success：新 terminal kind 为 `shell`，cwd 默认为 workspace path。
- Error：workspace 不存在返回 `workspace_not_found`；cwd 越界或绝对路径返回 `invalid_cwd_path`；目录不存在或不是目录返回对应错误。

验收标准：
- Given 已打开 workspace
- When 用户创建 shell terminal
- Then terminal 列表新增一个 shell terminal
- And 新 terminal 成为 active terminal

代码索引：
- `packages/web/src/features/terminal-panel/actions/use-create-shell-terminal.ts`
- `packages/server/src/commands/terminal.ts`

### TERM-003 terminal 输入

状态：`Implemented`

用户行为：
- 用户在 shell terminal 或 agent terminal 中输入内容。

系统响应：
- `terminal.input` 支持 base64 bytes 和 binary transport。
- 如果 terminal 关联 session，输入转发到 session manager。
- 如果不是 session terminal，输入写入 terminal manager。

状态与边界：
- Success：输入写入目标 terminal/session。
- Error：binary transport 缺少 payload 时返回 `terminal_input_binary_missing`。

验收标准：
- Given 一个 shell terminal
- When 用户输入命令并回车
- Then 服务端把输入写入 terminal manager

- Given 一个 agent session terminal
- When 用户提交 prompt
- Then 服务端把输入转发到 session manager

代码索引：
- `packages/server/src/commands/terminal.ts`
- `packages/web/src/ws/client.ts`

### TERM-004 terminal resize

状态：`Implemented`

用户行为：
- 用户调整 terminal 面板尺寸或浏览器窗口尺寸变化。

系统响应：
- 前端发送 `terminal.resize`，包含正整数 cols 和 rows。
- 服务端如果 terminal 属于 session，则 resize session；否则 resize shell terminal。

状态与边界：
- Success：目标 PTY/session 接收新尺寸。
- Validation：cols 和 rows 必须是正整数。

验收标准：
- Given 一个 active shell terminal
- When terminal host 计算出新的 cols/rows
- Then 前端发送 `terminal.resize`
- And 服务端 resize 对应 terminal

代码索引：
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- `packages/server/src/commands/terminal.ts`

### TERM-006 snapshot / replay

状态：`Implemented`

用户行为：
- 用户刷新页面、重连或重新打开 terminal。

系统响应：
- 前端请求 `terminal.snapshot` 或 `terminal.replay`。
- 服务端通过 binary frame 返回 snapshot/replay payload。
- 返回结果包含 `transport: "binary"`、`streamId`、`size` 和 seq。

状态与边界：
- Success：前端用 binary payload 恢复 terminal 内容。
- Not ok：terminal manager 返回非 ok status 时，命令直接返回该 status，不发送 binary frame。

验收标准：
- Given terminal 已产生输出
- When 前端请求 replay
- Then 服务端返回 binary transport metadata
- And 对应 client 收到 replay binary frame

代码索引：
- `packages/server/src/commands/terminal.ts`
- `packages/web/src/features/terminal-panel/replay-state.ts`

### TERM-011 粘贴/拖拽上传

状态：`Implemented`

用户行为：
- 用户把文件粘贴或拖拽到 terminal 区域。

系统响应：
- 前端上传文件，并生成可粘贴进 shell 的 quoted path。
- 上传后的命令片段插入 terminal 输入路径。

状态与边界：
- Success：上传完成后生成 shell-safe 路径。
- Error：上传失败时应显示或保留错误反馈。

验收标准：
- Given terminal panel active
- When 用户拖入一个文件
- Then 文件上传流程启动
- And 生成的路径经过 shell quote

代码索引：
- `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.ts`
- `packages/web/src/features/terminal-panel/uploads/upload-files.ts`
- `packages/web/src/features/terminal-panel/uploads/quote-shell.ts`

## 6. 未确认项

- 上传文件的 server 端路径和清理策略需在第二轮结合 `packages/server/src/uploads` 确认。
