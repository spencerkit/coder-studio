<div align="center">

<img src="docs/assets/logo.png" alt="Coder Studio Logo" width="128" height="128">

# Coder Studio

</div>

<div align="center">

**AI 编程工作台 · 浏览器访问 · 跨设备协作 · 本地运行**

[![npm version](https://img.shields.io/npm/v/@spencer-kit/coder-studio.svg)](https://www.npmjs.com/package/@spencer-kit/coder-studio)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.0.0-green.svg)](https://nodejs.org/)
[![GitHub Stars](https://img.shields.io/github/stars/spencerkit/coder-studio?style=social)](https://github.com/spencerkit/coder-studio/stargazers)
[![GitHub Discussions](https://img.shields.io/github/discussions/spencerkit/coder-studio)](https://github.com/spencerkit/coder-studio/discussions)
[![Open Issues](https://img.shields.io/github/issues/spencerkit/coder-studio)](https://github.com/spencerkit/coder-studio/issues)
[![Contributors](https://img.shields.io/github/contributors/spencerkit/coder-studio)](https://github.com/spencerkit/coder-studio/graphs/contributors)

</div>

---

> Deploy once, code everywhere.
>
> 一次部署，随处编码。

[English](README.md) | [文档](docs/help/quick-start.md) | [GitHub](https://github.com/spencerkit/coder-studio)

**Coder Studio** 是一个浏览器端的 AI 编程工作台，运行在你本地的机器上。从任何设备的浏览器访问你的开发环境 —— 在通勤路上用手机查看进度，在平板上审阅代码改动，或在多台电脑之间无缝切换。

## ✨ 核心特性

- 🌐 **浏览器工作台** — 无需桌面应用，任何现代浏览器都能使用
- 📱 **跨设备连续性** — 在桌面端开始，移动端继续，自由切换设备
- 🤖 **多 Agent 支持** — 同时运行 Claude Code 和 OpenAI Codex 会话
- 🔧 **一体化环境** — 终端、文件编辑器、Git 查看器和 AI Agent 统一界面
- 🔒 **本地运行隐私保护** — 代码保留在你自己的机器上，不依赖云 IDE
- ⚡ **实时同步** — 所有连接设备的实时工作区状态

![工作区界面](docs/help/assets/screenshot-workspace-overview.png)

---

## 🎯 为什么选择 Coder Studio

| 特性 | 优势 |
|------|------|
| **一次部署，随处继续** | 启动服务一次，在设备间切换不中断工作流 |
| **统一工作台** | Agent、代码、Git、终端在一处 —— 不再频繁切换应用 |
| **多 Agent 支持** | 同时运行 Claude Code 和 Codex 会话 |
| **本地优先 & 隐私** | 运行在你自己的机器上，代码永不离开设备 |
| **零配置浏览器访问** | 无需桌面客户端，任何设备打开 URL 即可 |

---

## 🚀 快速开始

```bash
# 全局安装
npm install -g @spencer-kit/coder-studio

# 启动工作台
coder-studio open
```

浏览器会自动打开。选择你的项目文件夹，开始使用 Claude Code 或 OpenAI Codex。

> **还没安装 AI CLI？** 你仍然可以浏览文件和使用终端。之后随时安装 Claude Code 或 Codex。

---

## 💡 使用场景

### 远程友好开发

- 在办公室启动 Agent 任务，通勤路上用手机查看进度
- 在平板上审阅代码改动，无需打开笔记本电脑
- 在家用电脑继续工作，零配置切换

### 团队协作

- 与同一网络的队友分享工作区 URL
- 无需屏幕共享进行代码审阅 —— 直接打开链接
- 实时向相关人员展示 Agent 进度

### AI 辅助编程

- 并行运行多个 Claude Code 或 Codex 会话
- 在移动端远程监控 Agent 进度
- 终端、编辑器和 Git 视图统一在一个界面

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
| **多 Agent 会话** | 同时运行 Claude Code 和 Codex 会话 |
| **集成编辑器** | Monaco 驱动的代码编辑器，支持语法高亮 |
| **Git 集成** | 在工作区内查看分支、diff 和变更文件 |
| **Shell 终端** | 完整 PTY 终端，运行命令和验证 Agent 输出 |
| **响应式 UI** | 桌面端、平板端和手机端布局自动适配 |
| **会话历史** | 恢复之前的会话，完整上下文保留 |
| **深色/浅色主题** | 可自定义外观和快捷键 |

---

## 📋 系统要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 24.0.0 | 运行 Coder Studio 必需 |
| Claude Code CLI | 最新版 | 可选 —— 用于 Claude Agent 会话 |
| OpenAI Codex CLI | 最新版 | 可选 —— 用于 Codex Agent 会话 |

---

## 📚 文档

| 资源 | 描述 |
|------|------|
| [快速开始](docs/help/quick-start.md) | 从安装到第一个工作区 |
| [功能总览](docs/help/app-overview.md) | 核心概念和功能 |
| [Provider 配置](docs/help/providers.md) | Claude Code / Codex CLI 安装 |
| [桌面端指南](docs/help/desktop-guide.md) | PC 界面和快捷键 |
| [移动端指南](docs/help/mobile-guide.md) | 手机/平板使用 |
| [常用工作流](docs/help/workflows.md) | 任务式教程 |
| [故障排除](docs/help/troubleshooting.md) | 常见问题和修复 |
| [CLI 参考](docs/help/cli.md) | 命令行选项 |

---

## 👥 谁适合使用

- **AI 编程深度用户** — 每天使用 Claude Code / Codex，想要更好的会话管理
- **多设备开发者** — 频繁在办公室、家和移动设备之间切换
- **远程优先团队** — 需要无需屏幕共享即可分享工作进度
- **注重隐私的开发者** — 希望代码留在本地机器，不依赖云 IDE

---

## 🔮 路线图

- [ ] Web 终端流式优化
- [ ] 会话回放和历史导航
- [ ] 多工作区管理
- [ ] 插件系统支持自定义集成
- [ ] 工作区偏好云同步

---

## 🤝 贡献

欢迎贡献！查看 [贡献指南](CONTRIBUTING.md) 了解详情。

### 本地开发

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

`AI 编程助手` `浏览器 IDE` `Claude Code` `Codex` `远程开发` `网页 IDE` `自托管 IDE` `跨设备编程` `AI Agent 工作区` `本地优先开发` `移动端编程` `平板编程` `开发者工具` `浏览器终端` `Git 网页界面` `Monaco 编辑器` `WebSocket 终端` `AI 结对编程` `随处编程` `云 IDE 替代`
