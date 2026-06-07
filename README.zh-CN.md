<div align="center">

<img src="docs/assets/logo.png" alt="Coder Studio Logo" width="128" height="128">

# Coder Studio

**一站式 vibe coding 编程工作台。**

Coder Studio 把代码编辑器、Git、终端、AI coding agent、会话审查、消息提醒、工作复盘和 Skills 放进同一个浏览器工作区。

它帮助你在桌面、平板和手机之间保持 Agent 上下文、任务进度和后续动作可见，让 vibe coding 不再散落在一堆窗口和工具里。

支持 Claude Code、Codex、Gemini CLI、Cursor Agent、OpenCode，以及 Aider 这类 CLI coding agent。

[![npm version](https://img.shields.io/npm/v/@spencer-kit/coder-studio.svg)](https://www.npmjs.com/package/@spencer-kit/coder-studio)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.0.0-green.svg)](https://nodejs.org/)
[![GitHub Stars](https://img.shields.io/github/stars/spencerkit/coder-studio?style=social)](https://github.com/spencerkit/coder-studio/stargazers)

[查看工作区](docs/help/assets/screenshot-desktop-workspace-full.png) · [快速开始](#快速开始) · [GitHub Star](https://github.com/spencerkit/coder-studio)

[English](README.md) | [文档](docs/help/quick-start.md)

</div>

[![工作区预览](docs/help/assets/screenshot-desktop-workspace-full.png)](docs/help/assets/screenshot-desktop-workspace-full.png)

<div align="center">预览这个为 Agent 运行、改动审查、Supervisor 监督和跨设备切换而设计的完整工作区布局。</div>

## 为什么选择 Coder Studio？

vibe coding 一开始很快，但当 Agent 输出进入真实项目，后面还要运行 Agent、理解改动、审查 diff、管理 Git、监督长任务，并改进下一轮执行。Coder Studio 把这条链路收进一个编程工作台。

| 功能 | 解决的痛点 | Coder Studio 提供什么 |
|------|------------|-----------------------|
| **Agent 会话** | prompt、终端和历史记录分散在多个工具里。 | 在同一个工作区启动 Claude Code、Codex、Gemini CLI、Cursor Agent、OpenCode 和 CLI 形式的 Agent。 |
| **编辑器、终端和 Git** | 理解一个任务需要在编辑器、shell tab、Git 工具和 diff 查看器之间来回切换。 | 把代码编辑、终端输出、Git 状态、变更文件和 diff 放在一起。 |
| **可审查的 AI 改动** | Agent 说完成了，但你仍然要判断哪些改动可以信任。 | 在 Agent 会话旁审查变更文件和 diff，再决定调整、丢弃或接受。 |
| **Supervisor 监督循环** | 长任务容易卡住、跑偏，或者需要反复人工续推。 | 围绕目标评估进度，并继续推进后续步骤。 |
| **状态和消息提醒** | 你需要反复检查终端，才知道任务是否完成或需要介入。 | 在工作区内呈现会话状态变化和完成提醒。 |
| **跨设备工作区** | SSH、远程桌面或换设备会打断任务上下文。 | 桌面、平板、手机重新打开同一个工作区，继续看进度和审查改动。 |
| **工作分析** | 日志和 diff 很难解释一段时间内到底发生了什么。 | 回顾活动、Agent 使用情况、瓶颈、重复模式和 Skill 候选项。 |
| **Skills 管理** | 相同指令和工作流在多次 Agent 执行中反复重复。 | 安装和挂载可复用 Skills，让 Agent 带着更好的上下文开始，少靠人工提醒。 |

## 快速开始

```bash
# 全局安装
npm install -g @spencer-kit/coder-studio

# 启动工作台
coder-studio open
```

浏览器会自动打开。选择你的项目文件夹，然后启动一个 AI coding agent 会话。

> **还没安装 AI coding agent CLI？** 你仍然可以浏览文件和使用终端。之后随时安装你想使用的 Agent CLI。

---

## 💡 使用场景

### 跨设备开发

- 在办公室启动 Agent 任务，通勤路上用手机查看进度
- 在平板上审阅代码改动，无需打开笔记本电脑
- 在另一台设备重新打开同一个工作区，不必重建会话上下文

### 长任务监督与调度

- 让 Supervisor 围绕目标持续推进多轮任务，不必一直盯着终端
- 用手机查看评估循环和后续动作，而不是守着每轮输出
- 通过完成提醒和状态更新知道什么时候需要介入

### AI 辅助编程

- 运行 Claude Code、Codex、Gemini CLI、Cursor Agent、OpenCode，或 Aider 这类 CLI Agent 会话
- 终端、编辑器、Git 和 Supervisor 状态统一在一个界面
- 切换设备后继续当前 AI 工作，不必重新建立上下文

### 工作复盘与 Skills

- 用工作分析复盘 Agent 会话、活动模式、瓶颈和后续改进方向
- 在工作区里管理 Skills，让 Agent 复用合适的工作流知识
- 把重复出现的审查结论沉淀成后续更稳定的 Agent 执行方式

---

## 📱 跨设备体验

| 设备 | 适用场景 |
|------|----------|
| 🖥️ **桌面端** | 完整编码会话、文件编辑、diff 审阅、面板管理 |
| 📱 **平板端** | 代码审阅、Agent 进度追踪、文件浏览 |
| 📲 **手机端** | 快速状态检查、终端输出监控、会话查看 |

同一个工作区 URL 在所有设备上通用 —— 界面自动适配。

**桌面端界面**

![桌面端工作区](docs/help/assets/screenshot-pc.png)

**移动端界面**

![移动端工作区](docs/help/assets/screenshot-mobile.png)

---

## 🛠️ 功能概览

| 功能 | 描述 |
|------|------|
| **一站式编程工作台** | 把代码编辑、PTY 终端、Git 状态、diff、Agent 会话和代码审查放进同一个浏览器界面 |
| **跨设备工作区** | 在桌面、平板和手机之间重新打开同一个编码环境，不必重新建立上下文 |
| **Supervisor 监督循环** | 围绕目标运行评估与续推循环，减少长任务中的人工盯守 |
| **热门 Coding Agent** | 在同一个工作区运行 Claude Code、Codex、Gemini CLI、Cursor Agent、OpenCode 和 CLI 形式的 Agent |
| **消息提醒与状态更新** | 在工作区内看到错误、状态变化和会话完成提醒 |
| **工作分析** | 复盘工作区活动、Agent 会话、常见模式、瓶颈和可能沉淀的 Skill |
| **Skills 管理** | 搜索、安装、挂载、修复和查看 Skills，让 Agent 更容易复用稳定工作流 |
| **可审查的 AI 改动** | 先在 Agent 会话旁检查文件和 diff，再决定是否信任结果 |
| **响应式工作区界面** | 提供面向桌面、平板和手机的布局，而不是把桌面界面硬塞进小屏幕 |
| **会话连续性** | 切换设备后继续当前活跃会话，让 AI 工作保持可见 |

---

## 📋 系统要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 24.0.0 | 运行 Coder Studio 必需 |
| AI coding agent CLI | 最新版 | 可选 —— 为你想运行的 Agent 安装对应 CLI |

---

## 📚 文档

| 资源 | 描述 |
|------|------|
| [快速开始](docs/help/quick-start.md) | 从安装到第一个工作区 |
| [功能总览](docs/help/app-overview.md) | 核心概念和功能 |
| [Agent CLI 配置](docs/help/providers.md) | 安装和连接 coding agent CLI |
| [桌面端指南](docs/help/desktop-guide.md) | PC 界面和快捷键 |
| [移动端与远程访问指南](docs/help/mobile-guide.md) | 手机/平板使用、局域网访问、Tailscale/ngrok/Cloudflare Tunnel |
| [工作分析](docs/help/work-analysis.md) | 复盘工作区活动、Agent 会话和改进机会 |
| [常用工作流](docs/help/workflows.md) | 任务式教程 |
| [故障排除](docs/help/troubleshooting.md) | 常见问题和修复 |
| [CLI 参考](docs/help/cli.md) | 命令行选项 |
| [GitHub Wiki 源文件](docs/wiki/README.md) | Wiki 源页面与发布流程 |
| [AI Coding 术语](docs/wiki/AI-Coding-Terms.md) | Vibe coding、agentic harness、eval harness，以及 Coder Studio 的定位 |

---

## 👥 谁适合使用

- **运行 coding agent 的开发者** — 希望把终端、文件、Git、会话和代码审查放到同一个地方
- **Vibe coding 用户** — 希望有一个 agentic workspace，而不是只靠分散的终端流程
- **多设备开发者** — 频繁在办公室、家和移动设备之间切换
- **运行长任务的开发者** — 希望由 Supervisor 持续推进多轮任务，而不是全程人工盯守

---

## 🔮 路线图

- [ ] Web 终端流式优化
- [ ] 会话回放和历史导航
- [ ] 多工作区管理
- [ ] 插件系统支持自定义集成
- [ ] 工作区偏好同步

---

## 🤝 贡献

欢迎贡献！查看 [贡献指南](CONTRIBUTING.md) 了解详情。

### 开发环境

```bash
git clone https://github.com/spencerkit/coder-studio.git
pnpm install
pnpm dev
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React, Vite, Jotai |
| 后端 | Fastify, WebSocket |
| 终端 | xterm.js, node-pty |
| 编辑器 | Monaco Editor |
| 存储 | SQLite (node:sqlite) |

### 开发文档

- [PRD](docs/PRD.zh-CN.md)
- [设计规范](docs/superpowers/specs/2026-04-13-coder-studio-design.md)
- [更多文档](docs/)

---

## 📄 许可证

MIT 许可证 —— 查看 [LICENSE](LICENSE) 了解详情。

---

## 🔍 关键词

`vibe coding` `agentic coding` `AI coding agent` `Coding Agent 工作区` `浏览器 IDE` `Claude Code` `Codex` `Gemini CLI` `Cursor Agent` `OpenCode` `Aider` `跨设备编程` `AI Agent 工作区` `移动端编程` `平板编程` `开发者工具` `浏览器终端` `Git 网页界面` `Monaco 编辑器` `WebSocket 终端` `AI 结对编程` `Supervisor 循环`
