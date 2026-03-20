# 开发文档

[English](README.en.md)

本目录记录当前实现对应的开发文档，目标是帮助开发者快速理解这个项目现在怎么工作，而不是描述未来规划。

## 阅读顺序

建议按下面顺序阅读：

1. `architecture.md`：先看整体分层、运行时结构和关键数据流
2. `frontend-state.md`：再看前端核心状态模型和界面状态流转
3. `tauri-commands.md`：最后看 Tauri 命令、传输层和事件通道

## 本地开发

安装依赖：

```bash
pnpm install
```

Tauri 壳层开发模式：

```bash
pnpm tauri dev
```

分离式调试：

```bash
pnpm dev:frontend
pnpm dev:server
```

联动调试与开发态 E2E：

```bash
pnpm dev:stack
```

当前开发端口：

- 前端：`127.0.0.1:5174`
- 本地 server 传输服务：`127.0.0.1:41033`

## 关键代码位置

- 前端主视图：`apps/web/src/App.tsx`
- 前端全局状态：`apps/web/src/state/workbench.ts`
- 前端类型：`apps/web/src/types/app.ts`
- HTTP RPC 调用封装：`apps/web/src/services/http/`
- WebSocket 事件层：`apps/web/src/ws/`
- server 入口：`apps/server/src/main.rs`
- server HTTP 传输层：`apps/server/src/command/http.rs`
- Rust 服务实现：`apps/server/src/services/`
- CLI TypeScript 源码：`packages/cli/src/`

## 文档列表

- 架构说明：`docs/development/architecture.md`
- Frontend 状态：`docs/development/frontend-state.md`
- Tauri 命令清单：`docs/development/tauri-commands.md`
- CLI 命令手册：`docs/development/cli.md`
- npm 发布与 CLI：`docs/development/npm-release.md`

英文版：

- `docs/development/README.en.md`
- `docs/development/architecture.en.md`
- `docs/development/frontend-state.en.md`
- `docs/development/tauri-commands.en.md`
- `docs/development/cli.en.md`
- `docs/development/npm-release.en.md`

## 关联文档

- 用户说明：`README.md`
- English README: `README.en.md`
- 部署文档：`docs/deployment/README.md`
- English Deployment Guide: `docs/deployment/README.en.md`
- 中文 PRD：`docs/PRD.md`
- English PRD: `docs/PRD.en.md`

## 文档维护原则

- 只写当前代码已经支持的能力
- 明确区分“底层命令存在”和“用户界面已完整开放”
- 用户使用说明放在 `README`，开发细节放在本目录
- 文档中的术语优先与代码保持一致：`workspace`、`session`、`pane`、`terminal`、`archive`、`worktree`
