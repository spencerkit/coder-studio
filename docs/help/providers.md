# Provider 配置指南

这篇文档介绍如何为 Coder Studio 安装和配置 Provider。

## 这篇文档解决什么问题

如何安装常用 coding agent CLI，以便在 Coder Studio 中创建 Agent 会话。

## 前置条件

- 已安装 Coder Studio（`npm install -g @spencer-kit/coder-studio`）
- 已安装 Node.js >= 24.0.0

## 当前支持哪些 Provider

Coder Studio 当前内置支持：

- **Claude Code**：`claude`，Full，Stable
- **Codex**：`codex`，Full，Stable
- **Gemini CLI**：`gemini`，Full，Stable
- **Cursor Agent**：`agent`，Full，Stable
- **OpenCode**：`opencode`，Limited，Experimental

这些 Provider 都需要在本地独立安装。Full 表示支持交互式会话、idle detection，以及 supervisor/session analysis 这类自动化工作流。Limited 表示可以运行交互式会话，但并非所有自动化能力都已接入。

## 安装 Claude CLI

```bash
npm install -g @anthropic-ai/claude-code
```

安装后确认：

```bash
claude --version
```

## 安装 Codex CLI

```bash
npm install -g @openai/codex
```

安装后确认：

```bash
codex --version
```

## 安装 Gemini CLI

```bash
npm install -g @google/gemini-cli
```

安装后确认：

```bash
gemini --version
```

## 安装 Cursor Agent

macOS 和 Linux 可以使用 Cursor 官方安装脚本：

```bash
curl https://cursor.com/install -fsS | bash
```

安装后确认：

```bash
agent --version
```

## 安装 OpenCode

```bash
npm install -g opencode-ai
```

安装后确认：

```bash
opencode --version
```

## 验证 PATH

安装 Provider CLI 后，Coder Studio 只能识别当前服务进程 PATH 中能找到的命令。先在普通终端验证：

```bash
which claude
which codex
which gemini
which agent
which opencode
claude --version
codex --version
gemini --version
agent --version
opencode --version
```

如果 `which` 找不到命令，常见原因是全局 npm 命令目录没有加入 PATH。

查看全局 npm 前缀目录：

```bash
npm config get prefix
npm prefix -g
```

在 macOS/Linux 上，全局命令 shim 通常在 `<prefix>/bin`。把这个目录加入 shell 配置后，重新打开终端并重启 Coder Studio：

```bash
coder-studio serve --restart
```

Windows 用户还需要确认 npm 的全局命令目录在用户或系统 PATH 中。常见目录是 `%APPDATA%\npm`。

## Coder Studio 如何识别 Provider

Coder Studio 启动工作区后会自动检测系统中是否有内置 Provider 需要的命令，例如 `claude`、`codex`、`gemini`、`agent` 和 `opencode`。如果检测到，界面上就会显示对应的 Provider 入口。如果未检测到，创建会话时会显示安装提示。

## Aider 和自定义 Provider

Aider 不属于当前内置 Provider 列表。它适合通过 preset/custom-provider 工作流接入：先在本地安装 `aider` 命令，再用自定义 Provider 配置指定命令、参数和工作目录。

自定义 Provider 主要是交互式命令集成，不一定支持内置 Provider 的 supervisor、idle detection、Agent instructions 或自动安装能力。

## 通过 More > Settings > Providers 配置 Provider

从工作区顶栏进入 **More / 更多 > Settings > Providers**，对应路由为 `/more/settings/providers`。在这里你可以针对每个 Provider 配置 `additionalArgs`。

### additionalArgs 是什么

这是一个文本框，每行写一个额外的启动参数。这些参数会附加到 Provider CLI 的启动命令中。

### 什么时候需要改

通常情况下不需要修改。以下场景可能需要添加额外参数：

- 指定特定的 API 端点
- 开启调试输出
- 传递 Provider 特定的配置标志

### 修改后如何验证

保存设置后，Providers 区域会显示 **Command Preview**，你可以看到最终有效的完整命令。

## 常见问题

**Q：安装了 Provider 但 Coder Studio 仍然说未找到？**
确保安装目录在 PATH 中。可以用 `which <command>` 和 `<command> --version` 验证，例如 `which gemini`、`which opencode`。

**Q：两个 Provider 可以同时用吗？**
可以。Coder Studio 支持在同一工作区内并行运行多个 Provider 会话。
