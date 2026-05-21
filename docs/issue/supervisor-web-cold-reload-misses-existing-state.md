# 前端冷启动后无法展示已存在的 supervisor 状态

## 标题

`fix(web): 前端冷启动后应重新拿到已存在的 supervisor 状态`

## 问题描述

在 `coder-studio` 中，如果 server 仍在运行、session 也仍然有效，但用户只是刷新页面或前端重新连接，当前页面可能拿不到这个 session 已存在的 supervisor 状态。

现在 web 端不再在 `SessionCard` 挂载时调用 `supervisor.get` 主动补拉；与此同时，WS resync 只会回放 workspace/session 状态，不会回放 `supervisor.state`。这会导致前端冷启动后 `supervisorsAtom` 为空，即使后端内存里 supervisor 其实还在。

需要注意，这个问题不包含“server 重启后不恢复 supervisor runtime”的设计决策。这里讨论的是 server 没重启、只是前端冷启动/重连时的展示与编辑能力回归。

## 复现步骤

1. 打开一个仍然存活的 `full` session。
2. 为该 session 创建 supervisor，确认页面上已经显示 supervisor 卡片。
3. 保持 server 进程和该 session 存活。
4. 刷新页面，或让前端 websocket 断开后重新连接。
5. 在 supervisor 没有产生新的状态变更前，观察该 session 卡片区域。

## 预期行为

- 前端重新连接后，应该能恢复这个 session 当前已存在的 supervisor 状态。
- 用户应继续看到正确的 supervisor 卡片，并能进入详情或编辑，而不是误以为当前没有 supervisor。

## 实际行为

- 前端冷启动后 `supervisorsAtom` 可能为空。
- session 卡片会退回到 “Enable” 入口，像是当前没有 supervisor。
- 只有等后续再次收到新的 `supervisor.state` 推送后，界面才会恢复正确显示。

## 已确认事实

- web 端此前有 `supervisor.get` 挂载补拉逻辑，当前已移除。
- `WsHub.handleResync()` 当前只回放 workspace 与 session 状态，不回放 supervisor 状态。
- server 重启后不自动恢复 supervisor runtime 是当前有意设计，不是这条 issue 的范围。

## 当前判断

这是一个前端冷启动/重连场景下的状态补齐回归。

根因是两条保护同时被拿掉了：

- 前端不再调用 `supervisor.get` 补拉
- 后端 resync 也不发送 `supervisor.state`

只要 supervisor 是在当前页面初始化之前就已存在，且之后没有新的状态变更，前端就会一直缺失这份状态。

## 后续处理方向

- 二选一恢复状态补齐能力：
  - 恢复前端按需调用 `supervisor.get`
  - 或让 WS resync 同步回放当前 supervisor 状态
- 明确区分两类语义：
  - server 重启后不恢复 supervisor runtime
  - 前端冷启动时仍应展示 server 当前已存在的 supervisor 状态
