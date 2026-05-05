# Coder Studio

> Agent-First Development Environment — 把 AI Agent、代码编辑、Git 和终端放进同一个浏览器界面

## 这是什么

Coder Studio 是一个**本地优先的 AI 编码工作台**。你在本机运行服务，通过浏览器访问统一的开发界面，直接与 Claude 或 Codex Agent 协作完成编码任务。

它不是在线 IDE，也不绑定任何 SaaS 平台——所有代码和数据都留在你的电脑上。

## 浏览器访问，不限制设备和地点

Coder Studio 的界面运行在标准浏览器中，不依赖任何客户端应用。只要本机服务在运行，**任何能连到网络的设备都可以随时打开同一个工作台**：

- **电脑、平板、手机通用**：任何现代浏览器都能访问，不需要安装桌面客户端
- **随时查看，不受地点限制**：通勤路上用手机浏览器查看 Agent 进度、咖啡厅用平板审阅代码变更、客厅沙发上用笔记本继续操作——同一个工作台，随时打开即用
- **对移动端友好**：响应式界面设计，手机上可以流畅地浏览文件树、查看 Agent 对话和 Git 变更
- **团队协作共享**：同一局域网内的同事可以通过浏览器直接查看 Agent 的工作状态

### 典型使用场景

| 场景 | 怎么做 |
|------|--------|
| 通勤路上查进度 | 出门前启动服务，手机浏览器打开同一工作台查看 Agent 跑到了哪一步 |
| 咖啡厅轻量操作 | 用平板浏览器浏览文件、审阅 Git 变更、查看终端输出 |
| 沙发上继续编码 | 笔记本合上了，手机浏览器打开界面继续和 Agent 对话 |
| 团队共享查看 | 同事通过浏览器访问同一工作台，无需远程控制你的电脑 |

## 核心优势

- **一站式工作流**：Agent 对话、代码编辑、文件树、Git 状态、终端集中在同一个浏览器标签页中
- **多 Agent 并行**：同时连接 Claude Code 和 OpenAI Codex，按任务选择最合适的引擎
- **本地优先，数据可控**：服务运行在本地，代码不会上传到第三方云编辑器；会话记录存储在本地 SQLite
- **开箱即用**：一条命令安装，一条命令启动，浏览器自动打开；配合 Provider CLI 即可开始工作

## 它适合谁

- 希望在一个界面中同时与 AI 对话、看代码、跑命令的开发者
- 想在本地保留所有代码和会话数据、不依赖云端编辑器的团队
- 需要在手机、平板等设备上随时查看 Agent 进度的开发者
- 希望团队能通过浏览器共享查看工作状态的协作者
- 使用 Claude Code 或 OpenAI Codex 并想要图形化管理界面的用户

## 快速开始

只需几步即可开始：

### 前置要求

| 依赖 | 说明 |
|------|------|
| Node.js >= 24.0.0 | 运行 Coder Studio 服务 |
| Claude Code CLI 或 OpenAI Codex CLI | Agent 引擎（可选，但创建会话需要） |

### 安装与启动

```bash
# 1. 全局安装
npm install -g @spencer-kit/coder-studio

# 2. 启动并自动在浏览器中打开
coder-studio open
```

如果浏览器未自动弹出，可手动访问终端输出的 URL（通常为 `http://localhost:4173`）。

### 创建第一个会话

1. 在浏览器界面点击 **"打开工作区"**，选择你的项目目录
2. 点击 **"创建会话"**，选择 Claude 或 Codex
3. 开始与 Agent 对话、查看文件、执行命令

![工作区界面](docs/help/assets/screenshot-workspace.png)

> 没有安装 Provider CLI 也能先打开界面浏览文件和终端，稍后再安装即可。详细安装步骤见 [Provider 配置指南](docs/help/providers.md)。
### 界面预览

**PC 端工作区**

![PC 端工作区](docs/help/assets/screenshot-pc.png)

**移动端工作区**

![移动端工作区](docs/help/assets/screenshot-mobile.png)

## 常用操作

- **切换主题**：设置页可切换浅色 / 深色主题
- **切换语言**：设置页支持中文 / 英文切换
- **查看 Git 状态**：工作区内直接浏览变更文件和 diff
- **终端**：底部面板可打开 Shell 终端运行命令
- **移动端访问**：同一局域网内用其他设备浏览器访问本机 IP + 端口

## 文档

- [快速开始](docs/help/quick-start.md) — 从零到第一次使用的完整流程
- [App 功能总览](docs/help/app-overview.md) — 核心概念与能力说明
- [桌面端使用指南](docs/help/desktop-guide.md) — PC 端界面与操作
- [移动端使用指南](docs/help/mobile-guide.md) — 手机/平板操作指南
- [Provider 配置](docs/help/providers.md) — Claude Code / Codex CLI 安装与配置
- [常见工作流](docs/help/workflows.md) — 任务式操作指南
- [排障指南](docs/help/troubleshooting.md) — 常见问题与排查
- [CLI 参考](docs/help/cli.md) — 命令行命令速查

## 开发

> **仅限贡献者**：以下命令用于本地开发和贡献代码，普通用户无需执行。
> 普通用户请直接参考上方的"快速开始"。

```bash
# 克隆仓库
git clone https://github.com/spencerkit/coder-studio.git

# 安装依赖
pnpm install

# 启动开发环境
pnpm dev

# 运行测试
pnpm acceptance:phase1

# 构建CLI
pnpm build:cli
```

### 代码质量

- `pnpm lint`
  用于查看仓库当前的 lint 诊断，不会改写文件，通常在开始修复前先运行。
- `pnpm lint:fix`
  用于在修完代码后应用 Biome 可安全自动修复的 lint 修改，再检查生成的 diff。
- `pnpm format`
  用于统一仓库中的代码格式，提交前运行可以让本次修改与现有格式规则保持一致。
- `pnpm check`
  用于在发起 PR 或做阶段性验收前运行聚合检查，一次验证格式、lint 和导入整理。

## 架构

> **贡献者参考**：以下技术栈信息面向代码贡献者，普通用户无需了解。

- **Frontend**: React + Vite + Jotai
- **Backend**: Fastify + WebSocket
- **Terminal**: xterm.js + node-pty
- **Editor**: Monaco Editor
- **Storage**: SQLite (`node:sqlite`)

## 开发文档

- [PRD](docs/PRD.zh-CN.md)
- [Design Spec](docs/superpowers/specs/2026-04-13-coder-studio-design.md)
- [更多开发文档](docs/)

## 许可证

MIT
