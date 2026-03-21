# 架构说明

[English](architecture.en.md)

本文档描述当前实现的整体架构、模块职责，以及几个最重要的数据流。

## 1. 总体结构

当前项目由 React + Vite 前端和 Rust server 运行时组成；server 运行时直接暴露本地 HTTP / WS 服务。

逻辑分层可以概括为：

```text
React UI (apps/web/src/App.tsx)
    |
    |-- HTTP RPC (/api/rpc/:command)
    |-- WebSocket 事件订阅 (/ws)
    v
Rust Server Runtime
    |
    |-- workspace/session 服务
    |-- git / filesystem 服务
    |-- terminal / agent PTY 服务
    |-- Claude hook 接收器
    v
本地运行时
    |
    |-- git
    |-- shell / PTY
    |-- claude
    |-- wsl.exe（可选）
    v
本地持久化
    |
    |-- Local Storage
    |-- SQLite
```

## 2. 前端职责

前端当前主要由单页主视图驱动：

- `apps/web/src/App.tsx`：绝大多数界面、交互和状态协调逻辑
- `apps/web/src/state/workbench.ts`：工作区、会话、Pane、终端、文件预览等核心状态模型
- `apps/web/src/types/app.ts`：前后端交互载荷类型
- `apps/web/src/services/http/`：RPC 调用封装
- `apps/web/src/ws/`：WebSocket 连接与事件订阅

前端负责：

- 渲染工作区与各类面板
- 管理草稿 session 到正式 session 的切换
- 维护 Pane 树和布局比例
- 消费 Agent / Terminal / Claude lifecycle 事件
- 协调代码预览、Git 操作、终端操作和设置页状态

## 3. 服务端职责

服务端入口在：`apps/server/src/main.rs`

具体服务按职责拆分在：

- `apps/server/src/services/workspace.rs`
- `apps/server/src/services/git.rs`
- `apps/server/src/services/filesystem.rs`
- `apps/server/src/services/terminal.rs`
- `apps/server/src/services/agent.rs`

服务端负责：

- 仓库初始化与工作区解析
- session 元数据维护
- Git 命令执行
- 文件树与文件内容读取/保存
- shell terminal 与 agent PTY 生命周期管理
- Claude hook 接收与事件广播
- 本地数据库持久化

## 4. 传输层设计

当前实现的命令调用统一走 HTTP RPC：

- HTTP RPC：前端调用 `/api/rpc/:command`

这一层的好处是：

- 前后端协议单一，运行时更轻
- 分离调试时可以直接连接本地 HTTP/WS server
- WebSocket 可以统一承载 Agent 与 Terminal 的流式事件

对应代码：

- 前端：`apps/web/src/services/http/client.ts`
- 服务端：`apps/server/src/command/http.rs`
- WebSocket：`apps/web/src/ws/connection-manager.ts`、`apps/server/src/ws/server.rs`

## 5. 核心数据流

### 5.1 工作区启动

1. 前端展示 onboarding overlay。
2. 用户选择 `Remote Git` 或 `Local Folder`。
3. 前端调用 `init_workspace`。
4. 后端在目标环境中 clone 仓库或解析本地 Git 根目录。
5. 前端随后刷新 Git、文件树、worktree 等工作区信息。

### 5.2 草稿任务到 Agent 启动

1. 一个新 Pane 初始对应 draft session。
2. 用户在草稿输入框输入首条任务。
3. 前端先把 draft session 物化成后端 session。
4. 然后调用 `agent_start`。
5. 后端创建 PTY，启动实际 agent 命令。
6. Agent 输出通过事件流推回前端。
7. Pane 从草稿输入框切换为终端流视图。

### 5.3 Agent 事件流

Agent 相关有两类事件：

- `agent://event`：普通流式输出与系统事件
- `agent://lifecycle`：Claude lifecycle 归一化事件

普通事件用于：

- 更新 pane 终端输出
- 更新 unread
- 更新 toast
- 处理退出状态

lifecycle 事件用于：

- 更新 session 状态
- 记录 Claude session ID
- 识别等待输入、工具执行、审批等阶段

### 5.4 代码与 Git 刷新

代码与 Git 面板依赖一组并行刷新调用：

- `git_status`
- `git_changes`
- `worktree_list`
- `workspace_tree`

当用户执行 Stage、Unstage、Discard、Commit 或 Save 后，前端会再次刷新工作区产物，以保持右侧代码/Git 面板同步。

### 5.5 终端流

1. 前端调用 `terminal_create`。
2. 后端创建 PTY 并启动 shell。
3. 输出通过 `terminal://event` 持续推送。
4. 用户输入通过 `terminal_write` 写回 PTY。
5. 面板尺寸变化时通过 `terminal_resize` 同步。

### 5.6 Claude Hook 回路

当前应用在启动时会开启一个本地 hook 接收器。

流程是：

1. 后端启动本地 HTTP hook endpoint。
2. `agent_start` 在 Claude 模式下写入环境变量和 `.claude/settings.local.json`。
3. Claude 执行 hook 命令。
4. hook helper 把事件回传到本地 endpoint。
5. 应用把原始 hook event 归一化并广播为 `agent://lifecycle`。

## 6. 持久化

当前有两层持久化：

- 前端 Local Storage
- 后端 SQLite

前端保存：

- 工作区布局
- session/pane 结构快照
- 全局设置
- 语言设置

后端保存：

- session 快照
- archive 快照

数据库初始化和持久化逻辑位于：

- `apps/server/src/main.rs`
- `apps/server/src/infra/db.rs`

## 7. 开发模式与生产模式差异

开发模式下：

- Vite 前端运行在 `5174`
- Rust 传输服务运行在 `41033`
- 前端通过代理访问 `/api`、`/ws`、`/health`

生产模式下：

- Rust 传输服务会同时提供前端静态资源和 API/WS
- 也就是说，静态页面与传输接口由同一进程统一托管

## 8. 当前架构约束

- 当前 UI 主逻辑高度集中在 `apps/web/src/App.tsx`
- session、queue、archive、worktree 的底层能力与 UI 暴露程度还不完全对齐
- `branch` / `git_tree` 等模型能力仍有一部分停留在数据层，不是完整产品流
- 前端长期依赖“刷新工作区产物”来同步 Git 和文件状态，局部增量更新还不多
