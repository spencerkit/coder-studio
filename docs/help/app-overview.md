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

你可以同时打开多个工作区，通过顶栏的工作区标签切换。

### Session（会话）

会话是你在某个 Provider 下的一次 Agent 运行。每个会话：

- 对应一个 AI 编码 Agent（Claude 或 Codex）
- 拥有独立的终端输出
- 可以独立启动、停止和恢复

一个工作区内可以有多个活跃会话。

### Provider

Provider 是 AI Agent 的运行环境。当前支持两种：

- **Claude**：Anthropic 的 Claude Code CLI
- **Codex**：OpenAI 的 Codex CLI

Provider 需要在本地独立安装。Coder Studio 会在启动会话时调用相应的 Provider CLI。

### Terminal（终端）

每个工作区内有两种终端：

- **Shell 终端**：你自己手动创建的终端，用于执行命令
- **Agent 终端**：每个 Agent 会话对应的终端，用于查看 Agent 的执行输出

### Skills（技能）

技能是分发给 Agent 的本地说明文件，用来教 Agent 在特定场景下如何行动。Coder Studio 会内置一组第一方技能，并在服务启动时同步到支持技能挂载的 Provider。

内置技能的 MVP 重点是：

- 让 Agent 通过 `coder-studio identify --json` 识别当前 workspace、session 和 provider
- 让 Agent 通过 `coder-studio capabilities --json` 发现可用自动化命令
- 在任务结束前提醒 Agent 检查 Git 变更、测试结果和残余风险

### Settings（设置）

设置页面提供以下配置：

- **General**：通知开关、语言设置
- **Providers**：查看和配置每个 Provider 的启动参数
- **Appearance**：主题切换、终端渲染方式
- **Shortcuts**：查看和自定义快捷键

## 桌面端 vs 移动端

Coder Studio 使用响应式界面，同一服务同时支持：

- **桌面端**：多面板布局、快捷键、专注模式（[桌面端使用指南](desktop-guide.md)）
- **移动端**：底部 Dock 导航、全屏面板（[移动端使用指南](mobile-guide.md)）

## 适合的使用场景

- 想让 AI Agent 在本地项目里工作，同时你能实时看到它的操作
- 想在同一个界面里查看代码、Git 变更和终端输出
- 需要同时管理多个 Agent 会话
- 想让 Agent 自动识别 Coder Studio 运行上下文并选择可用 CLI 自动化能力
- 想在手机上也方便地监控 Agent 进度

## 常见问题

**Q：一个工作区可以有多个会话吗？**
可以。你可以在同一工作区内同时运行 Claude 和 Codex 会话。

**Q：可以打开多个项目吗？**
可以。通过顶栏的工作区标签切换，每个工作区独立管理自己的会话、文件和终端。
