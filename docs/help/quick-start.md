# 快速开始

这篇文档带你完成从零到第一次使用 Coder Studio 的完整流程。

## 这篇文档解决什么问题

如何安装、启动 Coder Studio，并完成第一次 Agent 会话。

## 前置要求

### Node.js

Coder Studio 需要 **Node.js >= 24.0.0**。

```bash
node --version
```

如果版本过低，请先升级 Node.js。

### Provider CLI

Coder Studio 本身不包含 AI 引擎，需要安装 Provider CLI 才能创建 Agent 会话：

- 推荐首次试跑：Claude Code 或 Codex
- 其他内置 Provider：Gemini CLI、Cursor Agent、OpenCode

安装步骤见 [Provider 配置指南](providers.md)。

> 你也可以先启动 Coder Studio，稍后再安装 Provider。没有 Provider 时你仍然可以访问界面、浏览文件和终端，只是无法创建 Agent 会话。

## 安装

```bash
npm install -g @spencer-kit/coder-studio
```

安装完成后，终端中应该可以执行：

```bash
coder-studio help
```

## 启动并打开 Coder Studio

最简单的方式：

```bash
coder-studio open
```

这条命令会：

1. 如果服务未运行，自动启动服务
2. 在浏览器中打开 Coder Studio 界面

> 如果浏览器没有自动打开，可以手动访问终端输出的 URL（通常是 `http://localhost:4173`）。

## 第一次进入 App

### 1. 打开工作区

进入 App 后，你会看到欢迎页。点击 **"打开工作区"** 按钮，在弹出的目录选择器中找到你的项目目录并确认。

### 2. 创建第一个 Agent 会话

打开工作区后，你会看到 Agent 工作区。点击 **"创建会话"**，选择已检测到的 Provider 即可开始。首次试跑建议选择 Claude 或 Codex。

如果 Provider 未安装，界面上会显示安装提示和指引。

### 3. 查看终端和文件

- 底部面板显示终端，你可以看到 Agent 的输出，也可以自己打开 Shell 终端运行命令
- 左侧面板显示文件树，可以浏览项目结构

### 4. 进入设置

点击顶栏右侧的齿轮图标进入设置页，这里可以：

- 切换语言（中文/英文）
- 切换主题（浅色/深色）
- 查看 Provider 状态和配置
- 自定义快捷键

## 常见问题

**Q：需要额外安装 pm2 吗？**
不需要。pm2 已经是 Coder Studio 的内置依赖，后台模式开箱即用。

**Q：想让服务一直在前台运行怎么办？**
默认情况下服务在后台运行，关闭终端窗口不影响服务。如果你希望在前台运行（比如调试），可以使用 `coder-studio serve --foreground`。

**Q：启动后浏览器没有自动打开？**
执行 `coder-studio status` 确认服务是否运行中。如果状态为 running，手动访问终端输出的 URL 即可。

**Q：Node.js 版本不对怎么办？**
Coder Studio 需要 Node.js >= 24.0.0。可以用 `nvm use 24` 或从 [nodejs.org](https://nodejs.org/) 下载最新版本。

## 下一步看什么

- [第一次 Agent 运行](first-agent-run.md) — 完成第一个推荐 Provider 会话并审查 diff
- [App 功能总览](app-overview.md) — 了解核心概念
- [桌面端使用指南](desktop-guide.md) — 熟悉桌面端操作
- [移动端使用指南](mobile-guide.md) — 在手机端访问和使用
- [排障指南](troubleshooting.md) — 解决 Node、Provider、端口和认证问题
