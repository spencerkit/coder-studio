# Coder Studio

[English](README.en.md) | [中文](README.md)

Coder Studio 是一个本地优先的桌面工作台，用于把仓库接入、Claude Agent 运行、代码浏览与编辑、Git 操作、内置终端放到同一个界面中。

## 项目是什么

这个项目当前的产品形态不是“通用 AI 平台”，而是一个围绕真实 Git 仓库工作的桌面端工作台。

它解决的核心问题是：

- 用一个工作区连接本地仓库或远程仓库
- 在同一界面里启动和并行拆分 Agent 任务
- 一边看 Agent 输出，一边检查文件、Diff、Git 状态和终端命令
- 用更少的上下文切换完成“提任务 → 跑 Agent → 看改动 → 提交代码”的闭环

## 当前核心功能

- 工作区接入：支持 `Remote Git` 和 `Local Folder`
- 执行目标：支持 `Native`，在环境允许时支持 `WSL`
- Agent 会话：通过分屏 Pane 并行运行多个任务
- 任务启动：Agent 未启动前显示草稿输入框，首条输入用于生成 session 名称
- Agent 交互：启动后切换为 PTY 终端式交互
- 代码面板：文件树、文件搜索、Monaco 预览/编辑、文件保存
- Git 面板：查看改动、Stage/Unstage/Discard、Commit
- 终端面板：多终端创建、切换、关闭
- 快速操作：`Cmd/Ctrl + K` 打开命令面板
- 设置：Launch Command、Idle Policy、语言切换
- 国际化：中文 / English
- Public Mode：单口令鉴权、会话 Cookie、IP 封禁、`allowedRoots` 目录白名单

## 安装前提

在本地运行前，请先准备：

- `Node.js`
- `pnpm`
- `Rust` toolchain
- `Tauri 2` 对应平台的系统依赖
- `Git`

如果你需要真正启动 Agent，还需要：

- 一个可执行的 Agent 命令，默认是 `claude`
- 如果使用 `WSL`，目标环境中也需要能执行对应命令

## 安装

```bash
pnpm install
```

## npm CLI 安装

发布后可以直接安装：

```bash
npm install -g @spencer-kit/coder-studio
```

安装后可用命令：

```bash
coder-studio start
coder-studio stop
coder-studio restart
coder-studio status
coder-studio logs -f
coder-studio open
coder-studio doctor
```

## 运行

### 方式 1：桌面开发模式（推荐）

```bash
pnpm tauri dev
```

这是最接近真实产品形态的运行方式。

### 方式 2：前后端分离调试

终端 1：

```bash
pnpm dev
```

终端 2：

```bash
pnpm dev:backend
```

当前开发端口：

- 前端：`http://127.0.0.1:5174`
- 后端传输服务：`http://127.0.0.1:41033`

前端开发服务器会把 `/api`、`/ws`、`/health` 代理到本地后端。

## 构建

前端构建：

```bash
pnpm build
```

打包桌面应用：

```bash
pnpm tauri build
```

## 公开部署

如果要把这个项目部署到公网可访问设备上，当前版本已经提供：

- 单口令登录
- `HttpOnly` session cookie
- 同一 IP `10` 分钟内 `3` 次口令错误后封禁 `24` 小时
- 基于 `allowedRoots` 的服务端目录白名单
- 对外访问时要求通过 HTTPS 反向代理提交口令

部署细节请看：

- 中文部署文档：`docs/deployment/README.md`
- English Deployment Guide: `docs/deployment/README.en.md`

## 用户如何上手

1. 启动应用。
2. 在启动浮层中选择 `Remote Git` 或 `Local Folder`。
3. 选择运行目标：`Native` 或 `WSL`。
4. 打开工作区后，在 Agent Pane 的输入框里输入第一条任务。
5. 回车后，应用会创建 session、启动 Agent，并把首条输入作为 session 标题。
6. 如需并行处理任务，使用 Pane 分屏按钮新增一个草稿任务区。
7. 打开右侧代码面板查看文件、编辑内容或检查 Diff。
8. 打开 Git 面板做 Stage / Unstage / Discard / Commit。
9. 打开终端面板执行仓库命令。

## 常用快捷操作

- `Cmd/Ctrl + K`：打开快速操作面板
- `Cmd/Ctrl + N`：新建工作区
- `Cmd/Ctrl + Shift + [`：切换到上一个工作区
- `Cmd/Ctrl + Shift + ]`：切换到下一个工作区
- `Cmd/Ctrl + S`：保存当前文件
- `F`：切换 Focus Mode
- `Alt/⌘ + D`：纵向分屏当前 Agent Pane
- `Shift + Alt/⌘ + D`：横向分屏当前 Agent Pane

## 当前边界

以下内容不应视为当前版本已经完整交付：

- 多 Agent Provider 支持
- 浅色主题
- 完整可见的任务队列 UI
- 完整可见的 Archive 中心
- 明确的 Worktree 管理入口
- 完整闭环的自动挂起能力

## 文档导航

用户文档：

- 中文 PRD：`docs/PRD.md`
- English PRD: `docs/PRD.en.md`

开发文档：

- 开发文档入口：`docs/development/README.md`
- 部署文档：`docs/deployment/README.md`
- npm 发布与 CLI：`docs/development/npm-release.md`
- Development Docs: `docs/development/README.en.md`
- Deployment Guide: `docs/deployment/README.en.md`
- npm Packaging and Release: `docs/development/npm-release.en.md`
- 架构说明：`docs/development/architecture.md`
- Frontend 状态：`docs/development/frontend-state.md`
- Tauri 命令清单：`docs/development/tauri-commands.md`
