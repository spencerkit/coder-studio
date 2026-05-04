# Provider 配置指南

这篇文档介绍如何为 Coder Studio 安装和配置 Provider。

## 这篇文档解决什么问题

如何安装 Claude 或 Codex CLI，以便在 Coder Studio 中创建 Agent 会话。

## 前置条件

- 已安装 Coder Studio（`npm install -g @spencer-kit/coder-studio`）
- 已安装 Node.js >= 24.0.0

## 当前支持哪些 Provider

Coder Studio 目前支持两种 Provider：

- **Claude**：Anthropic Claude Code CLI（Full mode）
- **Codex**：OpenAI Codex CLI（Limited mode）

两者都需要在本地独立安装。

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

## Coder Studio 如何识别 Provider

Coder Studio 启动工作区后会自动检测系统中是否有 `claude` 和 `codex` 命令。如果检测到，界面上就会显示对应的 Provider 入口。如果未检测到，创建会话时会显示安装提示。

## 在设置页中配置 Provider

进入设置 → Providers 页面，你可以针对每个 Provider 配置 `additionalArgs`。

### additionalArgs 是什么

这是一个文本框，每行写一个额外的启动参数。这些参数会附加到 Provider CLI 的启动命令中。

### 什么时候需要改

通常情况下不需要修改。以下场景可能需要添加额外参数：

- 指定特定的 API 端点
- 开启调试输出
- 传递 Provider 特定的配置标志

### 修改后如何验证

保存设置后，设置页面会显示 **Command Preview**，你可以看到最终有效的完整命令。

## 常见问题

**Q：安装了 Provider 但 Coder Studio 仍然说未找到？**
确保 `npm install -g` 安装的目录在 PATH 中。可以用 `which claude` 或 `which codex` 验证。

**Q：两个 Provider 可以同时用吗？**
可以。Coder Studio 支持在同一工作区内并行运行 Claude 和 Codex 会话。
