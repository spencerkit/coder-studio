# Coder Studio

> Deploy once, code everywhere.
>
> Deploy your coding workspace once, then keep working anywhere.

[English README](README.md)

Coder Studio 让你把 AI coding workspace 启动在自己的机器上，然后在任何地点、任何设备上继续使用它。Claude Code 或 Codex、文件、Git、终端都留在同一个浏览器工作台里，你的工作流不再被固定在某一张桌子前或某一台设备上。

你可以在办公室发起任务，在通勤路上用手机看进度，在外面用平板审阅改动，回到家再用另一台电脑继续接着做。还是同一个 workspace，还是同一份上下文，不需要重新接管环境。

![工作区界面](docs/help/assets/screenshot-workspace.png)

## 为什么是 Coder Studio

- **一次部署，随处继续**：服务启动一次，后续可以在不同设备、不同场景之间无缝切换
- **同一个工作台跨设备延续**：不是远程看日志，而是在同一个 workspace 里继续查看 Agent、代码、Git 和终端
- **Agent + Code + Git + Terminal 一体化**：减少在 CLI、编辑器、diff 工具和终端之间来回切换
- **支持 Claude Code / Codex**：按任务选择合适的 Agent，在同一工作区内并行协作
- **本地运行，数据可控**：服务运行在你自己的机器上，代码和会话数据不依赖第三方云编辑器

## 它解决什么问题

传统的 AI coding workflow 往往绑定在一台正在运行 CLI 的电脑上：

- Agent 在跑，但你人必须守在原来的设备前
- 换个场景，就很难继续查看上下文和执行状态
- 手机上能收到通知，但看不到完整的 coding workspace
- 跨设备切换通常意味着重新接管环境，而不是继续工作

Coder Studio 的目标就是把这件事变成：

`Deploy once, code everywhere.`

## 快速开始

```bash
npm install -g @spencer-kit/coder-studio
coder-studio open
```

然后只需要 3 步：

1. 在浏览器里点击 **打开工作区**
2. 选择你的项目目录并创建 Claude 或 Codex 会话
3. 开始和 Agent 协作，同时查看文件、Git 变更和终端输出

> 没有安装 Provider CLI 也可以先打开界面浏览文件和终端，之后再补装。详细步骤见 [Provider 配置指南](docs/help/providers.md)。

## 你可以怎么用它

| 场景 | 你可以怎么做 |
|------|--------------|
| 在办公室开始任务 | 启动服务，打开项目，创建 Claude 或 Codex 会话，让 Agent 先开始工作 |
| 通勤路上查看进度 | 用手机浏览器打开同一个工作台，查看 Agent 输出、当前状态和 Git 变化 |
| 在外面轻量审阅 | 用平板浏览文件、看 diff、确认终端输出，不用回到原电脑前 |
| 回到另一台设备继续 | 在新的设备上接入同一个 workspace，直接延续刚才的上下文 |
| 团队共享查看 | 同一局域网内的同事可通过浏览器查看当前工作状态 |

## 你可以用它做什么

- 在一个工作区里同时运行多个 Agent 会话
- 在 Agent 工作时实时查看文件树、编辑器和 Git diff
- 打开 Shell 终端独立验证 Agent 的结果
- 在桌面端使用完整多面板布局和快捷键
- 在手机或平板上随时查看工作区和会话进度
- 通过设置页管理主题、语言、快捷键和 Provider 参数

## 跨设备工作

Coder Studio 运行在标准浏览器里，不依赖桌面客户端：

- **桌面端**：适合完整编码、编辑文件、查看 diff、管理多个面板
- **平板端**：适合轻量审阅、追踪 Agent 进度、浏览项目状态
- **手机端**：适合随时查看会话状态、终端输出和工作区变化

同一个服务地址，可以在不同设备之间切换访问；界面会根据屏幕自动适配。

**PC 端工作区**

![PC 端工作区](docs/help/assets/screenshot-pc.png)

**移动端工作区**

![移动端工作区](docs/help/assets/screenshot-mobile.png)

## 核心能力

- **Workspace**：一个工作区对应一个本地项目目录，包含文件、终端、Git 和会话
- **Session**：每个会话对应一个独立的 Claude 或 Codex Agent 运行
- **Terminal**：同时支持 Shell 终端和 Agent 终端
- **Git View**：直接在工作区内查看分支、变更文件和 diff
- **Settings**：统一管理主题、语言、快捷键和 Provider 启动参数

## 文档

- [快速开始](docs/help/quick-start.md) — 从安装到第一次启动
- [App 功能总览](docs/help/app-overview.md) — 核心概念与能力说明
- [Provider 配置](docs/help/providers.md) — Claude Code / Codex CLI 安装与配置
- [桌面端使用指南](docs/help/desktop-guide.md) — PC 端界面与操作
- [移动端使用指南](docs/help/mobile-guide.md) — 手机 / 平板操作指南
- [常见工作流](docs/help/workflows.md) — 任务式操作指南
- [排障指南](docs/help/troubleshooting.md) — 常见问题与排查
- [CLI 参考](docs/help/cli.md) — 命令行命令速查

## 安装要求

| 依赖 | 说明 |
|------|------|
| Node.js >= 24.0.0 | 运行 Coder Studio 服务 |
| Claude Code CLI 或 OpenAI Codex CLI | 创建 Agent 会话时需要，未安装时仍可先使用文件和终端能力 |

## 贡献者说明

以下内容面向仓库贡献者，普通用户可以直接参考上面的快速开始和产品文档。

### 本地开发

```bash
git clone https://github.com/spencerkit/coder-studio.git
pnpm install
pnpm dev
```

### 常用命令

```bash
pnpm acceptance:phase1
pnpm build:cli
pnpm lint
pnpm lint:fix
pnpm format
pnpm check
```

### 技术栈

- Frontend: React + Vite + Jotai
- Backend: Fastify + WebSocket
- Terminal: xterm.js + node-pty
- Editor: Monaco Editor
- Storage: SQLite (`node:sqlite`)

### 开发文档

- [PRD](docs/PRD.zh-CN.md)
- [Design Spec](docs/superpowers/specs/2026-04-13-coder-studio-design.md)
- [更多开发文档](docs/)

## License

MIT
