# App 功能总览

这篇文档介绍 Coder Studio 的核心概念和整体能力，帮助你建立对产品的基本理解。

## 这篇文档解决什么问题

快速了解 Coder Studio 的核心概念、主要功能和使用场景。

## Coder Studio 是什么

Coder Studio 是一款**本地优先**的 AI 编码工作台。它将 AI Agent、代码编辑器、Git 版本控制和终端整合到一个统一的 Web 界面中，你可以在本机启动服务后通过浏览器访问。

## 核心概念

### Workspace（工作区）

工作区是你打开的项目目录。每个工作区包含：

- 该目录下的文件树
- 独立的 Agent 会话列表
- 独立的终端会话
- Git 状态信息

你可以同时打开多个工作区。桌面端通过顶栏标签切换，移动端通过工作区抽屉切换。

### Session（会话）

会话是你在某个 Provider 下的一次 Agent 运行。每个会话：

- 对应一个 AI 编码 Agent Provider
- 拥有独立的终端输出
- 可以独立启动、停止和恢复

一个工作区内可以有多个活跃会话。

### Provider

Provider 是 AI Agent 的运行环境。当前内置支持：

- **Claude Code**：Anthropic 的 Claude Code CLI
- **Codex**：OpenAI 的 Codex CLI
- **Gemini CLI**：Google 的 Gemini CLI
- **Cursor Agent**：Cursor 的 agent CLI
- **OpenCode**：OpenCode CLI

Provider 需要在本地独立安装。Coder Studio 会在启动会话时调用相应的 Provider CLI。

### Terminal（终端）

每个工作区内有两种终端：

- **Shell 终端**：你自己手动创建的终端，用于执行命令
- **Agent 终端**：每个 Agent 会话对应的终端，用于查看 Agent 的执行输出

### Skills（技能）

技能是分发给 Agent 的本地说明文件，用来教 Agent 在特定场景下如何行动。Coder Studio 支持安装、管理和挂载技能，也保留内置技能同步机制；当前默认不预装第一方内置技能。

与技能和 Agent 自动化相关的基础 CLI 能力包括：

- 让 Agent 通过 `coder-studio identify --json` 识别当前 workspace、session 和 provider
- 让 Agent 通过 `coder-studio capabilities --json` 查看可用的只读验证命令清单
- 让 Agent 读取终端输出、Git 状态和指定文件 diff，辅助最终检查

### More（更多）

桌面端和移动端都通过顶栏的 **More / 更多** 按钮进入统一的 `/more` 页面。当前没有顶级 `/settings` 路由。`/more` 当前分为三组内容：

- **Settings**：`General`、`Providers`、`Terminal`、`Appearance`、`Shortcuts`
- **Analysis**：`Work Analysis`、`Monitoring`、`Diagnostics`
- **About**：`Product`、`Update Status`、`Auto Update`

## 桌面端 vs 移动端

Coder Studio 使用响应式界面，同一服务同时支持：

- **桌面端**：多面板布局、快捷键、专注模式和顶栏快速操作（[桌面端使用指南](desktop-guide.md)）
- **移动端**：顶部栏、当前会话主区、Sheet/Drawer 和底部状态栏（[移动端使用指南](mobile-guide.md)）

## 适合的使用场景

- 想让 AI Agent 在本地项目里工作，同时你能实时看到它的操作
- 想在同一个界面里查看代码、Git 变更和终端输出
- 需要同时管理多个 Agent 会话
- 想让 Agent 自动识别 Coder Studio 运行上下文并选择可用 CLI 自动化能力
- 想在手机上也方便地监控 Agent 进度

## 常见问题

**Q：一个工作区可以有多个会话吗？**
可以。你可以在同一工作区内同时运行多个 Provider 会话。

**Q：可以打开多个项目吗？**
可以。桌面端通过顶栏标签切换，移动端通过工作区抽屉切换；每个工作区独立管理自己的会话、文件和终端。
