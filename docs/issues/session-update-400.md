# `session_update` 返回 400

## 状态

- 状态：已修复
- 首次记录：2026-03-19
- 修复时间：2026-03-19
- 优先级：中

## 现象

前端在调用 `POST /api/rpc/session_update` 时，曾偶发返回 `400 Bad Request`。

## 当前结论

这个 `400` 不是 Vite 代理缺失导致的。当前开发环境代理仍然存在：

- `vite.config.ts` 中 `/api` 仍代理到后端 HTTP 服务
- `vite.config.ts` 中 `/ws` 仍代理到后端 WebSocket 服务

HTTP 层会把后端 `Err(...)` 统一映射成 `400`，因此这个现象从一开始就更像是业务错误而不是代理错误。

## 接口用途

`session_update` 用于把前端 session 的增量状态同步到后端，包括但不限于：

- `status`
- `mode`
- `auto_feed`
- `last_active_at`
- `claude_session_id`

相关代码：

- `src/services/http/session.service.ts`
- `apps/web/src/App.tsx`
- `apps/server/src/command/http.rs`
- `apps/server/src/services/workspace.rs`

## 已知高概率原因

后端在 `session_update` 中会根据 `tab_id + session_id` 查找 session；旧实现查不到就返回 `session_not_found`，最终由 HTTP RPC 层转成 `400`。

高概率触发路径：

- 前端仍在给已经切换、归档或替换掉的 session 做补丁同步
- 前后端 session 状态暂时不同步
- 本地草稿 session 与后端实体 session 的切换时机存在竞态

## 暂不修复原因

## 修复结果

已采用第 `2` 条方案：

- 后端把 `session_update` 调整为幂等容错
- 当 session 已经被归档、替换或切换导致查找不到时，直接 no-op 并返回成功
- 这样不会再把正常竞态暴露成 `400`

## 后续优化

虽然 `400` 已修复，但仍建议继续优化：

1. 在前端进一步减少无效 session 的补丁调用
2. 继续收敛 draft session 物化、切换、归档链路上的状态边界
3. 保持 HTTP/WS 协议层的错误语义：真正的业务失败才返回错误，幂等同步走成功返回
