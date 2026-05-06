# Coder Studio 技术设计文档

> **版本：** 1.0
> **日期：** 2026-04-13
> **状态：** Draft (等待评审)
> **对应 PRD：** `docs/PRD.zh-CN.md` v0.2.6
> **作者：** 技术共同设计 — Spencer + Claude

---

## 0. 文档说明

### 0.1 目的

本文档是 Coder Studio 的**完整技术设计**。它覆盖 PRD 中描述的**全部功能**，并给出一条从 MVP 到完整产品的**分阶段交付路线图**。目标是：一次性把架构和模块边界设计到位，使得未来各 Phase 只需**填充模块内部实现**，不需要回过头重新设计架构。

### 0.2 与 PRD 的关系

- **PRD** 负责描述 "What"：功能需求、用户界面、交互行为、业务规则
- **本 Spec** 负责描述 "How"：系统架构、模块边界、协议契约、实现策略、分阶段路线图

本文档**不重复 PRD 的功能描述**。涉及具体功能时用 `PRD §X.Y` 引用。

### 0.3 PRD 修正清单

Brainstorming 过程中发现 PRD 有若干需要修正的条目。写入实现前 PRD 应同步修正：

| # | PRD 位置 | 修正内容 |
|---|---|---|
| 1 | §11.3 终端渲染 | **移除双轨"转录模式"**。渲染只保留 xterm + WebGL 单一路径，兼容模式降级到 canvas |
| 2 | §13.5.2 注入 Hooks | 改为写 **Provider 全局配置文件**（非工作区）；必须 merge-write 不破坏用户原有配置 |
| 3 | §8.5 会话追踪 | "恢复 ID" 来源明确：通过 Provider `SessionStart` hook 从 CLI 结构化获取，非 stdout 解析 |
| 4 | §8.6 生命周期事件 | `session_started` / `turn_completed` 的**上游来源**是 Provider hooks |
| 5 | §15.2 通知系统 | 完成通知触发点依赖 Provider `Stop` hook |
| 6 | §20.2 Agent 会话错误 | 新增降级场景：Hooks 未注册 / Provider 能力 Limited / 全局配置被破坏 |
| 7 | §7.5 工作区生命周期 | Server 启动时自动对 Provider 全局配置执行 hooks merge-write |
| 8 | §13.5 Provider 设置 | 新增 Hook 注册状态显示（已注册 / 未注册 / 注册失败 + 原因） |
| 9 | §8.7 会话恢复 | Phase 1 澄清：仅恢复 resume_id，不恢复历史 PTY 输出 |
| 10 | §11 终端系统 | **Phase 1 不持久化 PTY 输出流**；不做 "View full log"；xterm scrollback 提升到 5000 行 |
| 11 | 附录 A 当前边界 | 新增"输出持久化 / 跨 session 搜索 / 会话回放"到未发布功能列表 |
| 12 | §8 / §11 术语 | **Terminal 是底层原语，Session 是业务封装**。PRD 里把两者混用为 "Agent 会话终端" 的地方统一到这个分层表述；独立 shell 终端没有 Session |

### 0.4 技术栈锁定

| 层 | 选型 | 锁定原因 |
|---|---|---|
| 后端运行时 | **Node.js 20+** | node-pty、chokidar、better-sqlite3 成熟度 |
| 后端框架 | **Fastify** | 性能好、插件生态成熟、TypeScript 支持一流 |
| 实时通道 | **WebSocket** (`ws` lib) | 单连接多路复用，自主控制协议 |
| 前端框架 | **React 18** + TypeScript | Monaco / xterm 生态原生支持 |
| 前端开发工具 | **Vite dev server** | React 前端开发、HMR 快、生态成熟 |
| 前端生产构建 | **Vite build** | 生成浏览器静态资源产物 |
| 后端开发运行 | **tsx watch** | Node 服务本地开发、热重启简单直接 |
| 生产构建工具 | **esbuild** | 以 CLI 为最终入口输出稳定的 ESM/CJS 双产物 bundle |
| 状态管理 | **Jotai** | atomFamily 天然适合每会话/终端/文件独立状态 |
| 路由 | **TanStack Router** | TS-first、类型化路由参数 |
| 编辑器 | **Monaco Editor** (`@monaco-editor/react`) | PRD 明确要求，原生 TS |
| 终端 | **xterm.js** + `addon-fit` + `addon-webgl` | 行业标准 |
| PTY | **node-pty** | 跨平台 PTY，VS Code/Hyper 在用 |
| 文件监听 | **chokidar** | 跨平台稳健，处理原子写 |
| 进程管理 | `child_process.execFile` + node-pty | 结构化命令（Git）与交互命令（Agent）分开 |
| Git | **shell out `git` CLI** | 用户 .gitconfig / aliases / hooks / SSH 自动生效 |
| 存储 | **better-sqlite3** | 同步 API、零配置、极快 |
| Schema 校验 | **Zod** | 前后端共用 schema → 类型安全 + 运行时校验 |
| 包管理 | **pnpm workspaces** | monorepo 磁盘和安装速度最优 |
| 测试 | **Vitest** + **Playwright** | 开发速度快，E2E 能力强 |
| 代码质量 | **TS strict** + **ESLint** + **Prettier** | CLAUDE.md 规则对齐 |

### 0.5 分阶段原则（Phase Roadmap）

本设计按 **4 个 Phase** 交付，每个 Phase 对应一个**用户可感知的里程碑**：

| Phase | 代号 | 目标 | 工期估算 |
|---|---|---|---|
| **Phase 1** | MVP | 我每天自己能用。多 Agent 并行、编辑保存、Git 基本操作 | 4–6 周 |
| **Phase 2** | Shareable | 能分享给朋友。认证、设置、i18n、Provider 全部接好 | 额外 4–5 周 |
| **Phase 3** | Full PRD | 对齐 PRD 全部内容。Supervisor、Worktree 管理、多标签并发 | 额外 6–8 周 |
| **Phase 4** | Quality | 稳定性、性能优化、持久化方案、打包优化 | 额外 4+ 周 |

**核心约束：每个 Phase 不能回退上一 Phase 的代码架构**。新增功能通过**填入预留的扩展点**实现，不是重构。

### 0.6 整体架构原则

1. **Server 是唯一真源**：Agent 进程、PTY、文件监听、Git 状态都在 server。前端只是投影
2. **前后端通过单一 WebSocket 多路复用通信**：协议设计为 Command / Event / Subscribe 三类消息
3. **全 TypeScript**：核心协议/类型在 `@coder-studio/core` 包中一次定义，前后端共用
4. **Provider 插件化**：Agent CLI 通过 `ProviderDefinition` 对象接入，新 Provider 零核心改动
5. **能力分级 (Full / Limited / Unsupported)**：系统行为围绕 Provider 能力分叉，不可靠的降级信号 UI 明示
6. **Phase 1 不做持久化**：除结构化元数据外，PTY 输出流、日志历史一律内存，server 重启即失
7. **不引入未证明必要的复杂度**：宁愿从 PRD 移除功能，也不背负复杂度/收益失衡的包袱

---

## 1. 系统概览

### 1.1 高层架构图

```
┌──────────────────────────────────────────────────────────────┐
│                       浏览器 (Chrome/Firefox)                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                      Coder Studio Web                  │  │
│  │                                                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐ ┌────────┐   │  │
│  │  │  Layout  │  │  Agent   │  │   Code   │ │ Git/   │   │  │
│  │  │  Shell   │  │   Panes  │  │  Editor  │ │Term/FS │   │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘ └───┬────┘   │  │
│  │       └─────────────┴─────────────┴──────────-┘        │  │
│  │                         │                              │  │
│  │                  ┌──────┴──────┐                       │  │
│  │                  │ Jotai Atoms │                       │  │
│  │                  └──────┬──────┘                       │  │
│  │                         │                              │  │
│  │                  ┌──────┴──────┐                       │  │
│  │                  │  WS Client  │                       │  │
│  │                  └──────┬──────┘                       │  │
│  └─────────────────────────┼──────────────────────────────┘  │
└───────────────────────────-│────────────────────────────────-┘
                              │ WebSocket (Command / Event / Subscribe)
                              │ ws://127.0.0.1:<port>/ws
                              │
┌─────────────────────────────┼─────────────────────────────┐
│                             │                             │
│      ┌──────────────────────┴───────────────────┐         │
│      │             WebSocket Hub                │         │
│      │     (单 writer 强制、事件广播、订阅过滤)   │         │
│      └──────────────────────┬───────────────────┘         │
│                             │                             │
│      ┌─────────────────────-┴─────────────────────┐       │
│      │                Event Bus                   │       │
│      │ (内存 pub/sub + 环形缓冲用于断线补发)       │       │
│      └──────────────────────┬─────────────────────┘       │
│                             │                             │
│  ┌──────────────┬───────────┴────────┬────────────────┐   │
│  │              │                    │                │   │
│  │  ┌────────-──┴───┐  ┌───────────-─┴──┐ ┌──────-──-──┴──┐│
│  │  │  Session Mgr  │  │  File/Git Svc  │ │  Storage Svc  ││
│  │  │               │  │                │ │   (SQLite)    ││
│  │  │ ┌───────────┐ │  │ ┌───────────┐  │ │               ││
│  │  │ │ Provider  │ │  │ │ chokidar  │  │ │  workspaces   ││
│  │  │ │ Registry  │ │  │ │  watchers │  │ │  sessions     ││
│  │  │ └─────┬─────┘ │  │ └───────────┘  │ │  settings     ││
│  │  │       │       │  │                │ │  providers    ││
│  │  │ ┌─────┴─────┐ │  │ ┌───────────┐  │ │  auth (P2+)   ││
│  │  │ │ PTY Host  │ │  │ │  git CLI  │  │ │               ││
│  │  │ │(node-pty) │ │  │ │  wrapper  │  │ │               ││
│  │  │ └───────────┘ │  │ └───────────┘  │ │               ││
│  │  └───────────────┘  └────────────────┘ └───────────────┘│
│  │                                                         │
│  │  ┌───────────────────────────────────────────────────┐  │
│  │  │            Hooks HTTP Endpoint                    │  │
│  │  │  POST /internal/hooks/:event?token=<token>       │  │
│  │  └─────────────────-┬──────────────────────────────-┘  │
│  │                     │                                  │
│  │  ┌───────────────-──┴──────────────────────────────-┐  │
│  │  │  Hooks Manager                                   │  │
│  │  │  - 全局配置检测 / merge-write                     │  │
│  │  │  - runtime.json 写入                             │  │
│  │  │  - bridge 脚本部署                                │  │
│  │  │  - 事件路由到 Session Mgr                         │  │
│  │  └──────────────────────────────────────────────────┘  │
│  │                                                        │
│  └─-──────────────────────────────────────────────────────┘
│                                                            │
│                    Coder Studio Server (Node)              │
└───────────────-┬─────────────────────────-┬────────────────┘
                 │                          │
         spawn PTY                    触发 Hook 回调
                 │                          │
        ┌────────┴────────┐         ┌───────┴────────┐
        │  claude / codex │ ─────▶  │  bridge script │
        │     CLI (PTY)   │         │ (node, global) │
        └─────────────────┘         └───────┬────────┘
                                            │
                                       HTTP POST
                                            │
                                     回到 Hooks Endpoint
```

### 1.2 核心概念

| 概念 | 描述 |
|---|---|
| **Workspace** | 一个正在开发的项目目录。每个 workspace 有独立的文件树、Git 状态、会话集合、终端集合 |
| **Terminal** | **底层原语**。一个 PTY 进程 + ring buffer + xterm 终端渲染。只负责字节流和生命周期，不知道里面跑的是 Agent CLI 还是 bash。通过 `kind` 区分 `agent` / `shell` |
| **Session** | **业务层封装**。在一个 agent-kind Terminal 之上叠加 Agent 领域语义：Provider 绑定、状态机 (`starting → running → idle → busy → ended`)、resume_id 追踪、hook 事件消化、生命周期事件发射。一个 Session 恰好对应一个 Terminal；shell 终端没有对应 Session |
| **Pane** | Agent 工作区的一个面板节点。递归 split 形成树形布局。Pane 渲染的是 Session 卡片，通过 `session.terminalId` 找到 xterm |
| **Provider** | Agent CLI 的适配层（Claude / Codex / ...）。通过 `ProviderDefinition` 声明。仅影响 Session 层，对 Terminal 层无感 |
| **Hook Event** | Provider CLI 通过其 hooks 机制回调给 Coder Studio 的事件 (SessionStart / Stop / ...)。只进入 Session 层 |
| **Capability** | Provider 的能力等级：`full` / `limited` / `unsupported`。决定 Session 层如何解析状态，Terminal 层无感 |
| **Writer Tab** | 当前拥有写权限的浏览器 tab（Phase 1 只允许一个） |

**Terminal 与 Session 的分层判断标准：** 如果一段逻辑移除后 shell 终端仍能正常工作，它属于 Session 层；如果移除后 shell 终端也坏了，它属于 Terminal 层。

### 1.3 控制流

**新会话启动（Full-mode Provider 如 Claude）：**

```
1. 用户点 "Claude" 按钮
2. 前端 dispatch Command("session.create", { workspaceId, providerId: "claude" })
3. Server 在对应 workspace 目录下 spawn PTY 进程 (claude CLI)
4. PTY 输出 → ring buffer + WS event("terminal.output")
5. Claude CLI 触发 SessionStart hook → bridge script → POST /internal/hooks/SessionStart
6. Hooks Manager 解析 payload → 提取 resume_id → 写入 session metadata
7. Session Mgr 触发 Event("session.state", { state: "running", resumeId })
8. Server 广播给所有订阅的 client → Jotai atom 更新 → UI 渲染
9. 用户看到会话状态变为 Running，进度条激活，收到 resume_id
```

---

## 2. Monorepo 包结构

### 2.1 目录树

```
coder-studio/
├── pnpm-workspace.yaml
├── package.json               # 根 package（仅 workspace 脚本和 devDep）
├── tsconfig.base.json         # 公共 tsconfig
├── .eslintrc.cjs              # 根 ESLint 配置
├── .prettierrc
├── vitest.workspace.ts
│
├── packages/
│   ├── core/                  # 纯 TS，前后端共用
│   │   ├── src/
│   │   │   ├── protocol/      # WS 消息定义（Command/Event/Subscribe + Zod schema）
│   │   │   ├── provider/      # ProviderDefinition 契约
│   │   │   ├── domain/        # 业务实体类型（Workspace/Session/Terminal/...）
│   │   │   ├── events/        # 事件名常量和 payload 类型
│   │   │   └── index.ts
│   │   ├── package.json       # name: @coder-studio/core, only peer deps
│   │   └── tsconfig.json
│   │
│   ├── providers/             # Provider 实现
│   │   ├── src/
│   │   │   ├── claude/        # Claude Code provider
│   │   │   │   ├── definition.ts
│   │   │   │   ├── config-schema.ts
│   │   │   │   ├── hooks-template.ts  # 要写入 ~/.claude/settings.json 的 hooks 片段
│   │   │   │   └── event-parser.ts
│   │   │   ├── codex/         # Codex provider（Limited 模式）
│   │   │   │   ├── definition.ts
│   │   │   │   └── stdout-heuristics.ts
│   │   │   ├── registry.ts    # 全部 providers 的静态列表
│   │   │   └── index.ts
│   │   └── package.json       # depends on @coder-studio/core
│   │
│   ├── server/                # Node 运行时
│   │   ├── src/
│   │   │   ├── app.ts         # Fastify app 组装
│   │   │   ├── config.ts      # 启动配置（CLI args, env, paths）
│   │   │   ├── ws/            # WebSocket Hub
│   │   │   │   ├── hub.ts     # 单 writer 控制、订阅路由
│   │   │   │   ├── client.ts  # 单 client 的状态
│   │   │   │   └── dispatch.ts # Command → handler 路由
│   │   │   ├── commands/      # 每个 Command handler 一个文件
│   │   │   │   ├── session-create.ts
│   │   │   │   ├── session-stop.ts
│   │   │   │   ├── terminal-input.ts
│   │   │   │   ├── file-read.ts
│   │   │   │   ├── file-write.ts
│   │   │   │   ├── git-status.ts
│   │   │   │   ├── git-stage.ts
│   │   │   │   ├── git-commit.ts
│   │   │   │   └── ...
│   │   │   ├── pty/           # Infrastructure：PTY 进程封装
│   │   │   │   └── pty-host.ts        # node-pty 包装，唯一调用 node-pty 的地方
│   │   │   ├── bus/           # Service 层语义事件总线
│   │   │   │   └── event-bus.ts       # 见 §4.0
│   │   │   ├── terminal/      # Terminal 层（底层原语，见 §4.5）
│   │   │   │   ├── manager.ts         # TerminalManager
│   │   │   │   ├── active-terminal.ts # 运行中的 Terminal 对象
│   │   │   │   ├── ring-buffer.ts     # ring buffer（从 session 目录迁出）
│   │   │   │   └── broadcaster.ts     # Broadcaster 接口定义
│   │   │   ├── session/       # Session 层（业务封装，见 §4.6）
│   │   │   │   ├── manager.ts         # SessionManager
│   │   │   │   ├── active-session.ts  # 运行中的 Session 对象
│   │   │   │   ├── state-machine.ts   # Agent 状态机
│   │   │   │   └── lifecycle.ts       # 生命周期事件聚合
│   │   │   ├── hooks/         # Hooks Manager
│   │   │   │   ├── manager.ts
│   │   │   │   ├── merge-writer.ts  # 深度合并器
│   │   │   │   ├── bridge.ts         # bridge 脚本生成和部署
│   │   │   │   ├── endpoint.ts       # POST /internal/hooks/:event
│   │   │   │   └── runtime-json.ts   # runtime.json 读写
│   │   │   ├── workspace/     # 工作区管理
│   │   │   │   ├── manager.ts
│   │   │   │   ├── runtime-check.ts  # 启动前命令可用性校验
│   │   │   │   └── validator.ts
│   │   │   ├── fs/            # 文件系统
│   │   │   │   ├── watcher.ts        # chokidar wrapper
│   │   │   │   ├── tree.ts           # 文件树构建
│   │   │   │   └── file-io.ts        # read / write + baseHash 冲突检测
│   │   │   ├── git/           # Git wrapper
│   │   │   │   ├── cli.ts            # git 命令执行器
│   │   │   │   ├── status-parser.ts  # porcelain=v2 解析
│   │   │   │   ├── diff.ts
│   │   │   │   ├── commit.ts
│   │   │   │   └── worktree.ts       # Phase 3
│   │   │   ├── storage/       # SQLite 层
│   │   │   │   ├── db.ts
│   │   │   │   ├── migrations/
│   │   │   │   └── repositories/
│   │   │   ├── auth/          # Phase 2+
│   │   │   │   ├── middleware.ts
│   │   │   │   ├── session-store.ts
│   │   │   │   ├── ip-blocker.ts
│   │   │   │   └── password.ts
│   │   │   ├── supervisor/    # Phase 3
│   │   │   │   ├── scheduler.ts
│   │   │   │   ├── evaluator.ts
│   │   │   │   └── injector.ts
│   │   │   └── index.ts       # createServer() entry
│   │   └── package.json       # depends on core, providers
│   │
│   ├── web/                   # React SPA
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── app/
│   │   │   │   ├── router.tsx
│   │   │   │   └── providers.tsx     # Jotai Provider、i18n、theme
│   │   │   ├── atoms/         # Jotai atom 定义
│   │   │   │   ├── workspaces.ts
│   │   │   │   ├── sessions.ts
│   │   │   │   ├── terminals.ts
│   │   │   │   ├── git.ts
│   │   │   │   ├── fs.ts
│   │   │   │   ├── ui.ts       # atomWithStorage
│   │   │   │   └── connection.ts
│   │   │   ├── ws/            # WebSocket client
│   │   │   │   ├── client.ts
│   │   │   │   ├── reconnect.ts
│   │   │   │   └── subscription.ts
│   │   │   ├── features/      # 按功能分目录
│   │   │   │   ├── topbar/
│   │   │   │   ├── welcome/
│   │   │   │   ├── workspace/
│   │   │   │   ├── agent-panes/
│   │   │   │   ├── code-editor/
│   │   │   │   ├── git-panel/
│   │   │   │   ├── terminal-panel/
│   │   │   │   ├── command-palette/
│   │   │   │   ├── settings/
│   │   │   │   ├── focus-mode/
│   │   │   │   ├── notifications/
│   │   │   │   └── supervisor/    # Phase 3
│   │   │   ├── lib/
│   │   │   │   ├── i18n.ts
│   │   │   │   ├── shortcuts.ts
│   │   │   │   └── dispatch.ts    # 包装 WS command dispatch
│   │   │   ├── styles/        # 全局 CSS，Aurora Mint 设计系统
│   │   │   └── locales/
│   │   │       ├── zh.json
│   │   │       └── en.json    # Phase 2
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json       # depends on core
│   │
│   ├── hook-bridge/           # 发布时复制到 ~/.coder-studio/hooks/
│   │   ├── src/
│   │   │   ├── claude-bridge.js    # 单文件脚本，无外部依赖
│   │   │   └── codex-bridge.js
│   │   └── package.json
│   │
│   └── cli/                   # 发布入口
│       ├── src/
│       │   ├── bin.ts         # CLI argv 解析 → createServer → listen
│       │   └── embed.ts       # 把 web 构建产物作为静态资源服务
│       ├── package.json       # name: @coder-studio/cli, bin: coder-studio
│       └── dist/              # 最终 CLI 可发布产物目录
│
├── e2e/                       # Playwright
│   ├── fixtures/
│   ├── specs/
│   └── playwright.config.ts
│
└── docs/
    ├── PRD.md / PRD.zh-CN.md
    ├── mockups.html
    ├── visual-spec.html
    └── superpowers/
        ├── specs/
        │   └── 2026-04-13-coder-studio-design.md  # 本文档
        └── plans/         # writing-plans 产出的实施计划
```

### 2.2 包依赖关系

```
core  ◄──── providers
 ▲  ▲          ▲
 │  │          │
 │  └──────────┤
 │             │
 └─── web     server
              ▲
              │
             cli ◄──── hook-bridge (作为资源被拷贝)
```

**关键约束：**
- `core` 不依赖任何 Node 或 Browser API（纯 TS 逻辑 + Zod）
- `providers` 可以依赖 Node API（要写文件、读配置）
- `web` 不依赖 Node API
- `server` 和 `web` 之间**唯一耦合点**是 `core` 定义的协议 schema
- `cli` 是唯一会 `npm publish` 的包

### 2.3 构建与发布方案

本节定义 Coder Studio 的开发、生产构建和发布链路。目标是同时满足：

1. **开发效率高**：前端改动反馈快，后端本地开发重启快
2. **生产构建稳定**：最终产物边界清晰，避免多层构建链路带来的复杂度
3. **发布模型收敛**：最终只发布一个 CLI npm 包，减少分发和安装复杂度

#### 2.3.1 总体原则

1. **CLI 是唯一最终发布单元**  
   Coder Studio 最终只发布一个 npm CLI 包。`server` 不单独分发，`web` 也不单独分发；二者都作为 CLI 的内部装配产物存在。

2. **内部 package 用于源码组织，而非独立分发**  
   `core`、`providers`、`server`、`cli` 等 package 的职责是源码边界、依赖边界和类型边界。生产构建时，不要求每个内部 package 单独先产出 dist，再进行多级装配。

3. **生产构建以 CLI 为唯一 bundle 入口**  
   生产环境构建时，以 `cli` 为最终入口，通过 bundler 将内部 workspace 依赖一起打入最终 bundle。只有前端静态资源和少量非 JS 资源在最终阶段额外装配。

4. **三方依赖默认 external**  
   生产构建中，npm 三方依赖默认通过 `external` 策略排除，不打入最终 CLI bundle。这样可以降低 native 模块、动态加载、运行时路径解析等风险。

5. **构建脚本集中管理**  
   所有 dev/build/assemble/publish 相关脚本统一收敛到仓库级 `src/scripts/`。各 package 只保留业务源码和必要配置，不承载构建编排逻辑。

6. **不采用内部包 dist 中转链路**  
   不采用“每个内部 package 先各自 build 出 dist，再层层迁移装配”的保守型构建链路；生产构建统一以 CLI 为中心收敛。

#### 2.3.2 工具选型

| 层 | 选型 | 用途 |
|---|---|---|
| 前端开发 | **Vite dev server** | React 前端开发与 HMR |
| 前端生产构建 | **Vite build** | 生成浏览器静态资源 |
| 后端开发 | **tsx watch** | 本地 server 开发与热重启 |
| 生产构建 | **esbuild** | 以 CLI 为最终入口生成双产物 bundle |
| 包管理 | **pnpm workspaces** | monorepo 依赖管理 |
| 构建脚本语言 | **TypeScript** | `src/scripts/` 中统一实现构建逻辑 |

#### 2.3.3 开发链路

**前端开发：**
- 前端通过 Vite dev server 运行，负责 React 页面开发、Monaco / xterm 等浏览器侧依赖联调和 HMR 热更新。

**后端开发：**
- 后端通过 `tsx watch` 运行，负责 Fastify / WebSocket 服务本地开发，以及文件系统 / Git / PTY / Session 等 Node 侧能力调试。

**开发模式约束：**
- 开发环境中，前后端分离运行：前端由 Vite 提供 dev server，后端由 `tsx watch` 直接运行 TypeScript 源码，root 层提供统一命令并行启动两者。

#### 2.3.4 生产构建链路

**前端构建：**
- 前端通过 `Vite build` 独立生成静态资源目录：

```text
packages/web/dist/
├── index.html
└── assets/...
```

- 该产物不直接发布，而是在最终阶段复制到 CLI 产物目录供 server 加载。

**CLI 构建：**
- CLI 是唯一最终生产构建入口。构建时：
  1. 以 `packages/cli` 的入口文件作为 esbuild 入口
  2. 输出 **ESM bundle** 和 **CJS bundle** 两份产物
  3. 将内部 workspace 依赖一并打入最终 bundle，包括 `server`、`core`、`providers` 及其他内部 TS/JS 依赖
  4. 将所有三方依赖标记为 `external`
  5. 在 bundle 完成后，将 `packages/web/dist/` 复制到 CLI 最终产物目录

**最终可发布目录：**

```text
packages/cli/dist/
├── bin.js
├── esm/
│   └── index.mjs
├── cjs/
│   └── index.js
└── web/
    ├── index.html
    └── assets/...
```

其中：
- `bin.js`：CLI 默认执行入口 wrapper
- `esm/index.mjs`：ESM bundle
- `cjs/index.js`：CJS bundle
- `web/`：前端静态资源
- 若后续存在非 JS 资源（模板、图标、音频等），也统一装配到此目录中

#### 2.3.5 bundle 边界

**会被 bundle 的内容：**
- `cli` 入口源码
- `server` 源码
- `core` 源码
- `providers` 源码
- 其他内部 workspace TS/JS 依赖

**不会被 bundle 的内容：**
- 所有 npm 三方依赖（通过 `external` 排除）
- 前端静态资源（通过 `Vite build` 单独生成）
- 少量非 JS 静态资源（通过 copy 装配）

**原则：**
- 生产构建中，bundle 只聚焦内部源码；对外部依赖和非 JS 资源不追求“全量塞进一个 JS 文件”，而是追求**边界清晰、构建稳定、运行时可控**。

#### 2.3.6 命令层设计

所有开发与构建命令统一从仓库根目录执行，`root package.json` 只暴露统一入口；实际逻辑由 `src/scripts/` 中的 TypeScript 脚本实现。

| 命令 | 作用 |
|---|---|
| `pnpm dev:web` | 启动前端开发服务器 |
| `pnpm dev:server` | 启动后端开发服务器（`tsx watch`） |
| `pnpm dev` | 并行启动前后端开发环境 |
| `pnpm build:web` | 构建前端静态资源 |
| `pnpm build:cli` | 构建 CLI 双产物并装配 web 静态资源 |
| `pnpm build` | 执行完整生产构建（先 `build:web`，再 `build:cli`） |
| `pnpm publish:cli` | 校验 CLI 最终产物并执行发布 |

**设计原则：**
1. root 命令是唯一对人入口
2. 脚本实现统一在 `src/scripts/`
3. package 内只保留业务源码、配置和必要入口，不承载构建编排脚本

#### 2.3.7 `src/scripts/` 目录结构

建议的脚本目录如下：

```text
src/scripts/
├── dev.ts
├── dev-web.ts
├── dev-server.ts
├── build.ts
├── build-web.ts
├── build-cli.ts
├── publish-cli.ts
└── shared/
    ├── paths.ts
    ├── esbuild.ts
    ├── copy.ts
    ├── process.ts
    └── logger.ts
```

**脚本职责：**
- `dev-web.ts`：启动 Vite dev server
- `dev-server.ts`：以 `tsx watch` 启动后端开发服务
- `dev.ts`：并行拉起 web + server，并统一处理日志前缀、退出信号和失败退出
- `build-web.ts`：调用 Vite build，输出 `packages/web/dist/`
- `build-cli.ts`：以 CLI 为最终入口调用 esbuild，输出 ESM/CJS bundle，external 三方依赖，bundle 内部 workspace 依赖，并把 `packages/web/dist/` 复制到 CLI 最终产物目录
- `build.ts`：串行执行 `build-web` → `build-cli`
- `publish-cli.ts`：发布前检查最终产物完整性，再执行 npm/pnpm publish

#### 2.3.8 CLI package 导出约定

CLI package 的 `package.json` 采用如下方向：
- `type: "module"`
- `bin` 指向：`./dist/bin.js`
- `exports` 只暴露 `"."`
- `exports.import` 指向：`./dist/esm/index.mjs`
- `exports.require` 指向：`./dist/cjs/index.js`
- `files` 仅包含：`dist`

CLI 默认执行入口 `dist/bin.js` 是一个 wrapper，并固定转发到 ESM 主入口 `dist/esm/index.mjs`。模块消费场景下，通过 `exports` 提供 ESM/CJS 双格式兼容。

#### 2.3.9 发布规则

1. **只发布 CLI package**
2. **发布边界始终以 `packages/cli/dist/` 为准**
3. **发布前必须确保以下文件存在：**
   - `packages/cli/dist/bin.js`
   - `packages/cli/dist/esm/index.mjs`
   - `packages/cli/dist/cjs/index.js`
   - `packages/cli/dist/web/index.html`
4. **不要求内部 package 单独产出可分发 dist**
5. **`build:web` 与 `build:cli` 是唯一允许进入正式发布链路的产物生成步骤**

发布：`cd packages/cli && pnpm publish --access public`

---

## 3. 协议层（WebSocket）

### 3.1 消息分类

所有消息 JSON 编码（Phase 4 可评估 MessagePack）。三类消息：

| 类型 | 方向 | 用途 |
|---|---|---|
| `command` | client → server | 发起动作，期望响应 |
| `result` | server → client | Command 的响应（成功或错误） |
| `event` | server → client | 服务端主动推送状态变化 |
| `subscribe` | client → server | 声明关注的 topic（不期望响应） |
| `unsubscribe` | client → server | 取消订阅 |
| `resync` | client → server | 重连后请求补发缺失事件 |
| `ping` / `pong` | 双向 | 保活（WS 内置机制之外的应用层心跳） |

### 3.2 消息 schema (Zod)

```typescript
// packages/core/src/protocol/messages.ts

const CommandMessage = z.object({
  kind: z.literal("command"),
  id: z.string().uuid(),
  op: z.string(),                    // 如 "session.create"
  args: z.unknown(),
});

const ResultMessage = z.object({
  kind: z.literal("result"),
  id: z.string().uuid(),             // 对应 Command 的 id
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }).optional(),
});

const EventMessage = z.object({
  kind: z.literal("event"),
  topic: z.string(),                 // 如 "workspace.<id>.session.<id>.state"
  seq: z.number(),                   // topic 内单调递增
  timestamp: z.number(),
  data: z.unknown(),
});

const SubscribeMessage = z.object({
  kind: z.literal("subscribe"),
  topics: z.array(z.string()),       // 支持 glob: "workspace.42.*"
});

const UnsubscribeMessage = z.object({
  kind: z.literal("unsubscribe"),
  topics: z.array(z.string()),
});

const ResyncMessage = z.object({
  kind: z.literal("resync"),
  lastSeen: z.record(z.string(), z.number()),  // topic → lastSeq
});

export const ClientMessage = z.discriminatedUnion("kind", [
  CommandMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  ResyncMessage,
]);

export const ServerMessage = z.discriminatedUnion("kind", [
  ResultMessage,
  EventMessage,
]);
```

### 3.3 Topic 命名规范

分层命名 + glob 订阅：

```
connection.status                                  // 连接状态
workspace.*                                        // 全部工作区变更
workspace.<id>.meta                                // 单工作区元数据
workspace.<id>.fs.dirty                            // 文件树变脏
workspace.<id>.git.state                           // Git 状态变更
workspace.<id>.session.*                           // 全部会话
workspace.<id>.session.<sid>.state                 // 单会话状态
workspace.<id>.session.<sid>.progress              // 进度事件
workspace.<id>.terminal.<tid>.output               // 终端输出（高频）
workspace.<id>.supervisor.<sid>.cycle              // Supervisor 周期
```

订阅示例：
- 切换到工作区 42 → 订阅 `workspace.42.*`
- 专注模式隐藏终端面板 → 取消 `workspace.42.terminal.*.output`（省带宽）

### 3.4 Command 列表（Phase 1）

| Op | Args | Result | 描述 |
|---|---|---|---|
| `workspace.list` | — | `Workspace[]` | 拉取工作区列表（启动时调用） |
| `workspace.open` | `{ path, targetRuntime }` | `Workspace` | 打开一个目录作为工作区 |
| `workspace.close` | `{ id }` | `void` | 关闭工作区（终止所有会话） |
| `workspace.snapshot` | `{ id }` | `WorkspaceSnapshot` | 全量拉取某工作区状态（用于 resync 失败后） |
| `runtime.check` | `{ path, targetRuntime }` | `RuntimeCheckResult` | 校验目标运行环境 |
| `session.create` | `{ workspaceId, providerId, draft? }` | `Session` | 创建 Agent 会话 |
| `session.stop` | `{ sessionId }` | `void` | 中断会话 |
| `session.resume` | `{ sessionId }` | `Session` | 恢复归档的会话 |
| `session.remove` | `{ sessionId }` | `void` | 从工作区移除会话（不可用状态时） |
| `terminal.input` | `{ terminalId, bytes }` | `void` | 向 PTY 写入用户输入 |
| `terminal.resize` | `{ terminalId, cols, rows }` | `void` | 终端大小变化 |
| `terminal.create` | `{ workspaceId }` | `Terminal` | 创建新 shell 终端 |
| `terminal.close` | `{ terminalId }` | `void` | 关闭终端 |
| `file.readTree` | `{ workspaceId, subPath? }` | `FileNode` | 读取文件树（懒加载一层） |
| `file.read` | `{ workspaceId, path }` | `{ content, baseHash, encoding }` | 读文件内容 |
| `file.write` | `{ workspaceId, path, content, baseHash }` | `{ newHash }` | 写文件（冲突检测） |
| `file.search` | `{ workspaceId, query }` | `FileNode[]` | 文件名搜索 |
| `git.status` | `{ workspaceId }` | `GitStatus` | 拉取 git 状态 |
| `git.diff` | `{ workspaceId, path, staged }` | `string` | 获取某文件的 diff |
| `git.stage` | `{ workspaceId, paths }` | `void` | 暂存文件 |
| `git.unstage` | `{ workspaceId, paths }` | `void` | 取消暂存 |
| `git.discard` | `{ workspaceId, paths }` | `void` | 丢弃变更 |
| `git.commit` | `{ workspaceId, message }` | `{ sha }` | 提交 |
| `settings.get` | — | `Settings` | 读取设置 |
| `settings.update` | `{ patch }` | `Settings` | 更新设置 |
| `provider.list` | — | `ProviderInfo[]` | 列出全部 Provider + 能力等级 |
| `provider.injectHooks` | `{ providerId }` | `InjectResult` | 手动触发 hooks merge-write |
| `tab.takeover` | — | `void` | 强制接管 writer 权限 |

### 3.5 Command 演进

新 Command 只增不改。如果要修改语义：
- 加一个新 Op 名（如 `session.create.v2`）
- 旧 Op 保留兼容实现，直到没有前端代码使用
- 因为前后端一起发布，版本分叉一般不发生；仅在用户持久化了"历史命令参数"时需要兼容

### 3.6 事件列表（Phase 1 主要事件）

| Topic | Payload | 触发时机 |
|---|---|---|
| `connection.status` | `{ status: "connected"/"disconnected"/"takeover" }` | 客户端连接状态 |
| `workspace.<id>.meta` | `Workspace` | 工作区属性变更 |
| `workspace.<id>.fs.dirty` | `{ reason }` | 文件系统有变更（不含具体内容） |
| `workspace.<id>.git.state` | `GitStatus` | git 状态刷新 |
| `workspace.<id>.session.<sid>.state` | `{ state, resumeId?, lastActive }` | 会话状态转换 |
| `workspace.<id>.session.<sid>.progress` | `{ pct, stage }` | 进度更新（仅 Full 模式） |
| `workspace.<id>.terminal.<tid>.output` | `{ chunk, encoding: "base64", size }` | PTY 输出 |
| `workspace.<id>.terminal.<tid>.exit` | `{ code }` | PTY 进程退出 |
| `notification.toast` | `{ level, title, body }` | 服务端主动通知 |

### 3.7 断线重连协议

**serverInstanceId：** server 每次启动生成一个 UUID（写入 `runtime.json`），client 在 `connection.ready` 事件中收到。它是 resync 的前置条件：

```
1. WS 断开 → 前端进入 reconnecting 状态 (UI 顶栏显示 "连接中...")
2. 指数退避 (1s → 2s → 4s → ... → max 30s) 重连
3. 连接建立 → server 立即下发 connection.ready event:
   { kind: "event", topic: "connection.ready",
     data: { serverInstanceId: "<uuid>", serverStartedAt: <ts> } }
4. 前端比对 serverInstanceId：
   a. 相同 → 发送 resync 尝试增量补发
      { kind: "resync", lastSeen: { "workspace.42.session.abc.state": 17, ... } }
   b. 不同（server 重启过）→ 跳过 resync，直接清空所有服务端投影 atom，
      对当前活跃 workspace 执行 workspace.snapshot 全量重建
5. Resync 分支：server 按 topic 检查 ring buffer
   - lastSeq 在窗口内 → 按序补发缺失事件 → 最后一条带 { final: true }
   - lastSeq < 窗口最老 seq → 返回 { kind: "result", error: { code: "resync_too_old", topic } }
     → 前端对该 topic 走 snapshot 路径，其它 topic 继续
6. 所有补发/快照完成 → connection.status → "connected" → 解锁 UI 写操作
```

**写操作锁：** 断线期间前端所有 command 调用被排入队列，重连完成后按顺序重放。两条豁免：
- 纯查询 command（`workspace.list` 等）如果结果只会被 snapshot 覆盖，直接丢弃
- 如果某个 command 在断线期已被用户取消（如切换到别的工作区），从队列中移除

**UI 状态显示：**

| 内部状态 | 顶栏文案 | 可写 |
|---|---|---|
| `connecting` | "连接中..." | 否 |
| `resyncing` | "同步中..." | 否 |
| `connected` | 不显示 | 是 |
| `reconnecting` | "连接中（第 N 次）" | 否 |
| `failed` | "连接失败，点击重试" | 否 |

### 3.8 WebSocket 保活与写回压

**心跳参数：**

| 参数 | 值 | 备注 |
|---|---|---|
| Ping 间隔（前台 tab） | 20s | `document.visibilityState === "visible"` |
| Ping 间隔（后台 tab） | 45s | Chrome 后台 timer throttling 下仍能工作 |
| Pong 超时 | 10s | 超时即认定连接死亡，主动 close → 进入重连 |
| Server → Client ping | 30s | 服务端也主动 ping，双向检测半开连接 |
| 空闲连接最大保留 | 10min | Server 侧对"既无心跳也无消息"的连接强制 close |

**两边都要 ping：** 只靠 client ping 解决不了"client 发现不了 server 已死"的场景（TCP 连接看似健康）。Phase 1 用 WebSocket 协议自带的 ping/pong 帧（`ws` lib 支持）+ 应用层 `ping`/`pong` 消息双保险。

**WS 写回压（backpressure）：**

高频流（`terminal.*.output`）叠加慢客户端会让 `ws.bufferedAmount` 无限增长。策略：

```typescript
// packages/server/src/ws/client.ts
class WsClient {
  private readonly HIGH_WATER = 4 * 1024 * 1024;  // 4 MiB
  private readonly CRITICAL  = 16 * 1024 * 1024;  // 16 MiB
  private droppedOutputBytes = 0;

  sendEvent(topic: string, payload: unknown) {
    const buffered = this.conn.bufferedAmount;

    if (buffered > this.CRITICAL) {
      // 灾难位：强制断开，让 client 走重连+resync
      this.conn.close(4003, "backpressure_critical");
      return;
    }

    if (buffered > this.HIGH_WATER && isHighFreqTopic(topic)) {
      // 丢弃策略：只丢"可丢"事件（terminal.output），语义事件永远送
      this.droppedOutputBytes += estimateSize(payload);
      return;
    }

    this.conn.send(encode({ topic, payload }));
  }
}
```

**哪些 topic 可丢：**

| Topic | 可丢？ | 理由 |
|---|---|---|
| `terminal.*.output` | ✅ | 可从 ring buffer 重放；client resync 能恢复 |
| `terminal.*.exit` | ❌ | 退出状态不可丢 |
| `session.*.state` | ❌ | 状态机转换必须按序 |
| `session.*.progress` | ⚠️ | 高频时可跳过中间进度，保留终值 |
| `workspace.*.meta` | ❌ | 元数据变更必须送达 |
| `fs.dirty` | ⚠️ | 可合并成一个 dirty 信号 |
| `git.state` | ❌ | Git 状态必须准确 |
| `notification.toast` | ❌ | 用户通知不可丢 |

**丢弃时的恢复：** 当 `bufferedAmount` 回落到高水位线之下，下一次 `terminal.*.output` 事件 payload 里附带 `{ droppedBytes: N }` 字段，前端 xterm 插入一行灰色 `[... N bytes skipped, fetching from buffer ...]`，并向 server 发一次 `terminal.replay` 命令从 ring buffer 拉回完整数据。

**Phase 1 简化：** `terminal.replay` 可以先不实现，丢弃时只显示提示行。Phase 2 再补。

---

## 4. 服务端架构

### 4.0 分层与耦合规则

服务端按四层组织，**import 只能向下**，反向禁止。违反这条规则的 PR 一律拒绝；CI 用 `eslint-plugin-import` + `zones` 强制。

```
┌─────────────────────────────────────────────────────┐
│  Transport 层  ws/ · commands/                      │  handlers、hub、dispatch
├─────────────────────────────────────────────────────┤
│  Service 层   session/ · workspace/ · hooks/ ·      │  业务逻辑、状态机、生命周期
│               supervisor/ (P3)                       │
├─────────────────────────────────────────────────────┤
│  Infrastructure 层  fs/ · git/ · storage/ · auth/ · │  外部系统封装
│                     pty/                             │
├─────────────────────────────────────────────────────┤
│  Core (@coder-studio/core, providers/)              │  纯类型、契约、Provider 定义
└─────────────────────────────────────────────────────┘
```

**依赖方向规则：**

| 规则 | 说明 |
|---|---|
| Transport → Service | Command handler 调用 manager 方法；不能反向 |
| Service → Infrastructure | SessionManager 调 TerminalManager 调 PtyHost；反之禁止 |
| Service → Service | 只允许**单向**调用（SessionManager → TerminalManager、WorkspaceManager → SessionManager），环依赖禁止 |
| Infrastructure 互不依赖 | fs 不调 git、storage 不调 fs 等 |
| 任何层 → Core | 允许 |
| Core → 任何层 | 禁止（保持纯类型） |

**Event Bus（混合 C 方案）**：不是万能消息总线，只承载"Service 层语义事件"：

```typescript
// packages/server/src/bus/event-bus.ts
type DomainEvent =
  | { type: "session.state.changed"; sessionId: string; from: SessionState; to: SessionState }
  | { type: "session.lifecycle"; sessionId: string; event: "started"|"turn_completed"|"stopped" }
  | { type: "workspace.meta.changed"; workspaceId: string; patch: Partial<Workspace> }
  | { type: "git.state.changed"; workspaceId: string }
  | { type: "fs.dirty"; workspaceId: string; reason: string };

class EventBus {
  emit(event: DomainEvent): void { /* 同步调用所有订阅者 */ }
  on(type: DomainEvent["type"], handler: Handler): Unsubscribe {}
}
```

**什么走 Event Bus，什么不走：**

| 数据 | 走 Event Bus | 原因 |
|---|---|---|
| PTY 输出流 (`terminal.*.output`) | ❌ 直调 Broadcaster | 每秒数十次，多一跳没价值 |
| xterm resize / input | ❌ 直调 TerminalManager | 短链路同步调用 |
| Session 状态机转换 | ✅ | Supervisor、通知、UI 都要订阅 |
| 会话生命周期 (`session_started` / `turn_completed`) | ✅ | 同上 |
| Workspace 元数据变更 | ✅ | UI 多处展示 |
| Git 状态刷新 | ✅ | 文件树 badge、Git 面板都要 |
| FS dirty 信号 | ✅ | 节流后只是一个信号 |

**订阅者的角色：**

- `WsHub` 订阅全部 DomainEvent，按 topic 规则转换为 WS 事件广播给前端
- `SupervisorScheduler`（Phase 3）只订阅 `session.lifecycle`
- `NotificationDispatcher` 订阅 `session.lifecycle` 的 `turn_completed`

`EventBus` 与 `Broadcaster` 的生命周期都是 server 进程级别，由 `createServer` 统一构造并注入。

**Broadcaster 接口**（给高频流式数据用，解耦 manager 和具体 ws 实现）：

```typescript
interface Broadcaster {
  broadcast(topic: string, data: unknown): void;
}
// 唯一实现：WsHub。但 TerminalManager 只看到 Broadcaster 接口，便于测试替换。
```

**DI 与构造顺序：**

`createServer` 是唯一手动接线的地方，按依赖顺序自底向上构造：

```typescript
// packages/server/src/index.ts
export async function createServer(config: ServerConfig): Promise<Server> {
  // Infrastructure
  const db = await openDatabase(config.dataDir);
  await runMigrations(db);
  const runtime = new RuntimeJson(config.runtimeDir);
  const ptyHost = new PtyHost();

  // 协作基础设施
  const eventBus = new EventBus();
  const wsHub = new WsHub({ eventBus });          // WsHub 既是 Broadcaster，也订阅 eventBus
  const broadcaster: Broadcaster = wsHub;

  // Service（按依赖顺序）
  const terminalMgr = new TerminalManager({ ptyHost, broadcaster, db });
  const sessionMgr  = new SessionManager({ terminalMgr, eventBus, db, providerRegistry });
  const workspaceMgr = new WorkspaceManager({ db, sessionMgr, terminalMgr, eventBus });
  const hooksMgr    = new HooksManager({ config, runtime, sessionMgr });

  // Transport
  const app = buildFastifyApp({
    db, wsHub, hooksMgr,
    commandContext: { workspaceMgr, sessionMgr, terminalMgr, hooksMgr, db },
  });

  // bootstrap
  await hooksMgr.deployBridgeScripts();
  for (const provider of providerRegistry.all()) await hooksMgr.ensureGlobalConfig(provider);
  await app.listen({ host: config.host, port: config.port });

  return { app, db, runtime, stop: async () => { /* 反向顺序关闭 */ } };
}
```

**Command handler 的 `ctx`：**

```typescript
interface CommandContext {
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  terminalMgr: TerminalManager;
  hooksMgr: HooksManager;
  db: Database;
  // 不包含 wsHub / eventBus —— handler 不应直接广播；副作用由 service 自己发 DomainEvent
}
```

**测试 seam：**

| 被测对象 | Mock 替换 |
|---|---|
| SessionManager 状态机 | `FakeTerminalManager`（不 spawn 真 PTY），手动注入 hook event |
| TerminalManager 输出广播 | `FakeBroadcaster` 收集 `broadcast` 调用 |
| Command handler | 注入 fake ctx；断言 manager 方法被调用 |
| WsHub 订阅转发 | 直接 `eventBus.emit(...)`，断言 WS 客户端收到对应 topic |
| 事件总线本身 | 纯内存，无需 mock |

---

### 4.1 启动流程

完整的 `createServer` 骨架见 §4.0 DI 段落。这里列出启动步骤的语义顺序：

1. **Infrastructure 就绪**：打开 SQLite + 跑迁移 → 写 `runtime.json`（port/token）→ 初始化 PtyHost
2. **协作基础设施**：构造 `EventBus`、`WsHub`
3. **Service 装配**（自底向上）：`TerminalManager` → `SessionManager` → `WorkspaceManager` → `HooksManager`
4. **Bootstrap 副作用**：部署 bridge 脚本；对每个已注册 Provider 执行全局配置 merge-write
5. **Transport 启动**：`buildFastifyApp` 注册路由/中间件/WS → `app.listen`
6. **返回 server 句柄**：提供 `stop()`，按反向顺序优雅关闭（先 transport、再 service、最后 infrastructure）

### 4.2 Fastify App 布局

```typescript
// packages/server/src/app.ts
export function buildFastifyApp(deps: Deps): FastifyInstance {
  const app = Fastify({ logger: deps.logger });
  
  // 认证中间件（Phase 1 是空 passthrough；Phase 2 实现）
  app.register(authPlugin, { config: deps.config });
  
  // Static: web 构建产物 (cli 包构建时把 web/dist 拷进来)
  app.register(fastifyStatic, { root: deps.webRoot, prefix: "/" });
  
  // 内部 hooks endpoint (不经过 auth)
  app.register(hooksEndpointPlugin, { hooksManager: deps.hooksManager });
  
  // WebSocket
  app.register(fastifyWebsocket);
  app.get("/ws", { websocket: true }, (connection, req) => {
    deps.wsHub.handleConnection(connection, req);
  });
  
  // Health check
  app.get("/healthz", async () => ({ ok: true }));
  
  return app;
}
```

### 4.3 WebSocket Hub

单 writer 强制 + 订阅路由:

```typescript
// packages/server/src/ws/hub.ts
class WsHub {
  private clients = new Map<ClientId, WsClient>();
  private writerId: ClientId | null = null;
  
  handleConnection(conn: WebSocket, req: FastifyRequest) {
    const client = new WsClient(conn, generateId());
    
    // Phase 1: 单 writer 强制
    if (this.writerId && this.writerId !== client.id) {
      // 拒绝
      client.send({ kind: "event", topic: "connection.status", 
                    data: { status: "rejected", reason: "another_tab_active" } });
      setTimeout(() => conn.close(4001, "another_tab_active"), 100);
      return;
    }
    
    this.writerId = client.id;
    this.clients.set(client.id, client);
    
    client.onMessage((msg) => this.routeMessage(client, msg));
    client.onClose(() => this.handleClose(client));
  }
  
  // 处理 tab.takeover command
  async takeover(newClient: WsClient) {
    const old = this.clients.get(this.writerId);
    if (old) {
      old.send({ kind: "event", topic: "connection.status", 
                 data: { status: "takeover" } });
      old.close(4002, "takeover");
      this.clients.delete(old.id);
    }
    this.writerId = newClient.id;
  }
  
  broadcast(topic: string, payload: unknown) {
    for (const client of this.clients.values()) {
      if (client.subscribesTo(topic)) {
        client.sendEvent(topic, payload);
      }
    }
  }
}
```

### 4.4 Command Dispatch

每个 Command 注册到一个 map：

```typescript
// packages/server/src/ws/dispatch.ts
type CommandHandler<A, R> = (args: A, ctx: CommandContext) => Promise<R>;

const handlers: Record<string, CommandHandler<any, any>> = {
  "workspace.list": workspaceListHandler,
  "workspace.open": workspaceOpenHandler,
  "session.create": sessionCreateHandler,
  // ...
};

async function dispatch(msg: CommandMessage, ctx: CommandContext): Promise<ResultMessage> {
  const handler = handlers[msg.op];
  if (!handler) {
    return { kind: "result", id: msg.id, ok: false, 
             error: { code: "unknown_op", message: `Unknown op: ${msg.op}` } };
  }
  try {
    const schema = schemas[msg.op];          // Zod schema for this op
    const args = schema.parse(msg.args);      // 校验
    const data = await handler(args, ctx);    // 执行
    return { kind: "result", id: msg.id, ok: true, data };
  } catch (err) {
    return { kind: "result", id: msg.id, ok: false, 
             error: normalizeError(err) };
  }
}
```

每个 handler 只做业务逻辑，不知道 WS 细节；便于单测。

### 4.5 Terminal 层（TerminalManager）

Terminal 是**底层原语**：一个 PTY 进程 + ring buffer + 输入输出通道。它对 Agent / Provider / Session 状态机一无所知。

**职责清单：**
- 创建/销毁 PTY，管理进程句柄
- 维护 ring buffer（2 MiB/终端），供断线补发
- 把 PTY 输出**直接**广播到 `workspace.<wsid>.terminal.<tid>.output`（不走 Event Bus）
- 接收 `terminal.input` / `terminal.resize` 命令
- PTY 退出时广播 `workspace.<wsid>.terminal.<tid>.exit`，并从内存表中移除
- 持久化 Terminal 元数据到 SQLite（不持久化输出流，Phase 1）

**不负责：** Provider 解析、resume_id、hook 事件、Agent 状态机——全部在 Session 层。

**关键生命周期规则（Phase 1 硬性约束）：**

1. **PTY 不因 client 断开而终止**：Terminal 被 server 进程持有，WS 连接断开后 PTY 继续运行，输出照常写入 ring buffer。浏览器刷新/关闭/休眠期间的 Agent 工作完整保留，重连后通过 resync 或 replay 补回
2. **PTY 只在三种情况下被终止**：
   - 用户显式 `terminal.close` / `session.stop`
   - 底层 PTY 自己 exit（命令结束、用户在 shell 里敲 `exit`）
   - Server 优雅关闭（见 §4.13）
3. **多 client 共享同一个 PTY**：Phase 1 单 writer，其它 observer 不存在；但架构上 TerminalManager 本就不关心有几个订阅者，Phase 3 上 writer/observer 时零改动
4. **没有客户端订阅时 PTY 仍然输出**：ring buffer 会正常累计（循环覆盖），客户端订阅后从最新 seq 开始追

**初始尺寸握手：**

PTY spawn 时用默认 cols=120 / rows=30（常见终端尺寸）。Client 挂载 xterm 后**立即**发一个 `terminal.resize`，后续的 output 按真实尺寸排版。首屏可能有 <200ms 的错位，xterm 的重排能吸收。

```typescript
// 客户端 XtermHost useEffect 里
term.current.open(container);
fit.fit();
dispatch({ op: "terminal.resize",
           args: { terminalId, cols: term.cols, rows: term.rows } });
```

**Spawn 失败的两种路径：**

```typescript
create(spec: TerminalSpec): Terminal {
  const id = generateId();
  let pty: PtyProcess;
  try {
    // 路径 1：同步失败（命令不存在、路径无权限）
    pty = this.deps.ptyHost.spawn(spec.argv, { cwd, env, cols, rows });
  } catch (err) {
    throw new TerminalSpawnError("spawn_failed_sync", err);
  }

  const active = new ActiveTerminal({ id, spec, pty, ringBuffer: new RingBuffer(2 << 20) });
  this.terminals.set(id, active);
  this.deps.db.terminals.insert(active.toRow());

  // 路径 2：spawn 成功但 PTY 立即 exit（shebang 错误、启动脚本报错）
  // onExit 在 <100ms 内触发 → Session 层捕捉 exitCode ≠ 0 → 进入 unavailable
  // 此时 create(...) 已经返回了 DTO，异步 exit 事件走广播链路

  this.wireEvents(active);
  return active.toDTO();
}
```

Session 层判断"spawn 是否成功"的规则：`create` 返回后设置一个 1s 宽限期定时器，期间若 `terminal.exit` 事件到达 → 认为启动失败 → session 进入 `unavailable`；1s 后仍未 exit 或已收到 `SessionStart` hook → 视为启动成功。

```typescript
// packages/server/src/terminal/manager.ts
interface TerminalSpec {
  workspaceId: string;
  kind: "agent" | "shell";
  argv: string[];
  cwd: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  title?: string;
}

class TerminalManager {
  private terminals = new Map<TerminalId, ActiveTerminal>();

  constructor(private deps: {
    ptyHost: PtyHost;
    broadcaster: Broadcaster;
    db: Database;
  }) {}

  create(spec: TerminalSpec): Terminal {
    const id = generateId();
    const pty = this.deps.ptyHost.spawn(spec.argv, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      cols: spec.cols ?? 120,
      rows: spec.rows ?? 30,
    });

    const ringBuffer = new RingBuffer(2 * 1024 * 1024);
    const active = new ActiveTerminal({ id, spec, pty, ringBuffer });

    pty.onData((data) => {
      const { seq } = ringBuffer.append(data);
      this.deps.broadcaster.broadcast(
        `workspace.${spec.workspaceId}.terminal.${id}.output`,
        { chunk: data.toString("base64"), size: data.length, seq },
      );
    });

    pty.onExit(({ exitCode }) => {
      active.alive = false;
      active.exitCode = exitCode;
      this.deps.broadcaster.broadcast(
        `workspace.${spec.workspaceId}.terminal.${id}.exit`,
        { code: exitCode },
      );
      // 保留 ActiveTerminal 对象 1s 供最后一次 replay，然后清理
      setTimeout(() => this.terminals.delete(id), 1000);
      this.deps.db.terminals.markEnded(id, Date.now(), exitCode);
    });

    this.terminals.set(id, active);
    this.deps.db.terminals.insert(active.toRow());
    return active.toDTO();
  }

  write(terminalId: TerminalId, bytes: Buffer): void {
    const t = this.terminals.get(terminalId);
    if (!t || !t.alive) throw new TerminalNotAliveError();
    t.pty.write(bytes);
  }

  resize(terminalId: TerminalId, cols: number, rows: number): void {
    const t = this.terminals.get(terminalId);
    if (!t || !t.alive) return;  // resize 宽容失败
    t.pty.resize(cols, rows);
  }

  kill(terminalId: TerminalId, signal: NodeJS.Signals = "SIGTERM"): void {
    const t = this.terminals.get(terminalId);
    t?.pty.kill(signal);
  }

  get(terminalId: TerminalId): ActiveTerminal | undefined {
    return this.terminals.get(terminalId);
  }

  replay(terminalId: TerminalId, lastSeq: number): ReplayResult {
    const t = this.terminals.get(terminalId);
    if (!t) return { status: "unknown" };
    return t.ringBuffer.replayFrom(lastSeq);
  }
}
```

**Ring Buffer（Terminal 层私有设施）：**

```typescript
// packages/server/src/terminal/ring-buffer.ts
class RingBuffer {
  private buf: Buffer;
  private writePos = 0;
  private totalBytes = 0;  // 累计字节数 → 充当 seq

  constructor(private size: number) {
    this.buf = Buffer.alloc(size);
  }

  append(chunk: Buffer): { seq: number } {
    // 环形写入
    this.totalBytes += chunk.length;
    return { seq: this.totalBytes };
  }

  replayFrom(lastSeq: number): { status: "ok"; data: Buffer; seq: number } | { status: "too_old" } {
    if (this.totalBytes - lastSeq > this.size) return { status: "too_old" };
    // 抽取 lastSeq..totalBytes 的字节
    // ...
    return { status: "ok", data: /* ... */, seq: this.totalBytes };
  }

  snapshot(): Buffer { /* 当前全部有效字节 */ }
}
```

Phase 4 可以把 `RingBuffer` 换成 `PersistentBuffer`（mmap / 磁盘 tail），对上层接口不变。

### 4.6 Session 层（SessionManager）

Session 是**业务封装**：在一个 agent-kind Terminal 之上叠加 Agent 领域语义。

**职责清单：**
- 通过 `providerRegistry` 查 Provider 定义，构造 `argv` / `cwd` / `env`
- **委托** `TerminalManager.create(...)` 拿到 Terminal，记住 `terminalId`（一对一）
- 维护 Agent 状态机 (`starting → running → idle → busy → ended`)
- 消化 hook 事件，更新 resume_id / lifecycle / 进度
- 向 Event Bus 发布 `session.state.changed` / `session.lifecycle` 语义事件
- 持久化 Session 元数据，不持久化 Terminal 元数据（Terminal 层管）
- 处理 `session.stop` / `session.resume`

**不负责：** PTY 的读写、ring buffer、xterm output 广播——这些属于 Terminal 层。

```typescript
// packages/server/src/session/manager.ts
class SessionManager {
  private sessions = new Map<SessionId, ActiveSession>();

  constructor(private deps: {
    terminalMgr: TerminalManager;
    eventBus: EventBus;
    db: Database;
    providerRegistry: ProviderRegistry;
  }) {}

  async create(req: CreateSessionRequest): Promise<Session> {
    const provider = this.deps.providerRegistry.get(req.providerId);
    if (!provider) throw new UnknownProviderError(req.providerId);

    const sessionId = generateId();
    const cmd = provider.buildCommand(req.config, {
      workspacePath: req.workspace.path,
      sessionId,
    });

    // 申请底层 Terminal（不直接 spawn PTY）
    const terminal = this.deps.terminalMgr.create({
      workspaceId: req.workspaceId,
      kind: "agent",
      argv: cmd.argv,
      cwd: cmd.cwd,
      env: { ...cmd.env, CODER_STUDIO_SESSION_ID: sessionId },
      title: provider.displayName,
    });

    const active = new ActiveSession({
      id: sessionId,
      workspaceId: req.workspaceId,
      providerId: req.providerId,
      terminalId: terminal.id,
      capability: provider.capability,
      state: "starting",
    });

    // Terminal 意外退出 → Session 也结束
    this.subscribeTerminalExit(active);

    this.sessions.set(sessionId, active);
    this.deps.db.sessions.insert(active.toRow());
    this.emitStateChanged(active, null, "starting");
    return active.toDTO();
  }

  // 被 HooksManager 调用
  onHookEvent(sessionId: SessionId, event: ProviderHookEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;  // orphan event
    const prev = session.state;
    session.applyHookEvent(event);  // 内部状态机
    if (session.state !== prev) this.emitStateChanged(session, prev, session.state);
    if (event.kind === "Stop") {
      this.deps.eventBus.emit({
        type: "session.lifecycle", sessionId, event: "turn_completed",
      });
    }
  }

  async stop(sessionId: SessionId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.deps.terminalMgr.kill(session.terminalId);  // 走 Terminal 层
    // Terminal 退出事件会把状态推进到 ended
  }

  async resume(sessionId: SessionId): Promise<Session> {
    // 读归档 session → 取 resume_id → 通过 Provider 构造带 --resume 的新 argv
    // → 创建新 Terminal、新 Session（复用 resume_id）
  }

  private emitStateChanged(s: ActiveSession, from: SessionState | null, to: SessionState) {
    this.deps.eventBus.emit({
      type: "session.state.changed",
      sessionId: s.id,
      from: from ?? "draft",
      to,
    });
  }

  private subscribeTerminalExit(session: ActiveSession) {
    // TerminalManager 暴露 onExit 钩子（或 SessionManager 订阅 EventBus 的 terminal.exit）
    // 这里用直接回调注册的简单方式
  }
}
```

**关键点：**

- `SessionManager` 从未 import 过 `node-pty` 或 `PtyHost`；编译时 TypeScript 就保证它走不到 Terminal 之下
- `SessionManager` 从未直接 `broadcaster.broadcast(...)`——它只向 `eventBus` emit 语义事件；WsHub 订阅 bus 后转成前端 topic
- 单测 `SessionManager` 只需注入 `FakeTerminalManager`（方法数量极少：`create/write/kill/resize/replay`）+ `FakeEventBus`；完全不用 spawn 真进程

**Hook 事件竞态（SessionStart 早到）：**

Claude CLI 启动极快时，`SessionStart` hook 可能在 `SessionManager.create` 的 `this.sessions.set(...)` 之前就到达 `HooksEndpoint` → 落到 `onHookEvent` → `this.sessions.get(id)` 返回 undefined → 事件被丢。这个 race 必须修，否则 Phase 1 会随机丢 resume_id。

**解决方案：pending events 暂存池**

```typescript
class SessionManager {
  private sessions = new Map<SessionId, ActiveSession>();
  // 未就绪 session 的暂存事件池；TTL 5s，超时丢弃
  private pending = new Map<SessionId, { events: ProviderHookEvent[]; expiresAt: number }>();

  async create(req: CreateSessionRequest): Promise<Session> {
    const sessionId = generateId();
    // 先注册一个占位，消费 pending 队列
    this.sessions.set(sessionId, /* ... */);

    // 如果 pending 里已有事件 → 立即消化
    const waiting = this.pending.get(sessionId);
    if (waiting) {
      for (const ev of waiting.events) this.applyHookEvent(sessionId, ev);
      this.pending.delete(sessionId);
    }

    // ...继续 Terminal 创建
  }

  onHookEvent(sessionId: SessionId, event: ProviderHookEvent): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.applyHookEvent(sessionId, event);
      return;
    }
    // 暂存 ≤5s，等 create 完成
    const pending = this.pending.get(sessionId) ?? { events: [], expiresAt: Date.now() + 5000 };
    pending.events.push(event);
    this.pending.set(sessionId, pending);
    this.scheduleCleanup();
  }
}
```

`CODER_STUDIO_SESSION_ID` 通过环境变量传给 CLI，hook bridge 从 env 读到后回填到 HTTP POST payload——这保证 session-id 在 session 对象存在前就已经被分配，pending pool 才能工作。

**resume_id 超时捕获：**

如果 Full 模式 Provider 的 `SessionStart` hook 在 30s 内没有到达：
- Session 状态保持 `starting`（不会降级，因为 PTY 还在跑）
- 向 `eventBus` emit `session.lifecycle.warning: "resume_id_unavailable"` → UI 显示"此会话无法恢复"灰色标记
- `session.resume` command 对该 session 返回 `error.code = "no_resume_id"`
- 不影响 session 本身的运行；用户可继续交互，只是重启 server 后无法 resume

**Tab 刷新宽限期（单 writer race）：**

用户按 F5 时顺序是：旧 WS close → HTTP 请求 HTML → 新 JS 加载 → 新 WS open。间隔通常 200–800ms。如果 WsHub 在旧 WS close 的**瞬间**释放 writer 锁，新 WS 立即抢到；但如果另有一个"幽灵 tab"（某个老浏览器标签）刚好在这几百毫秒内检测到断开并重连，它会抢先拿到 writer 权限 → 用户看到"another_tab_active"弹窗，体验很差。

**简单方案**：writer 释放后有 **3s 宽限期**，期间新连接如果来自**同一 IP + 同一 User-Agent**，直接获得 writer 权限不弹窗；其它情况按现有 takeover 流程。

```typescript
// packages/server/src/ws/hub.ts
private lastWriter: { id: ClientId; closedAt: number; ip: string; ua: string } | null = null;
private readonly GRACE_MS = 3000;

handleConnection(conn: WebSocket, req: FastifyRequest) {
  const info = { ip: req.ip, ua: req.headers["user-agent"] ?? "" };

  if (this.writerId === null && this.lastWriter
      && Date.now() - this.lastWriter.closedAt < this.GRACE_MS
      && this.lastWriter.ip === info.ip
      && this.lastWriter.ua === info.ua) {
    // 同 origin 刷新，静默授予 writer
    this.assignWriter(new WsClient(conn, generateId(), info));
    return;
  }
  // 原有单 writer 逻辑
}
```

**命令到层的映射：**

| Command | 去向 |
|---|---|
| `session.create` | `SessionManager.create` → 内部调 `TerminalManager.create` |
| `session.stop` | `SessionManager.stop` → 内部调 `TerminalManager.kill` |
| `session.resume` | `SessionManager.resume` → 内部新建 Terminal |
| `terminal.create` (shell) | `TerminalManager.create`（直接，绕过 Session） |
| `terminal.input` | `TerminalManager.write` |
| `terminal.resize` | `TerminalManager.resize` |
| `terminal.close` | `TerminalManager.kill` |

### 4.7 Hooks Manager

详见 §6（Provider 系统）。Hooks 是 Provider 子系统的一部分。

### 4.8 Workspace Manager

```typescript
class WorkspaceManager {
  async open(req: OpenWorkspaceRequest): Promise<Workspace> {
    // 1. 校验路径存在、是目录、可读可写
    await this.validator.validate(req.path);
    
    // 2. 运行时检查（git、node、provider CLI 是否存在）
    const check = await runtimeCheck(req.path, req.targetRuntime);
    if (!check.ok) throw new RuntimeCheckFailedError(check.missing);
    
    // 3. 持久化到 DB
    const workspace = await this.db.workspaces.create({ 
      path: req.path, 
      targetRuntime: req.targetRuntime, 
      openedAt: Date.now(),
    });
    
    // 4. 初始化 fs watcher、git watcher
    await this.fs.attach(workspace.id, workspace.path);
    await this.git.attach(workspace.id, workspace.path);
    
    // 5. 发送语义事件（WsHub 订阅 bus 后自动广播到 workspace.<id>.meta）
    this.deps.eventBus.emit({
      type: "workspace.meta.changed",
      workspaceId: workspace.id,
      patch: workspace,
    });
    
    return workspace;
  }
}
```

**注意：** WorkspaceManager 只依赖 `eventBus`，从不 import `WsHub`。Bus → Hub 的转发由 WsHub 在构造时订阅 `workspace.meta.changed` 完成，映射到 WS topic `workspace.<id>.meta`。

### 4.9 文件系统层

```typescript
// packages/server/src/fs/watcher.ts
class WorkspaceWatcher {
  private chokidar: FSWatcher;
  private dirtyTimer: NodeJS.Timeout | null = null;
  
  constructor(private workspaceId: string, path: string, private broadcaster: Broadcaster) {
    this.chokidar = chokidar.watch(path, {
      ignored: [/\.git\//, /node_modules/, /\.DS_Store/, /Thumbs\.db/],
      ignoreInitial: true,
      persistent: true,
    });
    this.chokidar.on("all", () => this.markDirty());
  }
  
  private markDirty() {
    if (this.dirtyTimer) return;  // already pending
    this.dirtyTimer = setTimeout(() => {
      this.broadcaster.broadcast(
        `workspace.${this.workspaceId}.fs.dirty`, { reason: "fs_change" });
      this.dirtyTimer = null;
    }, 100);  // 100ms 节流
  }
}

// packages/server/src/fs/file-io.ts
export async function readFile(ws: Workspace, relPath: string): Promise<FileRead> {
  const abs = resolveSafe(ws.path, relPath);  // 防止路径逃逸
  const content = await fs.readFile(abs, "utf8");
  const baseHash = createHash("sha256").update(content).digest("hex");
  return { content, baseHash, encoding: "utf8" };
}

export async function writeFile(ws: Workspace, relPath: string, 
                                 content: string, baseHash: string): Promise<FileWrite> {
  const abs = resolveSafe(ws.path, relPath);
  const current = await fs.readFile(abs, "utf8").catch(() => "");
  const currentHash = createHash("sha256").update(current).digest("hex");
  if (currentHash !== baseHash) {
    throw new ConflictError("file_changed_externally");
  }
  await fs.writeFile(abs, content, "utf8");
  const newHash = createHash("sha256").update(content).digest("hex");
  return { newHash };
}
```

`resolveSafe` 函数防止 `../../etc/passwd` 逃逸：

```typescript
function resolveSafe(root: string, relPath: string): string {
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, relPath);
  if (!abs.startsWith(absRoot + path.sep) && abs !== absRoot) {
    throw new Error("path_escape");
  }
  return abs;
}
```

### 4.10 Git 层

```typescript
// packages/server/src/git/cli.ts
async function runGit(cwd: string, args: string[]): Promise<{stdout: string, stderr: string}> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new GitError(err.message, stderr));
      else resolve({ stdout, stderr });
    });
  });
}

// packages/server/src/git/status-parser.ts
export function parseStatus(porcelainV2: string): GitStatus {
  // 解析 git status --porcelain=v2 -z --branch 输出
  // 返回 { branch, staged[], modified[], untracked[], deleted[] }
}
```

### 4.11 Storage（SQLite）

```typescript
// packages/server/src/storage/db.ts
export function openDatabase(dataDir: string): Database {
  const dbPath = path.join(dataDir, "data.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// migrations/001_init.sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  target_runtime TEXT NOT NULL,
  wsl_distro TEXT,
  opened_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  ui_state TEXT  -- JSON: 面板宽度、折叠状态等
);

CREATE TABLE terminals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                  -- 'agent' | 'shell'
  cwd TEXT NOT NULL,
  argv TEXT NOT NULL,                  -- JSON array
  env TEXT,                            -- JSON object
  title TEXT,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  exit_code INTEGER
);
CREATE INDEX idx_terminals_workspace ON terminals(workspace_id);
CREATE INDEX idx_terminals_kind ON terminals(workspace_id, kind);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  resume_id TEXT,
  capability TEXT NOT NULL,            -- 'full' | 'limited' | 'unsupported'
  state TEXT NOT NULL,                 -- 最终或当前状态
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  last_active_at INTEGER NOT NULL,
  archived BOOLEAN DEFAULT 0
);
CREATE INDEX idx_sessions_workspace ON sessions(workspace_id);
CREATE UNIQUE INDEX idx_sessions_terminal ON sessions(terminal_id);  -- 1:1

CREATE TABLE provider_configs (
  provider_id TEXT PRIMARY KEY,
  config TEXT NOT NULL  -- JSON blob
);

CREATE TABLE user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL  -- JSON
);

CREATE TABLE hook_registrations (
  provider_id TEXT PRIMARY KEY,
  marker_version TEXT NOT NULL,
  injected_at INTEGER NOT NULL,
  global_config_path TEXT NOT NULL,
  last_check_at INTEGER NOT NULL,
  last_status TEXT NOT NULL  -- 'ok' / 'error'
);

-- Phase 2+
CREATE TABLE auth_credentials (
  id INTEGER PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT
);

CREATE TABLE auth_failures (
  ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX idx_auth_failures_ip ON auth_failures(ip, attempted_at);

CREATE TABLE auth_blocked_ips (
  ip TEXT PRIMARY KEY,
  blocked_until INTEGER NOT NULL
);
```

Repository 模式访问：

```typescript
// packages/server/src/storage/repositories/workspace-repo.ts
export class WorkspaceRepo {
  constructor(private db: Database) {}
  
  list(): Workspace[] { return this.db.prepare(...).all(); }
  create(w: NewWorkspace): Workspace { ... }
  updateUiState(id: string, ui: UiState): void { ... }
}
```

### 4.12 认证层（Phase 2）

Phase 1 `authPlugin` 只有一个空中间件 `(req, res, next) => next()`。Phase 2 换成：

```typescript
app.register(authPlugin, {
  mode: config.authEnabled ? "enabled" : "disabled",
  passwordHash: config.passwordHash,
  sessionTtl: config.sessionTtl,
  maxSessionLifetime: config.maxSessionLifetime,
});
```

Plugin 内部：
- 非白名单路径（`/auth/*`、`/healthz`）以外都要有效 cookie
- WS 连接前 upgrade 阶段也校验 cookie
- 登录失败 → 记录到 `auth_failures` → 命中阈值 → 写入 `auth_blocked_ips`
- IP 黑名单提前短路 (`ipBlocker` middleware)

### 4.13 服务器生命周期与信号处理

**启动流程**已在 §4.0 / §4.1 描述。本节聚焦关闭和异常退出。

**优雅关闭（Graceful Shutdown）：**

Server 收到 `SIGTERM` / `SIGINT` → 触发 `stop()` → 按**反向构造顺序**拆解，每一步都有超时上限：

```typescript
// packages/server/src/index.ts
export async function createServer(config: ServerConfig): Promise<Server> {
  // ... 构造 ...
  const stop = async () => {
    logger.info("shutdown_begin");

    // 1. Transport：停止接受新连接 + 断开现有 WS（通知 client 去重连）
    wsHub.shutdown({ reason: "server_shutdown", code: 4004 });
    await app.close();                              // max 5s

    // 2. Service 层反向关闭
    await hooksMgr.shutdown();                      // 无副作用，纯内存
    await workspaceMgr.shutdown();                  // 分离 fs/git watchers

    //    Session 先于 Terminal（让 session 发出 ended 事件再杀 PTY）
    await sessionMgr.stopAll({ timeoutMs: 2000 });  // emit ended, not kill
    await terminalMgr.killAll({
      signal: "SIGTERM",
      graceMs: 2000,                                // 等 SIGTERM 自动退出
      fallback: "SIGKILL",                          // 超时强杀
    });

    // 3. Infrastructure
    ptyHost.dispose();
    runtime.clear();                                // 删除 runtime.json
    db.close();

    logger.info("shutdown_complete");
  };

  // 注册信号
  process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
  process.once("SIGINT",  () => void stop().then(() => process.exit(0)));

  return { app, db, runtime, stop };
}
```

**关键约束：**

| 步骤 | 超时 | 失败后策略 |
|---|---|---|
| `app.close()` | 5s | 强制 `server.closeAllConnections()` |
| `sessionMgr.stopAll()` | 2s | 跳过，进入 terminalMgr.killAll |
| `terminalMgr.killAll(SIGTERM)` | 2s | 对仍存活的 PTY 发 SIGKILL |
| `db.close()` | 1s | 硬退出（SQLite WAL 自恢复） |

**总预算：** ≤10s，到期 `process.exit(1)`。systemd / docker `SIGKILL` 宽限期通常 10–30s，刚好覆盖。

**异常退出（SIGKILL / OOM / 断电）：**

无法优雅清理；node-pty 子进程在 **Linux/macOS 下会被内核的 orphan reparent 机制重新挂到 init**，变成孤儿 PTY。这种情况下：

- 下次 server 启动时，`runtime.json` 仍存在但 `pid` 指向一个死进程 → 启动时检测：如果 `process.kill(pid, 0)` 不抛错且命令行匹配 → **另一个实例在跑**，当前启动 abort；否则视为残留，覆盖 `runtime.json`
- 残留的孤儿 PTY 仍然存在并占用资源——Phase 1 **不主动回收**，由用户手动 `pkill claude` 或系统重启清理
- 数据库使用 WAL 模式，SQLite 自带崩溃恢复；启动时跑 `PRAGMA integrity_check`，失败则广播 toast 要求用户处理备份

**runtime.json 与 bridge 的 TOCTOU：**

Bridge script 发 HTTP POST 时需要读 `runtime.json` 拿当前 port+token。如果 server 正在重启，bridge 可能读到旧数据。缓解：

1. `runtime.json` 包含 `serverInstanceId`，bridge 在 HTTP header 里带上；server 收到后校验，不匹配返回 `410 Gone`
2. Bridge 捕获 `ECONNREFUSED` / `410` → 重试 3 次，每次 500ms → 仍失败则把事件写到 `~/.coder-studio/hooks/retry-queue/<timestamp>.json`（Phase 4 考虑后台 flush；Phase 1 记录日志并放弃，毕竟几率极低）

**Server 单实例保证：**

启动时：
```typescript
if (existsSync(runtimePath)) {
  const existing = readRuntime(runtimePath);
  if (isAlive(existing.pid)) {
    console.error(`coder-studio already running (pid=${existing.pid})`);
    process.exit(1);
  }
  // else: 残留文件，覆盖
}
writeRuntime(runtimePath, { pid: process.pid, port, token, serverInstanceId });
```

不做 flock 之类的跨平台文件锁（pnp 环境和 WSL 表现不稳定），`pid + kill(0)` 已足够。

---

## 5. 前端架构

### 5.0 分层与耦合规则

前端四层组织，import 方向与服务端对称——**只能向下**：

```
┌─────────────────────────────────────────────────────┐
│  Shell 层         app/ · AppShell · routes           │  路由、顶栏、全局浮层
├─────────────────────────────────────────────────────┤
│  Features 层      features/<name>/                   │  业务 UI：topbar / workspace /
│                                                       │  agent-panes / terminal-panel / ...
├─────────────────────────────────────────────────────┤
│  State 层         atoms/ · lib/dispatch.ts           │  Jotai atoms、命令派发、选择器
├─────────────────────────────────────────────────────┤
│  Transport 层     ws/                                │  WsClient、订阅、重连
├─────────────────────────────────────────────────────┤
│  Core (@coder-studio/core)                           │  协议 schema、领域类型
└─────────────────────────────────────────────────────┘
```

**依赖方向规则：**

| 规则 | 说明 |
|---|---|
| Features → State | 组件通过 `useAtomValue` / `useSetAtom` / `dispatch` 访问状态 |
| Features → Features | **禁止** 直接 import。所有跨 feature 协作必须走 atom |
| State → Transport | `dispatchCommandAtom` 内部调用 `WsClient.sendCommand` |
| Transport → State | WsClient 收到 event 后通过注入的 setter 写 atom（反向在事件层允许） |
| 任何层 → Core | 允许 |
| Transport 独立于 UI | `WsClient` 不 import React / Jotai；通过回调接入 |

**Feature 目录约定（硬性）：**

```
features/<name>/
├── index.tsx           # 唯一对外导出：主组件
├── components/         # 内部子组件（外部不可 import）
├── hooks/              # feature 私有 hooks
├── atoms.ts            # feature 私有派生 atom（可选）
└── dispatch.ts         # feature 专用 command 封装（可选）
```

外部只能 `import { SomeFeature } from "features/<name>"`。`features/<name>/internal/...` 路径走不通——靠 ESLint `no-restricted-paths` 强制。

**Atom 写入者白名单：**

Atom 的 `set` 调用方**必须**属于以下三类之一，违反 = 代码 review 拒绝：

| 写入者 | 写入目标 | 场景 |
|---|---|---|
| **WS event handler** | 服务端状态投影 atom（`workspacesAtom` / `sessionsAtom` / `gitStateAtomFamily` / ...） | 服务端事件到达后同步到前端镜像 |
| **dispatch helpers** | 短期"乐观更新"的派生 atom | 用户点击后先改本地，成功响应到达后再 reconcile |
| **UI 本地状态 setter** | `atomWithStorage` 系列（`focusModeAtom` / `leftPanelWidthAtom` / `paneLayoutAtomFamily`） | 纯前端偏好 |

**禁止** feature 组件直接 `set` 服务端投影 atom——所有服务端状态变更必须走 Command → Event → atom 写入的链路。

**Feature 典型数据流（以"保存文件"为例）：**

```
1. <CodeEditorHost> 监听 Ctrl+S
     ↓
2. dispatch({ op: "file.write", args: { ... } })        ← Features → State
     ↓
3. dispatchCommandAtom → WsClient.sendCommand()         ← State → Transport
     ↓  WebSocket
4. server CommandHandler.fileWrite → FileService
     ↓
5. server 广播 workspace.<id>.fs.dirty                  ← Event Bus → WsHub
     ↓  WebSocket
6. WsClient 收到 event → 调用注册的订阅 handler
     ↓
7. handler 写入 fileTreeStaleAtom(workspaceId)          ← Transport → State
     ↓
8. <FileTree> useAtomValue(...) 触发 re-render          ← State → Features
     ↓
9. FileTree dispatch("file.readTree") 刷新
```

关键：**第 8 步的 `<FileTree>` 完全不知道 `<CodeEditorHost>` 的存在**，两个 feature 通过 atom 解耦。

**典型反模式（禁止）：**

```typescript
// ❌ features/code-editor 直接 import features/file-tree
import { refreshFileTree } from "features/file-tree/api";
refreshFileTree(workspaceId);

// ❌ 组件绕过 dispatch 直接调 WsClient
import { wsClient } from "ws/client";
wsClient.sendCommand("file.write", ...);

// ❌ 组件直接写服务端投影 atom
const setSessions = useSetAtom(sessionsAtom);
setSessions(prev => ({ ...prev, [id]: newSession }));  // 应该等 WS event 回来
```

**测试 seam：**

| 被测对象 | 替换 |
|---|---|
| Feature 组件 | 用 `TestProvider` 包 Jotai，预设 atom；不 mock WsClient |
| State 层（派生 atom） | 纯函数，直接断言 `get(derivedAtom)` 返回值 |
| Transport | 用 `FakeWebSocket` 驱动消息，断言 setter 被调用 |

---

### 5.1 应用层

```
main.tsx
  └─ <JotaiProvider>
       └─ <RouterProvider>
            └─ <AppShell>
                 ├─ <TopBar />
                 ├─ <Router.Outlet />         ← 工作区路由 / 欢迎 / 设置
                 ├─ <CommandPalette />        ← 浮层
                 ├─ <NotificationToastLayer /> 
                 └─ <ConfirmDialogLayer />
```

路由：

| 路径 | 组件 |
|---|---|
| `/` | redirect `/workspace` |
| `/workspace` | `<WorkspacePage>` — 空/欢迎 |
| `/workspace/:id` | `<WorkspacePage workspaceId={id}>` |
| `/settings` | `<SettingsPage>` |
| `/settings/:section` | `<SettingsPage section={section}>` |
| `/login` | `<AuthPage>` (Phase 2) |

### 5.2 Jotai Atom 组织

```typescript
// ============ 连接层 ============
// WebSocket 客户端（单例，作为 atom 以便全局访问）
export const wsClientAtom = atom<WsClient>(new WsClient(resolveWsUrl()));
export const connectionStatusAtom = atom<ConnectionStatus>("connecting");

// ============ 服务端状态投影（WS event 驱动写入） ============
// 工作区
export const workspacesAtom = atom<Record<string, Workspace>>({});
export const workspaceByIdAtomFamily = atomFamily((id: string) =>
  atom((get) => get(workspacesAtom)[id]));

// 会话
export const sessionsAtom = atom<Record<string, Session>>({});
export const sessionsByWorkspaceAtomFamily = atomFamily((wsId: string) =>
  atom((get) => Object.values(get(sessionsAtom)).filter(s => s.workspaceId === wsId)));

// 终端输出 — 高频，必须 atomFamily 隔离
export const terminalOutputAtomFamily = atomFamily((terminalId: string) =>
  atom<OutputBuffer>({ chunks: [], lastSeq: 0 }));

// 文件树
export const fileTreeAtomFamily = atomFamily((workspaceId: string) =>
  atom<FileNode | null>(null));

// Git 状态
export const gitStateAtomFamily = atomFamily((workspaceId: string) =>
  atom<GitStatus | null>(null));

// 设置
export const settingsAtom = atom<Settings | null>(null);

// Provider 列表
export const providersAtom = atom<ProviderInfo[]>([]);

// ============ UI 本地状态（localStorage 持久化） ============
export const focusModeAtom = atomWithStorage("ui.focusMode", false);
export const leftPanelWidthAtom = atomWithStorage("ui.leftPanelWidth", 280);
export const bottomPanelHeightAtom = atomWithStorage("ui.bottomPanelHeight", 200);
export const activeWorkspaceIdAtom = atomWithStorage("ui.activeWorkspaceId", null);
export const paneLayoutAtomFamily = atomFamily((workspaceId: string) =>
  atomWithStorage<PaneLayout>(`ui.paneLayout.${workspaceId}`, defaultLayout));

// ============ 派生状态 ============
export const activeSessionAtom = atom((get) => {
  const wsId = get(activeWorkspaceIdAtom);
  if (!wsId) return null;
  const sessions = get(sessionsByWorkspaceAtomFamily(wsId));
  return sessions.find(s => s.active) ?? null;
});

// ============ Command 派发器（只写 atom） ============
export const dispatchCommandAtom = atom(
  null,
  async (get, set, cmd: { op: string, args: unknown }) => {
    const ws = get(wsClientAtom);
    return ws.sendCommand(cmd.op, cmd.args);
  }
);
```

组件内：

```typescript
function SessionCard({ sessionId }: { sessionId: string }) {
  const session = useAtomValue(sessionsAtom)[sessionId];
  const dispatch = useSetAtom(dispatchCommandAtom);
  
  return (
    <div>
      <StatusDot state={session.state} />
      <button onClick={() => dispatch({ op: "session.stop", args: { sessionId } })}>
        Stop
      </button>
    </div>
  );
}
```

### 5.3 WebSocket Client

```typescript
class WsClient {
  private ws: WebSocket | null = null;
  private pendingCommands = new Map<string, { resolve, reject }>();
  private eventListeners = new Map<string, Set<EventListener>>();
  private lastSeenSeq = new Map<string, number>();
  private reconnectAttempts = 0;
  
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
    this.ws.onclose = () => this.handleClose();
    this.ws.onopen = () => this.handleOpen();
  }
  
  async sendCommand<T>(op: string, args: unknown): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pendingCommands.set(id, { resolve, reject });
      this.send({ kind: "command", id, op, args });
    });
  }
  
  subscribe(topics: string[], handler: EventListener) {
    // 合并订阅、记录 handler、发 subscribe message
  }
  
  private handleMessage(msg: ServerMessage) {
    if (msg.kind === "result") {
      const pending = this.pendingCommands.get(msg.id);
      if (msg.ok) pending?.resolve(msg.data);
      else pending?.reject(new RpcError(msg.error!));
      this.pendingCommands.delete(msg.id);
    } else if (msg.kind === "event") {
      this.lastSeenSeq.set(msg.topic, msg.seq);
      // 分发给订阅者 → 订阅者通常是 set atom
    }
  }
  
  private handleOpen() {
    this.reconnectAttempts = 0;
    // 如果有 lastSeen，先发 resync
    if (this.lastSeenSeq.size > 0) {
      this.send({ kind: "resync", lastSeen: Object.fromEntries(this.lastSeenSeq) });
    }
  }
  
  private handleClose() {
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts++);
    setTimeout(() => this.connect(), delay);
  }
}
```

客户端创建在 React 层外，通过 `wsClientAtom` 暴露给组件。在顶层 `useEffect` 里调用 `connect()`。

### 5.4 核心 UI 模块分解

每个 feature 目录一个独立模块，互相不直接 import，通过 atom 通信：

| Feature | 主要组件 | 使用的 atom |
|---|---|---|
| topbar | `TopBar`, `WorkspaceTab`, `QuickActionsBtn`, `SettingsBtn` | workspacesAtom, activeWorkspaceIdAtom |
| welcome | `WelcomePage`, `OpenWorkspaceBtn` | — |
| workspace | `WorkspacePage`, `LeftPanel`, `CentralPanel`, `BottomPanel` | workspaceByIdAtomFamily, 布局 atom |
| agent-panes | `AgentPaneTree`, `AgentPane`, `DraftLauncher`, `SplitHandle` | sessionsByWorkspaceAtomFamily, paneLayoutAtomFamily |
| code-editor | `FileTree`, `CodeEditor`, `FileSearch`, `DiffEditor` | fileTreeAtomFamily, openFileAtomFamily |
| git-panel | `GitChangesPanel`, `ChangeGroup`, `ChangeRow`, `CommitInput` | gitStateAtomFamily |
| terminal-panel | `BottomTerminalPanel`, `TerminalTabs`, `XtermHost` | terminalOutputAtomFamily |
| command-palette | `CommandPalette`, `ActionList`, `SearchInput` | actionsRegistry, 快捷键 |
| settings | `SettingsPage`, `Navigation`, `GeneralSection`, `ProviderSection`, `AppearanceSection` | settingsAtom, providersAtom |
| focus-mode | 没有独立组件；通过 `focusModeAtom` 控制 `AppShell` 的类名 | focusModeAtom |
| notifications | `NotificationLayer`, `ToastCard` | notificationsAtom |

**模块内部文件大小约束**（CLAUDE.md）：
- 单文件 200–400 行；最多 800 行
- 组件 > 100 行 → 拆子组件
- 逻辑超过 20 行 → 抽 hook 或 util

### 5.5 xterm 主机组件

```typescript
function XtermHost({ terminalId, interactive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const output = useAtomValue(terminalOutputAtomFamily(terminalId));
  const dispatch = useSetAtom(dispatchCommandAtom);
  
  useEffect(() => {
    if (!containerRef.current) return;
    term.current = new Terminal({
      fontSize: 13,
      fontFamily: "JetBrains Mono, monospace",
      scrollback: 5000,
      theme: auroraMintTheme,
    });
    const fit = new FitAddon();
    term.current.loadAddon(fit);
    try {
      term.current.loadAddon(new WebglAddon());
    } catch {
      // fallback to canvas
    }
    term.current.open(containerRef.current);
    fit.fit();
    
    if (interactive) {
      term.current.onData((data) => {
        dispatch({ op: "terminal.input", 
                   args: { terminalId, bytes: btoa(data) } });
      });
    }
    
    return () => term.current?.dispose();
  }, [terminalId]);
  
  // 把 atom 中的 output chunks 写入 term
  useEffect(() => {
    const unwritten = output.chunks.slice(output.lastWritten);
    for (const chunk of unwritten) {
      term.current?.write(atob(chunk));
    }
  }, [output]);
  
  return <div ref={containerRef} className="agent-pane-xterm" />;
}
```

**重要**：`TerminalOutputAtom` 并不存**全部历史**，它只是一个短期缓冲——`useEffect` 把新 chunk 写入 xterm 后立即截断 atom 内容。历史保留在 xterm 的 scrollback 里（前端自己）。这样 atom 不会膨胀。

### 5.6 Monaco 编辑器集成

```typescript
function CodeEditorHost({ workspaceId, filePath }: Props) {
  const [content, setContent] = useAtom(openFileContentAtom(filePath));
  const [baseHash, setBaseHash] = useAtom(openFileBaseHashAtom(filePath));
  const [dirty, setDirty] = useAtom(openFileDirtyAtom(filePath));
  const dispatch = useSetAtom(dispatchCommandAtom);
  
  // 打开文件
  useEffect(() => {
    dispatch({ op: "file.read", args: { workspaceId, path: filePath } })
      .then((r: FileRead) => {
        setContent(r.content);
        setBaseHash(r.baseHash);
        setDirty(false);
      });
  }, [filePath]);
  
  // Ctrl+S 保存
  useShortcut("mod+s", async () => {
    if (!dirty) return;
    const result = await dispatch({ 
      op: "file.write", 
      args: { workspaceId, path: filePath, content, baseHash } 
    });
    setBaseHash(result.newHash);
    setDirty(false);
  });
  
  return (
    <Editor
      value={content}
      onChange={(v) => { setContent(v ?? ""); setDirty(true); }}
      language={detectLanguage(filePath)}
      theme="aurora-mint-dark"
      options={monacoOptions}
    />
  );
}
```

**冲突处理**：`file.write` 抛出 `conflict` 错误 → Toast 提示"文件已被外部修改" + 两个选项（"覆盖本地到磁盘" / "放弃本地，重新读取"）。

### 5.7 i18n

```typescript
// packages/web/src/lib/i18n.ts
type TranslationKey = keyof typeof zh;

const translations = { zh, en };  // Phase 1 只有 zh

export function createTranslator(locale: "zh" | "en") {
  return function t(key: TranslationKey, params?: Record<string, string>): string {
    const template = translations[locale][key] ?? translations["zh"][key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
  };
}

// 作为 atom
export const localeAtom = atomWithStorage<"zh" | "en">("ui.locale", "zh");
export const tAtom = atom((get) => createTranslator(get(localeAtom)));

// 组件里
const t = useAtomValue(tAtom);
<button>{t("action.open_workspace")}</button>
```

**Phase 1 的约束**：即使只有 `zh.json`，所有 UI 文本必须走 `t()`，不能硬编码中文字符串。Phase 2 加英文翻译时只需补 `en.json`，零组件改动。

### 5.8 设计系统落地

Aurora Mint 设计系统（PRD §5.3、visual-spec.html）以 CSS 变量实现：

```css
/* packages/web/src/styles/tokens.css */
:root {
  --bg-page: #0a1014;
  --bg-surface: #11181f;
  --bg-sidebar: #0d141a;
  --bg-terminal: #0b1218;
  /* ... 全部 token */
}

/* 组件层使用 token，不写死颜色 */
.agent-pane-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  /* ... */
}
```

Phase 4 浅色主题时只需新增 `[data-theme="light"] { --bg-page: ... }` 覆盖 token。

---

## 6. 视觉规范约束

本章节定义 Coder Studio 的视觉规范强制约束，所有前端开发必须遵循。设计系统详情见 `docs/visual-spec.html` (Aurora Mint Design System v1.0.0)。

---

### 6.1 CSS 变量系统与使用规范

Aurora Mint 设计系统通过 CSS 变量（Design Tokens）实现。所有前端代码必须使用预定义 token，禁止硬编码颜色、间距、字体、圆角等值。

#### 6.1.1 Token 定义位置

所有 token 在 `packages/web/src/styles/tokens.css` 中定义一次：

```css
/* packages/web/src/styles/tokens.css */
:root {
  /* Backgrounds */
  --bg-page: #0a1014;
  --bg-surface: #11181f;
  --bg-sidebar: #0d141a;
  --bg-terminal: #0b1218;
  --bg-hover: #1a2632;
  --bg-active: #1e3040;
  --bg-disabled: #151f28;

  /* Borders */
  --border: #1e2a35;
  --border-light: #263545;
  --border-focus: #6cb6ff;

  /* Text */
  --text-primary: #e5edf3;
  --text-secondary: #9fb0bc;
  --text-tertiary: #728492;

  /* Accents */
  --accent-blue: #6cb6ff;
  --accent-green: #78d7b2;
  --accent-amber: #f1b86a;
  --accent-pink: #ff9eb0;

  /* Spacing (4px grid) */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;
  --sp-10: 40px;
  --sp-12: 48px;
  --sp-16: 64px;

  /* Border Radii */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 7px;
  --radius-xl: 8px;

  /* Typography */
  --font-sans: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.4);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.5);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.6);

  /* Transitions */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 100ms;
  --duration-normal: 150ms;
  --duration-slow: 200ms;
}
```

#### 6.1.2 强制使用规则

| 场景 | ✅ 正确用法 | ❌ 禁止用法 |
|------|------------|------------|
| 颜色 | `color: var(--text-primary)` | `color: #e5edf3` |
| 背景 | `background: var(--bg-surface)` | `background: #11181f` |
| 边框 | `border-color: var(--border)` | `border: 1px solid #1e2a35` |
| 间距 | `padding: var(--sp-4)` | `padding: 16px` |
| 圆角 | `border-radius: var(--radius-md)` | `border-radius: 6px` |
| 过渡 | `transition: all var(--duration-normal)` | `transition: all 150ms` |

**原则：** 组件层只引用 token，不写死任何视觉属性值。Phase 4 浅色主题时只需在 `tokens.css` 新增 `[data-theme="light"]` 覆盖 token，零改动组件层。

---

### 6.2 布局与间距约束（4px Grid）

所有布局遵循严格的 **4px grid system**。任何间距值（padding、margin、gap、width、height）必须是 4px 的倍数。

#### 6.2.1 Spacing Token 使用

预定义 spacing token 对应 4px 的倍数：

| Token | 值 | 常见用途 |
|-------|---|----------|
| `--sp-1` | 4px | 最小间隙、图标间距 |
| `--sp-2` | 8px | 紧凑元素内边距、徽章间距 |
| `--sp-3` | 12px | 按钮内边距（紧凑）、表单字段间距 |
| `--sp-4` | 16px | 卡片内边距、按钮默认内边距 |
| `--sp-6` | 24px | 面板内边距、模态框内边距 |
| `--sp-8` | 32px | 大型区块间距、容器内边距 |
| `--sp-12` | 48px | 页面区块间距 |
| `--sp-16` | 64px | 页面级分隔 |

#### 6.2.2 强制约束

- ✅ 所有 `padding`、`margin`、`gap` 必须使用 spacing token
- ✅ 组件宽度/高度建议使用 spacing token 或百分比
- ❌ 禁止非 4px 倍数的间距值（如 `15px`、`10px`）
- ❌ 禁止自定义 spacing 值偏离预定义 token

**例外：** 字体大小、行高、图标大小可使用预定义字体规范值（见 PRD §5.4），不受 4px grid 限制。

---

### 6.3 组件样式规范

所有 UI 组件必须对齐 `visual-spec.html` 中定义的样式细节。核心组件规范如下：

#### 6.3.1 按钮系统

**预定义按钮类：**

| 类名 | 样式 | 用途 |
|------|------|------|
| `.btn.btn-primary` | 蓝色背景 `var(--accent-blue)` | 主要操作、确认、启动 |
| `.btn.btn-default` | 默认背景 `var(--bg-surface)` | 次要操作、取消 |
| `.btn.btn-danger` | 粉色背景 `var(--accent-pink)` | 破坏性操作、删除 |
| `.btn.btn-icon` | 无背景、仅图标 | 工具栏按钮、面板操作 |

**尺寸规范：**

| 尺寸 | 类名 | 高度 | 内边距 | 字体 |
|------|------|------|--------|------|
| Small | `.btn-sm` | 28px | `var(--sp-2) var(--sp-3)` | 12px |
| Default | 无额外类 | 32px | `var(--sp-3) var(--sp-4)` | 13px |
| Large | `.btn-lg` | 40px | `var(--sp-4) var(--sp-6)` | 14px |

**强制规则：**
- ✅ 使用预定义 `.btn` 类，不自定义偏离规范的按钮样式
- ✅ 圆角统一 `var(--radius-md)` (6px)
- ❌ 禁止自定义按钮高度、内边距偏离规范

#### 6.3.2 输入框系统

**预定义输入框类：**

```css
.input {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--sp-3);
  font-size: 13px;
  color: var(--text-primary);
}

.input:focus {
  border-color: var(--border-focus);
  outline: none;
}
```

**强制规则：**
- ✅ 所有文本输入、下拉框使用 `.input` 类
- ✅ Focus 状态必须使用蓝色边框 `var(--border-focus)`
- ❌ 禁止自定义输入框样式偏离规范

#### 6.3.3 卡片与面板

**卡片样式：**

```css
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl); /* 8px */
  padding: var(--sp-4);
}
```

**面板样式：**

```css
.panel {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
}

.panel-header {
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--border);
}
```

**强制规则：**
- ✅ 所有容器级组件（卡片、面板、模态框）使用 `var(--radius-xl)`
- ✅ 背景使用 `var(--bg-surface)`，边框使用 `var(--border)`
- ❌ 禁止使用非预定义圆角值（如 `10px`）

#### 6.3.4 其他核心组件

| 组件 | 关键样式约束 |
|------|-------------|
| **徽章 (Badge)** | `--radius-sm` (4px)、紧凑内边距 `2px var(--sp-2)` |
| **Tab** | 下划线样式 (View Switcher)、Pill 样式 (Settings Navigation) |
| **进度条** | 高度 4px、`--radius-sm`、四色变体 (blue/green/amber/pink) |
| **状态点** | 8px 圆形、绿色有发光效果、灰蓝/蓝色/弱化变体 |
| **工具栏** | 32px 高度按钮组、分隔线 `var(--border)` |

所有细节见 `visual-spec.html` §5-§14。

---

### 6.4 交互状态与动画规范

#### 6.4.1 交互状态

所有可交互元素必须定义以下状态：

| 状态 | 样式规则 |
|------|---------|
| **Hover** | 背景变亮（通过 `color-mix` 或预定义 `--bg-hover`） |
| **Active (按下)** | 背景进一步变暗（`--bg-active`），轻微缩小 (scale: 0.98) |
| **Focus** | 强调色轮廓（`outline: 2px solid var(--border-focus)`） |
| **Disabled** | 降低不透明度 50%（`opacity: 0.5`）、`pointer-events: none` |

**示例（按钮 Hover 状态）：**

```css
.btn:hover {
  background: color-mix(in srgb, var(--bg-surface), var(--bg-hover));
}

.btn-primary:hover {
  background: color-mix(in srgb, var(--accent-blue), white 20%);
}
```

#### 6.4.2 动画系统

**预定义过渡参数：**

| Token | 值 | 用途 |
|-------|---|------|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | 所有动画的标准 easing |
| `--duration-fast` | 100ms | 快速交互（hover、focus） |
| `--duration-normal` | 150ms | 标准交互（按钮点击、展开） |
| `--duration-slow` | 200ms | 较慢交互（模态框、页面切换） |

**预定义动画：**

```css
/* 入场动画 */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* 使用 */
.modal-enter {
  animation: fadeIn var(--duration-normal) var(--ease-out) both;
}

.sidebar-item-enter {
  animation: slideIn var(--duration-normal) var(--ease-out) both;
}
```

#### 6.4.3 面板缩放器（Resizer）

- 主面板分隔条宽度：4px
- Agent 分割分隔条宽度：8px
- 光标：`col-resize`（垂直）、`row-resize`（水平）
- Hover 状态：背景变为 `var(--accent-blue)`
- 调整大小时：禁用过渡 `transition: none !important`，添加 `body.is-resizing-panels` 类

**强制规则：**
- ✅ 所有过渡必须使用预定义 duration token 和 `--ease-out`
- ✅ Hover 状态必须符合规范（变亮而非变色）
- ❌ 禁止自定义 easing 曲线偏离 `--ease-out`
- ❌ 禁止动画时长写死数值（如 `200ms`）

---

### 6.5 实施检查清单

#### 6.5.1 Phase 1 实施前必须完成

- [ ] 创建 `packages/web/src/styles/tokens.css` 并定义所有 token（§6.1.1）
- [ ] 全局样式文件引入 tokens.css (`@import './styles/tokens.css'`)
- [ ] 移除所有硬编码颜色值，替换为 CSS 变量
- [ ] 移除所有硬编码间距值，替换为 spacing token
- [ ] 所有组件（按钮、输入、卡片）样式对齐 visual-spec
- [ ] Hover/Focus/Disabled 状态符合 §6.4.1 规范
- [ ] 过渡动画使用预定义 token（§6.4.2）

#### 6.5.2 开发过程中的视觉规范验证

**每次新增 UI 组件时的检查流程：**

1. **颜色/间距检查**：搜索组件 CSS，确认无硬编码颜色值（`#[0-9a-f]{6}`）或非 token 间距值
2. **组件规范对齐**：对照 `visual-spec.html` 确认样式细节（圆角、高度、内边距）
3. **状态检查**：确认 Hover、Focus、Disabled 状态符合 §6.4.1
4. **动画检查**：确认过渡使用预定义 duration/easing token
5. **4px Grid 检查**：确认所有间距是 4px 的倍数

**代码审查流程必须包含视觉规范检查：**
- PR 描述中注明 "Visual spec checked: ✅"
- Reviewer 使用 `visual-spec.html` 对照组件样式
- 发现偏差时标记为 "visual-spec violation" 并要求修正

#### 6.5.3 自动化验证（可选，Phase 4）

Phase 4 可引入以下自动化验证：

- **Stylelint 规则**：禁止硬编码颜色/间距值，强制使用 CSS 变量
- **视觉回归测试**：使用 Playwright 截图对比 baseline（基于 visual-spec.html）
- **CI 检查**：每次 PR 自动运行 Stylelint + 视觉回归测试

---

**总结：** 视觉规范是 Coder Studio 产品质量的基石。所有前端开发必须严格遵循本章约束，确保视觉一致性和可维护性。`visual-spec.html` 是唯一真源，任何样式决策必须对齐该文档。

---

## 7. Provider 系统详细设计

### 7.1 ProviderDefinition 契约

```typescript
// packages/core/src/provider/definition.ts

export interface ProviderDefinition {
  // ===== 元数据 =====
  id: string;                          // "claude" | "codex" | ...
  displayName: string;
  badge: string;                       // 短标签用于 UI 徽章
  capability: "full" | "limited" | "unsupported";
  
  // ===== 启动命令 =====
  buildCommand(config: ProviderConfig, ctx: LaunchContext): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  };
  
  // ===== 恢复命令 =====
  buildResumeCommand?(resumeId: string, config: ProviderConfig, ctx: LaunchContext): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  } | null;   // null = 不支持恢复
  
  // ===== 配置 schema =====
  configSchema: ZodSchema<ProviderConfig>;
  defaultConfig: ProviderConfig;
  
  // ===== 命令可用性检查 =====
  requiredCommands: string[];          // 如 ["claude"] → runtime check 验证
  
  // ===== Hooks 适配 =====
  hooks: HooksDescriptor;
}

export interface HooksDescriptor {
  // 全局配置文件路径解析（跨平台）
  resolveGlobalConfigPath(): string;   // 如 ~/.claude/settings.json
  
  // merge-write 策略
  mergeInto(existing: unknown, managedHooks: ManagedHooks): unknown;
  
  // 识别自己写入的 hooks（用于升级和清理）
  extractManaged(config: unknown): ManagedHooks | null;
  
  // marker 版本（升级时对比）
  markerVersion: string;
  
  // bridge 脚本声明（为每个 hook 事件指定一个命令）
  bridgeCommand(bridgeScriptPath: string, event: string): string[];
  
  // 事件解析
  parseEvent(event: string, payload: unknown): ProviderEvent | null;
  
  // 能力声明
  events: {
    sessionStart: boolean;   // 能否可靠获取 resume_id
    completion: boolean;     // 能否可靠上报完成（Stop 等）
    progress: boolean;       // 能否上报中间进度
  };
  
  // Limited 模式降级支持
  stdoutHeuristics?: {
    sessionIdPatterns: RegExp[];
    idlePromptPatterns: RegExp[];
    idleDebounceMs: number;
  };
}

export interface ProviderEvent {
  type: "session_start" | "stop" | "turn_completed" | "progress" | "error";
  sessionId: string;
  payload: Record<string, unknown>;
}
```

### 7.2 Claude Code 实现

```typescript
// packages/providers/src/claude/definition.ts
export const claudeDefinition: ProviderDefinition = {
  id: "claude",
  displayName: "Claude Code",
  badge: "Claude",
  capability: "full",
  
  requiredCommands: ["claude"],
  
  configSchema: claudeConfigSchema,
  defaultConfig: {
    model: "claude-sonnet-4-5",
    maxTurns: null,
    additionalArgs: [],
    envVars: {},
  },
  
  buildCommand(config, ctx) {
    return {
      argv: ["claude", ...config.additionalArgs],
      env: { ...config.envVars, 
             CODER_STUDIO_SESSION_ID: ctx.sessionId },
      cwd: ctx.workspacePath,
    };
  },
  
  buildResumeCommand(resumeId, config, ctx) {
    return {
      argv: ["claude", "--resume", resumeId, ...config.additionalArgs],
      env: { ...config.envVars, 
             CODER_STUDIO_SESSION_ID: ctx.sessionId },
      cwd: ctx.workspacePath,
    };
  },
  
  hooks: claudeHooksDescriptor,
};
```

```typescript
// packages/providers/src/claude/hooks-descriptor.ts
export const claudeHooksDescriptor: HooksDescriptor = {
  markerVersion: "cs-v1",
  
  resolveGlobalConfigPath() {
    return path.join(os.homedir(), ".claude", "settings.json");
  },
  
  mergeInto(existing, managed) {
    const config = (existing && typeof existing === "object") ? existing : {};
    // 深拷贝 existing → 添加/更新 hooks 字段 → 返回新对象（不修改原 existing）
    return produce(config, (draft) => {
      draft.hooks ??= {};
      draft.hooks.SessionStart ??= [];
      draft.hooks.Stop ??= [];
      
      // 清除旧版本的 managed hooks（通过 marker 识别）
      draft.hooks.SessionStart = removeManaged(draft.hooks.SessionStart);
      draft.hooks.Stop = removeManaged(draft.hooks.Stop);
      
      // 添加新的
      draft.hooks.SessionStart.push({
        _cs_managed: true,
        _cs_version: "cs-v1",
        command: managed.commands.SessionStart,
      });
      draft.hooks.Stop.push({
        _cs_managed: true,
        _cs_version: "cs-v1",
        command: managed.commands.Stop,
      });
    });
  },
  
  extractManaged(config) {
    // 从配置里识别 Coder Studio 写入的 hooks（通过 _cs_managed 标记）
  },
  
  bridgeCommand(bridgeScriptPath, event) {
    return ["node", bridgeScriptPath, event];
  },
  
  parseEvent(event, payload) {
    switch (event) {
      case "SessionStart":
        return {
          type: "session_start",
          sessionId: payload.session_id as string ?? "",
          payload: {
            resumeId: payload.session_id as string,
            transcriptPath: payload.transcript_path,
          },
        };
      case "Stop":
        return {
          type: "stop",
          sessionId: payload.session_id as string ?? "",
          payload: { reason: payload.stop_hook_reason },
        };
      default:
        return null;
    }
  },
  
  events: {
    sessionStart: true,
    completion: true,
    progress: false,  // Phase 3 考虑启用 PreToolUse/PostToolUse
  },
};
```

**关键细节**：Claude Code CLI 的 hooks 通过 settings.json 定义，每个 hook 是一个命令行脚本；Claude 会向脚本 stdin 传 JSON payload，或通过 env 传参（具体实现阶段对照 Claude Code 最新文档）。bridge script 从 stdin 读 payload，再 POST 到 Coder Studio 的 endpoint。

### 7.3 Codex 实现（Limited 模式）

```typescript
// packages/providers/src/codex/definition.ts
export const codexDefinition: ProviderDefinition = {
  id: "codex",
  displayName: "Codex",
  badge: "Codex",
  capability: "limited",        // Phase 1 先 limited，Phase 2 调研是否可提升到 full
  
  requiredCommands: ["codex"],
  
  configSchema: codexConfigSchema,
  defaultConfig: { ... },
  
  buildCommand(config, ctx) {
    return {
      argv: ["codex", ...config.additionalArgs],
      env: { ...config.envVars, CODER_STUDIO_SESSION_ID: ctx.sessionId },
      cwd: ctx.workspacePath,
    };
  },
  
  // 降级模式下不支持 resume
  buildResumeCommand: null,
  
  hooks: {
    ...noopHooksDescriptor,  // 不写入任何全局配置
    events: {
      sessionStart: false,
      completion: false,
      progress: false,
    },
    stdoutHeuristics: {
      sessionIdPatterns: [
        /Session ID:\s*([a-f0-9-]{6,})/i,
        /^session:\s*([a-f0-9-]{6,})/im,
      ],
      idlePromptPatterns: [
        /\n>\s*$/,
        /\n\$\s*$/,
      ],
      idleDebounceMs: 3000,
    },
  },
};
```

**降级通道在 SessionManager 里实现**，不是 provider 内部：

```typescript
class ActiveSession {
  pty: Pty;
  provider: ProviderDefinition;
  
  // Full 模式：依赖 hooks 事件
  applyHookEvent(event: ProviderEvent) {
    switch (event.type) {
      case "session_start": this.setResumeId(event.payload.resumeId); break;
      case "stop": this.markTurnCompleted(); break;
    }
  }
  
  // Limited 模式：从 stdout 推断
  private heuristicBuffer = "";
  private idleTimer: NodeJS.Timeout | null = null;
  
  onPtyData(chunk: Buffer) {
    this.ringBuffer.append(chunk);
    this.broadcast(chunk);
    
    if (this.provider.hooks.stdoutHeuristics) {
      this.heuristicBuffer = (this.heuristicBuffer + chunk.toString("utf8")).slice(-4096);
      
      // 尝试提取 session ID
      if (!this.resumeId) {
        for (const pattern of this.provider.hooks.stdoutHeuristics.sessionIdPatterns) {
          const match = this.heuristicBuffer.match(pattern);
          if (match) { this.setResumeId(match[1]); break; }
        }
      }
      
      // 空闲检测
      for (const pattern of this.provider.hooks.stdoutHeuristics.idlePromptPatterns) {
        if (pattern.test(this.heuristicBuffer)) {
          this.scheduleIdleCheck();
          break;
        }
      }
    }
  }
  
  private scheduleIdleCheck() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.markTurnCompleted({ approximate: true });
    }, this.provider.hooks.stdoutHeuristics!.idleDebounceMs);
  }
}
```

**UI 约束**（§6.6）：
- `capability === "limited"` 的 Agent pane 右上角显示琥珀色徽章 "Limited telemetry"
- `markTurnCompleted({ approximate: true })` 时 toast 文案用"可能已完成"
- Supervisor 按钮在 Limited session 上被禁用

### 7.4 新 Provider 接入指南

新 Provider 的接入只需：

1. 在 `packages/providers/src/<name>/` 下创建 `definition.ts`
2. 实现 `ProviderDefinition` 接口（主要是 `buildCommand` + `hooks`）
3. 在 `packages/providers/src/registry.ts` 中 import 并注册
4. 前端无改动（Provider 列表由 `provider.list` command 动态拉取）

如果 Provider 有 hooks 能力 → 走 Full 模式；没有 → 填 `stdoutHeuristics` 走 Limited 模式。

### 7.5 Hooks Manager 工作流

```
Server 启动时
  ├─ 读取 runtime.json → 写入新的 { port, token, startedAt }
  ├─ 部署 bridge 脚本到 ~/.coder-studio/hooks/
  │     ├─ claude-bridge.js
  │     └─ codex-bridge.js
  │   (计算内容 hash，不变则跳过；变了则原子替换)
  │
  └─ 对每个注册 Provider:
        ├─ 读取 provider.hooks.resolveGlobalConfigPath()
        ├─ 解析现有 config (不存在或解析失败 → 以空对象为基础)
        ├─ 调 provider.hooks.extractManaged(config) 检测现有 managed hooks 版本
        ├─ 如果版本 == markerVersion → 跳过（已是最新）
        ├─ 否则:
        │     ├─ 备份原 config 到 ~/.coder-studio/backups/<provider>-<ts>.json
        │     ├─ merged = provider.hooks.mergeInto(config, managed)
        │     ├─ 原子写入：temp 文件 + rename
        │     └─ 更新 hook_registrations 表: { injected_at, marker_version, last_status: "ok" }
        └─ 失败处理:
              ├─ 写错误日志
              ├─ 更新 hook_registrations: last_status = "error", last_error = ...
              └─ 广播 notification.toast 提示用户
```

HTTP endpoint 接收 hook 回调：

```typescript
// packages/server/src/hooks/endpoint.ts
app.post<{
  Params: { event: string };
  Querystring: { token: string };
}>("/internal/hooks/:event", async (req, reply) => {
  // 1. 只接受 127.0.0.1（即使 server 绑定 0.0.0.0，此路由也强制校验）
  if (!["127.0.0.1", "::1"].includes(req.ip)) {
    return reply.code(403).send({ error: "forbidden" });
  }
  
  // 2. Token 校验
  if (req.query.token !== runtime.token) {
    return reply.code(403).send({ error: "invalid_token" });
  }
  
  // 3. 解析 payload
  const payload = req.body;
  
  // 4. 识别 provider（根据 event 名前缀或 payload 结构）
  const providerId = detectProvider(req.params.event, payload);
  const provider = providerRegistry.get(providerId);
  if (!provider) {
    return reply.send({ ok: true, status: "unknown_provider" });
  }
  
  // 5. 解析事件
  const event = provider.hooks.parseEvent(req.params.event, payload);
  if (!event) {
    return reply.send({ ok: true, status: "unparsed" });
  }
  
  // 6. 路由到对应 session
  // payload 里应该有 session 标识 (CODER_STUDIO_SESSION_ID env 被 hook 继承)
  const sessionId = event.sessionId;
  sessionManager.onHookEvent(sessionId, event);
  
  return reply.send({ ok: true });
});
```

**重要安全点**：
- 路由注册在 Fastify 的"无 auth 范围"里
- 路由只接受 `127.0.0.1` / `::1`
- token 校验防止恶意本地进程伪造
- token 每次 server 启动都是新的

Bridge 脚本实现：

```javascript
// packages/hook-bridge/src/claude-bridge.js
// 这个文件必须零依赖（只用 node 标准库）
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");

const event = process.argv[2];
const runtimePath = path.join(os.homedir(), ".coder-studio", "runtime.json");

let runtime;
try {
  runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
} catch {
  process.exit(0);  // Coder Studio 未运行 → 静默退出
}

let payload = "";
try {
  payload = fs.readFileSync(0, "utf8");  // stdin
} catch {}

let body;
try {
  body = JSON.parse(payload || "{}");
} catch {
  body = { raw: payload };
}

const req = http.request({
  hostname: "127.0.0.1",
  port: runtime.port,
  path: `/internal/hooks/${encodeURIComponent(event)}?token=${encodeURIComponent(runtime.token)}`,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  timeout: 500,
});

req.on("error", () => process.exit(0));  // 失败静默
req.on("timeout", () => { req.destroy(); process.exit(0); });
req.write(JSON.stringify(body));
req.end();

req.on("response", () => process.exit(0));
```

**关键约束：bridge 脚本任何失败都必须静默退出**，不能让 Claude CLI 因为 Coder Studio 未运行而报错或卡住。

---

## 8. Supervisor 系统（Phase 3）

### 8.1 概览

Supervisor 是一个自动化评估系统，周期性地评估 Agent 会话朝目标的进展并注入指导。

### 8.2 架构

```
┌─────────────────┐
│ Supervisor Mgr  │  — 每工作区/每会话 0 或 1 个
└────────┬────────┘
         │
   ┌─────┴─────┐
   ↓           ↓
┌──────┐   ┌────────┐
│ Sched│   │Evaluator│
└──────┘   └────┬───┘
                │
         ┌──────┴───────┐
         │              │
     ┌───┴─────┐    ┌───┴─────┐
     │Injector │    │ History │
     └─────────┘    └─────────┘
```

**职责**：
- **Scheduler**：根据周期配置和会话活动触发评估
- **Evaluator**：构造评估提示（目标 + 最近历史）→ 调用 Anthropic API / OpenAI API（不走 Provider CLI）→ 解析结果
- **Injector**：把指导结果通过 `terminal.input` 命令注入到 PTY（等同用户手动输入）
- **History**：评估周期和结果记录

### 8.3 约束

- **仅 Full 模式 Provider 可启用 Supervisor**（见 §6）
- 配置项放在 session 元数据里，不在 Provider 配置里（因为是会话级特性）
- Supervisor 自己的 API 调用使用用户在设置里配置的 key（独立于 Agent 本身）

### 8.4 UI

`.agent-pane-supervisor-card`（PRD §16.3.1）作为 AgentPane 的一个子区域。通过 `supervisorAtomFamily(sessionId)` 订阅状态。

### 8.5 Phase 分布

| 特性 | Phase |
|---|---|
| Supervisor 数据模型和 API 骨架 | 预留到 Phase 1 的 core 层 |
| 全部实现 | Phase 3 |

---

## 9. 多 Tab 并发（演进路径）

### 9.1 Phase 1：单 Writer 强制

- `WsHub.writerId` 单值
- 第二个 tab 连接时立即返回 `{status: "rejected", reason: "another_tab_active"}`
- 新 tab 显示接管弹窗
- 接管命令 `tab.takeover` 关闭旧 WS 连接、替换 writerId

**架构预留点**：
- `WsHub.clients` 是 Map，虽然 Phase 1 最多 1 个 writer，但结构支持 N 个
- 所有 Command handler 的入口都通过 `assertWriter(clientId)` 中间层——Phase 1 只校验 `clientId === writerId`，Phase 2 替换成 role 判断
- 广播函数按 `client.subscribedTopics` 过滤，Phase 1 最多 1 个 client 但多 client 广播逻辑是免费的

### 9.2 Phase 2：Writer + Read-only Observer

- `WsHub.clients` 可以有多个 observer
- 只有 writer 能发 command（server 拒绝 observer 的 command，返回 `read_only_mode` 错误）
- Observer 收到全部 event（可以看到正在发生什么）
- Observer tab UI 顶栏显示 "Read only" 徽章 + "Take control" 按钮
- Take control = 发 command `tab.takeover` → writer 收到 `takeover_requested` 事件 → 弹窗选择允许/拒绝（可配置超时自动允许）

### 9.3 Phase 3：完整控制器/观察者（PRD §7.6）

- Writer 周期心跳（10s/20s 分别对应 visible/hidden tab）
- 心跳超时 → observer 自动发起接管
- Deadline-based handover：接管请求携带 deadline；writer 在 deadline 内主动释放（响应）或被动释放（超时）
- 离线锁检测：如果 writer 崩溃了，observer 上面的 server 代表 writer 标记为已释放

**约束**：Phase 3 实现不能重写 Phase 1/2 的基础代码，只能**在 `WsHub` 的 writer 选举函数内扩展**。

---

## 10. 错误处理和降级清单

### 10.1 错误分类

| 层 | 错误类型 | 处理方式 |
|---|---|---|
| 协议层 | 未知 op、schema 不匹配 | 返回 `result` 携带 `error.code = "invalid_request"` |
| 业务层 | 业务规则拒绝（如文件冲突） | 返回具体 error code（如 `file_changed_externally`） |
| 系统层 | ENOENT, EACCES, EBUSY 等 | 包装成 `fs_error`, `permission_denied` 等 |
| Agent 层 | PTY 启动失败、崩溃 | Session 进入 `unavailable` 状态，带错误详情 |
| Provider 层 | Hooks 注册失败 | `notification.toast` 红色警告 + hook_registrations 表记录 |
| 认证层（P2+） | 凭证无效、封锁等 | 走认证错误码 |

### 10.2 降级清单

| 场景 | 降级策略 |
|---|---|
| WS 断线 | 前端只读模式；命令排队；指数退避重连 |
| WS 心跳超时（ping/pong）| 主动 `close(4005)` → 进入重连 |
| WS 断线 + lastSeq 超过 ring buffer | 自动触发 `workspace.snapshot` 全量刷新 |
| Server 重启（serverInstanceId 失配） | 跳过 resync，对当前 workspace 走 snapshot 全量重建 |
| WS 回压超过高水位线 | 丢弃可丢 topic（terminal.output），在流里插入"N bytes skipped"提示 |
| WS 回压超过 critical 水位线 | 强制 close(4003) → client 走重连+resync |
| Tab 刷新同 origin 快速重连 | writer 释放后 3s 宽限期内静默授予权限，不弹 takeover |
| Hook 事件到达早于 session.create | 进入 pending pool 暂存 5s，create 完成后补消费 |
| resume_id 30s 未捕获 | session 保持运行；标记 `no_resume_id`；resume 命令拒绝 |
| 残留 runtime.json 指向已死 pid | 覆盖并继续启动 |
| runtime.json 指向存活 pid | abort 启动，提示已有实例 |
| PTY 进程启动失败 | Session 面板 `unavailable` 状态，显示原因 + "Remove" 按钮 |
| Provider CLI 不存在 | runtime check 拒绝启动工作区，提示安装 |
| Provider 能力 Limited | 完成通知用近似文案；Supervisor 禁用；进度条静态 |
| Hooks 全局配置被外部破坏 | 启动时 extract 失败 → 广播警告 toast → 用户需到设置页手动 re-inject |
| Bridge 脚本写入失败（权限） | 启动不 abort；设置页显示 Hook 注册失败 + 错误详情 |
| 文件写入冲突（baseHash 不匹配） | 前端弹对话框："文件已被外部修改" + 选项 |
| Git 操作失败 | 对应 command 返回 error；UI toast 显示 stderr 摘要 |
| SQLite 写失败 | 前置问题（磁盘满？权限？）；server fatal 退出并打印错误 |

### 10.3 一致性约束

- **server 是唯一真源**：前端收到的 result/event 表示"server 已确认"
- 乐观更新仅限**纯 UI 临时态**（如点按钮后禁用按钮避免重复点击）
- 数据一致性冲突时，server 赢

---

## 11. 测试策略

### 11.1 覆盖层级

| 层 | 工具 | 覆盖范围 | 目标覆盖率 |
|---|---|---|---|
| 单元测试 | Vitest | 纯逻辑（protocol 解析、git 解析、merge-writer、降级检测） | 80% |
| 集成测试 | Vitest + supertest | server 完整启动 + 真实文件系统 + 真实 git + 模拟 PTY | 关键路径 100% |
| 组件测试 | Vitest + Testing Library | React 组件逻辑 | 关键组件 80% |
| E2E | Playwright | 端到端用户路径 | Phase 1 只覆盖 5-6 条 |

### 11.2 关键集成测试清单（Phase 1）

1. **打开工作区完整流程**：创建临时目录 + git init → `workspace.open` command → 断言 fs watcher 附加、git watcher 附加、workspace event 广播
2. **会话启动 + Hook 回调**：注册一个假 Provider，它的 `buildCommand` 返回一个 shell 脚本；该脚本触发"模拟 SessionStart hook"POST；断言 session 状态变为 running + resumeId 被设置
3. **Hooks merge-write 不破坏原配置**：预先放一个 `.claude/settings.json` 里有 MCP servers、model、现有 hooks；调 `ensureGlobalConfig(claudeDefinition)`；断言 hooks.SessionStart 被添加了一项 _cs_managed；其它字段完全不变
4. **文件写入冲突**：两个并发 write 模拟外部修改；第二次 write 应返回 conflict
5. **Git status 解析**：准备一个有 staged/modified/untracked/deleted 的仓库；`git.status` 返回的结构正确分组
6. **WS 断线重连补发**：客户端连接 → 订阅 topic → server 推 3 个事件 → 客户端主动断 → 重连 → 发 resync with lastSeen=1 → 断言收到 event 2 和 3
7. **单 writer 强制**：第一个 client 连接成功；第二个立即被拒；第二个发 tab.takeover → 第一个收到 takeover 事件 + 断开；第二个成为 writer
8. **文件路径逃逸防护**：`file.read` with `../../etc/passwd` 被拒绝
9. **降级模式 session ID 提取**：Limited Provider + stdout 含 "Session ID: abc123" → session.resumeId 被提取

### 11.3 E2E 关键路径（Phase 1 Playwright）

1. **启动 server → 打开首页 → 点击 "Open Workspace" → 选择目录 → 启动**
2. **在工作区里点击 Claude 按钮启动会话 → 看到终端 → 输入文本并发送**
3. **打开文件 → 修改 → Ctrl+S 保存 → 磁盘确有变更**
4. **Git 面板查看变更 → 暂存 → 输入 commit message → 提交 → 分支 tip 更新**
5. **命令面板 `Cmd+K` → 搜索并触发一个 action**
6. **专注模式 `F` 隐藏侧边栏 → `Escape` 恢复**

### 11.4 Mock 边界

**能 mock 的**：
- Provider CLI 的 PTY 输出（用一个简单的 shell 脚本冒充 claude）
- Anthropic / OpenAI API（Supervisor Phase 3 测试时）
- 外部网络请求

**不能 mock 的**：
- 本地文件系统（用 `fs.mkdtempSync(os.tmpdir() + ...)` 创建临时目录）
- Git CLI（集成测试跑真 git）
- SQLite（用 `:memory:` 数据库）
- WebSocket（用真实 WS client 连本地 server）

### 11.5 TDD 节奏

按 CLAUDE.md 要求：先写测试 → RED → 写实现 → GREEN → 重构 → GREEN → 检查覆盖率。每个 Command handler 至少有一个集成测试。

---

## 12. 数据模型

### 12.1 核心实体

```typescript
// packages/core/src/domain/types.ts

export interface Workspace {
  id: string;
  path: string;
  targetRuntime: "native" | "wsl";
  wslDistro?: string;
  openedAt: number;
  lastActiveAt: number;
  uiState: UiState;
}

// Terminal 是底层原语：PTY + 元数据。不知道 Provider / Session。
export interface Terminal {
  id: string;
  workspaceId: string;
  kind: "agent" | "shell";
  title: string;
  cwd: string;
  argv: string[];
  cols: number;
  rows: number;
  alive: boolean;
  createdAt: number;
  endedAt?: number;
  exitCode?: number;
}

// Session 是业务封装：一个 agent-kind Terminal 之上的 Agent 状态机。
// shell 终端不生成 Session。
export interface Session {
  id: string;
  workspaceId: string;
  terminalId: string;                  // 1:1 指向 Terminal
  providerId: string;
  state: SessionState;
  resumeId?: string;
  capability: "full" | "limited" | "unsupported";
  startedAt: number;
  lastActiveAt: number;
  endedAt?: number;
  completionPercent?: number;          // 仅 Full 模式有
  errorReason?: string;
}

export type SessionState = 
  | "draft"
  | "starting"
  | "running"
  | "idle"
  | "interrupted"
  | "unavailable"
  | "ended";

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  modified: GitFileChange[];
  untracked: GitFileChange[];
  deleted: GitFileChange[];
}

export interface FileNode {
  name: string;
  path: string;          // relative to workspace root
  kind: "file" | "dir";
  children?: FileNode[]; // for dirs; lazy-loaded
  size?: number;
  mtime?: number;
}

export interface Settings {
  defaultProviderId: string;
  notifications: {
    enabled: boolean;
    onlyWhenBackgrounded: boolean;
  };
  appearance: {
    theme: "dark";  // Phase 4 加 light
    terminalRenderer: "standard" | "compatibility";
    locale: "zh" | "en";
  };
  providerConfigs: Record<string, ProviderConfig>;
  shortcuts?: Record<string, string>;  // Phase 4 可自定义
}
```

### 12.2 PRD 功能映射到数据模型

| PRD 功能 | 数据模型位置 |
|---|---|
| 工作区启动 (§7.2) | `workspace.open` command + `Workspace` 实体 |
| 运行时校验 (§7.3) | `runtime.check` command + 非持久化 |
| 多标签并发 (§7.6) | Phase 1 `WsHub.writerId`；Phase 3 `TabSession` |
| Agent 草稿 (§8.4) | 前端 `DraftPane` 组件，不持久化到 server |
| 会话状态 (§8.2) | `Session.state`（状态机；Terminal 的 `alive` 不参与业务） |
| 会话恢复 (§8.7) | `Session.resumeId` + `session.resume`（内部创建新 Terminal） |
| 空闲策略 (§8.8) | `Workspace.uiState.idlePolicy` + server 后台定时器 |
| 文件树 (§9.3) | `FileNode` + `file.readTree` command |
| Git 面板 (§10.1) | `GitStatus` + git.* commands |
| Worktree 检查 (§10.3) | Phase 3 新增 `Worktree` 实体 |
| Agent 会话 PTY (§8) | `Terminal` (kind=agent)，通过 `Session.terminalId` 关联 |
| 独立 shell 面板 (§11.2) | `Terminal` (kind=shell)，**无对应 Session** |
| 命令面板 (§12) | 纯前端，不走 server |
| 设置 (§13) | `Settings` + `settings.get/update` |
| 专注模式 (§14) | 前端 `focusModeAtom` |
| 通知 (§15) | 前端 browser Notification API + 声音资源 |
| Supervisor (§16) | Phase 3 新增 `Supervisor` 实体 |
| i18n (§17) | `Settings.appearance.locale` + 前端 i18n 模块 |

---

## 13. 关键序列图

### 13.1 打开工作区

```
User        Web        WsClient     WsHub      WorkspaceMgr    ChokidarWatcher   Db
  │          │            │           │              │                │          │
  │─"Open"──▶│            │           │              │                │          │
  │          │──dispatch─▶│           │              │                │          │
  │          │            │─cmd(open)▶│              │                │          │
  │          │            │           │─handleOpen──▶│                │          │
  │          │            │           │              │─validator─────▶│          │
  │          │            │           │              │◀───────────────│          │
  │          │            │           │              │─runtimeCheck──▶│          │
  │          │            │           │              │◀───────────────│          │
  │          │            │           │              │─db.create─────▶│          │
  │          │            │           │              │◀───────────────│          │
  │          │            │           │              │──attach──────▶ │          │
  │          │            │           │              │◀───────────────│          │
  │          │            │           │              │─broadcast(meta)│          │
  │          │            │           │◀─────────────│                │          │
  │          │            │◀─event────│              │                │          │
  │          │◀─result────│            │              │                │          │
  │          │─setAtom──▶                              │                │          │
  │◀─UI render                                         │                │          │
```

### 13.2 启动 Agent 会话（Full 模式）

```
User  Web    WsHub   SessionMgr   TerminalMgr   Provider   PtyHost   Claude CLI  Bridge  HooksEndpoint  EventBus
 │     │      │          │             │           │         │          │         │          │            │
 │─Click▶     │          │             │           │         │          │         │          │            │
 │     │─cmd─▶│          │             │           │         │          │         │          │            │
 │     │      │─create──▶│             │           │         │          │         │          │            │
 │     │      │          │─buildCmd───────────────▶│          │          │         │          │            │
 │     │      │          │◀──argv,env──│           │          │          │         │          │            │
 │     │      │          │─create(spec)▶           │          │          │         │          │            │
 │     │      │          │             │─spawn───▶ │          │          │         │          │            │
 │     │      │          │             │           │─starts──▶│          │         │          │            │
 │     │      │          │             │◀─onData──────────────│◀stdout───│         │          │            │
 │     │      │          │             │─broadcast(terminal.output)──────────────────────────────────▶    │
 │     │      │◀─direct broadcast──────│           │          │          │         │          │            │
 │     │◀─ev──│          │             │           │          │          │         │          │            │
 │     │      │          │             │           │          │          │ SessionStart hook fires        │
 │     │      │          │             │           │          │          │─spawn bridge─▶    │            │
 │     │      │          │             │           │          │          │         │─POST───▶│            │
 │     │      │          │◀─onHookEvent(start,resumeId)───────────────────────────────────────│            │
 │     │      │          │─applyHookEvent→state=running                                                    │
 │     │      │          │─emit(session.state.changed)─────────────────────────────────────────────────▶  │
 │     │      │◀─subscribed: broadcast(session.state)──────────────────────────────────────────────────── │
 │     │◀─ev──│                                                                                           │
 │     │─setAtom(state=running)                                                                            │
 │◀UI                                                                                                      │
```

要点：TerminalManager 的输出走**直调 Broadcaster**（高频），SessionManager 的状态变更走**EventBus → WsHub 订阅后广播**（低频语义事件）。WsHub 同时扮演 Broadcaster 和 EventBus 订阅者两个角色。

### 13.3 Ctrl+S 保存文件

```
User        Web         Jotai          WsHub       FileIO       Disk
  │          │             │             │            │          │
  │─Cmd+S───▶│             │             │            │          │
  │          │─dispatch──▶                │            │          │
  │          │─cmd(write,baseHash)────▶│              │          │
  │          │             │             │─writeFile─▶│          │
  │          │             │             │            │─readHash▶│
  │          │             │             │            │◀─hash────│
  │          │             │             │            │─write───▶│
  │          │             │             │            │◀─ok──────│
  │          │             │             │◀───ok──────│          │
  │          │             │◀─result──────│            │          │
  │          │◀─setDirty(false)                        │          │
  │◀─UI                                                │          │
```

若 `currentHash !== baseHash` → `FileIO` 抛 `ConflictError` → result error → 前端弹对话框。

---

## 14. Phase 路线图（详细）

### 14.1 Phase 1 — MVP（档位 2）

**目标**：Spencer 每天能用它替代当前工具栈。

**必须有**：
- [x] 全部 monorepo 骨架 (core / providers / server / web / cli / hook-bridge)
- [x] Server HTTP + WebSocket（单 writer）
- [x] 协议层完整实现（Command / Event / Subscribe / Resync）
- [x] SQLite schema v1 (workspaces, terminals, sessions, provider_configs, user_settings, hook_registrations)
- [x] 工作区：创建、打开、关闭、切换、持久化
- [x] 文件树：懒加载、刷新、文件搜索
- [x] Monaco 编辑器：打开、编辑、保存、baseHash 冲突检测
- [x] Git：状态显示、暂存/取消暂存/丢弃、commit、diff 显示 (Monaco diff)
- [x] Agent 会话：草稿启动 Claude、运行、中断、面板分割（垂直/水平/嵌套）
- [x] Agent 会话：resume（通过 hooks 拿 resume_id + session.resume 命令）
- [x] Shell 终端：底部面板、多终端、切换、关闭
- [x] xterm + webgl 渲染；ring buffer + 断线补发
- [x] Provider 系统：Claude (Full)、Codex (Limited)
- [x] Hooks Manager：全局 merge-write、bridge 部署、runtime.json、endpoint
- [x] Limited 模式降级：stdout 启发式、近似完成检测
- [x] 通知：浏览器 Notification API (Agent 完成时)、声音提示
- [x] 命令面板（基础 action set）
- [x] 专注模式
- [x] i18n 框架（只有 zh）
- [x] 设置页最小子集（默认 Provider、Claude 配置、Hook 注入按钮、语言切换）
- [x] 单 writer 强制 + takeover 弹窗
- [x] Aurora Mint 深色主题
- [x] localhost:127.0.0.1 only，no auth
- [x] 关键集成测试 + 基础 E2E

**明确不做**（Phase 2+）：
- Supervisor
- 认证系统
- i18n 英文翻译
- 多 tab Writer/Observer
- Worktree 检查弹窗
- 日志持久化 / View full log
- 浅色主题
- 归档历史 UI
- 单二进制打包

### 14.2 Phase 2 — Shareable（档位 3）

- [ ] 认证系统全部（登录页、HttpOnly cookie、IP 黑名单、超时）
- [ ] `--host`, `--password`, `--no-auth` CLI 参数
- [ ] 英文翻译（`en.json`）
- [ ] 设置页完整（Codex 配置、外观分区、所有字段）
- [ ] Provider 设置动态表单（基于 Zod schema 生成）
- [ ] 命令预览（设置里显示生成的有效命令）
- [ ] Multi-tab：Writer + Observer（手动 takeover）
- [ ] 完整 PRD §20 错误状态处理
- [ ] 更多命令面板 actions
- [ ] 通知"仅后台时"开关
- [ ] 完整 E2E 覆盖（15+ 条路径）
- [ ] 发布到 npm

### 14.3 Phase 3 — Full PRD（档位 4）

- [ ] **Supervisor 系统**：数据模型、Evaluator、Injector、Scheduler、UI 卡片、目标对话框
- [ ] **Worktree 检查**：弹窗、状态/差异/树三标签
- [ ] **完整控制器/观察者**：心跳、deadline handover
- [ ] **空闲策略自动化**：自动暂停、压力模式
- [ ] **任务队列 UI**：可视化队列状态
- [ ] **完整归档/调度中心**：历史会话浏览
- [ ] **远程 Git 工作区** UI 入口（后端支持已有）
- [ ] Claude PreToolUse/PostToolUse 进度事件（更细的进度条）

### 14.4 Phase 4 — Quality & Future

- [ ] 输出持久化方案（基于实际使用数据重新设计）
- [ ] 跨会话搜索
- [ ] 单二进制（Node SEA）
- [ ] Docker 镜像
- [ ] Tauri 桌面壳（可选）
- [ ] 浅色主题
- [ ] 性能优化：虚拟滚动、代码分割、service worker 缓存
- [ ] MCP server 管理 UI（Claude / Codex 各自的 MCP 配置）
- [ ] 自定义快捷键 UI
- [ ] 无障碍完善（PRD 附录 C）

### 14.5 架构不变的保证

Phase 2/3/4 的所有新增功能都能通过**往现有模块填代码**实现，无需重构：

| Phase 2/3/4 新增 | 填入位置 |
|---|---|
| 认证 | `server/src/auth/` + `authPlugin`（Phase 1 已占位） |
| i18n 英文 | `web/src/locales/en.json` |
| Supervisor | `server/src/supervisor/` + `web/src/features/supervisor/` |
| Writer/Observer | `WsHub` 类内部升级；对外 API 不变 |
| Worktree 管理 | `server/src/git/worktree.ts` + 前端 feature |
| 输出持久化 | `RingBuffer` 接口替换为 `PersistentBuffer`；接口签名不变 |
| 单二进制 | 独立的 `packages/cli-bundle`，不影响其它包 |
| 浅色主题 | CSS 变量 override；组件零改动 |

---

## 15. 风险和未解决问题

### 15.1 已识别风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| node-pty 在某些 Linux 发行版构建困难 | MVP 安装门槛 | 用 `prebuild-install`，大部分平台走 prebuilt binary |
| Claude Code 的 hook payload 格式变动 | SessionStart/Stop 解析失败 | event-parser 隔离；集成测试每次 Claude CLI 升级后跑 |
| Codex 的 stdout 格式变动 | Limited 模式 session ID 提取失效 | 已是 Limited 模式，用户预期较低 |
| Monaco bundle 体积大 (~10MB gzip 前) | 首次加载慢 | Vite 代码分割；Monaco worker 独立 chunk |
| xterm WebGL addon 不支持某些 GPU | 渲染崩溃 | 捕获 addon load 异常 → 降级到 canvas |
| 大仓库 `chokidar` 监听开销 | 内存/CPU 占用 | 忽略 node_modules / .git / 超大目录；测试大仓库 |
| SQLite 数据库损坏 | 设置/归档丢失 | WAL 模式 + 启动时 PRAGMA integrity_check |
| 全局 Hooks 注入的边缘情况（只读用户目录、SELinux 策略等） | Hook 无法注册 | 优雅降级：显示错误，手动注入按钮，详细排障文档 |

### 15.2 待调研（写入实施前确认）

- **Codex CLI 是否有 Claude Code 等效的 hooks 机制？** 如有 → 可把 capability 从 limited 提到 full；如无 → stdout 启发式的具体 pattern 在实现时测真机
- **Claude Code hooks 的具体 payload schema**（字段名、是否通过 stdin 还是 env 还是 arg 传递）→ 实现 `event-parser.ts` 前要确认
- **Claude settings.json 的正确字段结构**（PRD 里写的是 "hooks"，但 Claude 实际 schema 需要以最新官方文档为准）
- **node-pty 在 Windows 上的行为**（Phase 1 建议只测 Linux + macOS，Windows 作为 best-effort）

### 15.3 未解决的设计问题

- **多文件同时打开编辑**：Phase 1 是否支持多个文件同时 dirty？倾向"支持但不做 tab 栏 UI"——Monaco 单 editor，切换文件时若当前脏了提示用户（或自动暂存到 localStorage 草稿），Phase 2 再引入 tab 栏
- **大文件打开**：多大算大？>1MB 的文件如何处理？建议 >2MB 不让 Monaco 打开，改用只读 `<pre>` 渲染（Phase 1 实现这个阈值）
- **文件编码非 UTF-8**：Phase 1 只处理 UTF-8，其它编码提示"暂不支持"
- **二进制文件**：文件树能看到但打开时提示"二进制文件不支持预览"

以上问题会在 Phase 1 的实施计划（`docs/superpowers/plans/`）里逐项给出简单默认值。

---

## 16. 验收规范

本章节定义 Coder Studio 的完整验收体系。验收分为两阶段：
1. **E2E subagent 自动化验收**：在所有开发任务完成后执行，覆盖功能验收与视觉验收。
2. **开发者人工自验**：仅在自动化验收全部通过后执行，作为最终交付前把关。

验收目标是确保每个 Phase 的交付结果同时对齐：
- `docs/PRD.zh-CN.md` 中定义的功能需求
- `docs/visual-spec.html` 中定义的视觉规范与设计稿
- 本技术设计文档中的架构边界、降级策略与实现约束

---

### 16.1 验收体系概述

| 验收类型 | 覆盖内容 | 执行方式 | 通过门槛 |
|---|---|---|---|
| **功能验收** | PRD 功能路径、边界情况、数据完整性、协议一致性 | Playwright + 真环境 E2E | 全部通过 |
| **视觉验收** | 颜色、字体、间距、组件样式、交互状态、动画 | 截图对比 + CSS/DOM 检查 | 全部通过；截图像素差异率 ≤ 0.1% |
| **人工验收** | 真实业务场景、主观体验、自动化遗漏问题 | 开发者手动执行 | 无阻塞问题 |

**核心原则：**

1. **自动化验收先行**：开发完成后先跑 E2E subagent 验收，不通过不得进入人工验收。
2. **验收失败不得交付**：功能或视觉任一项失败，必须修复并重新执行完整自动化验收。
3. **视觉必须对齐设计稿**：不仅要满足视觉 token 约束，还要与 `visual-spec.html` 和关键设计稿截图对齐。
4. **报告必须可追溯**：每次自动化验收和人工验收都要落盘到当前项目目录。

---

### 16.2 验收执行流程

```text
所有开发任务完成
    ↓
启动 E2E subagent 验收
    ↓
自动化验收执行
  ├─ 功能验收（按 Phase 清单）
  ├─ 视觉验收（截图对比 + CSS/DOM 检查）
  └─ 生成自动化验收报告
    ↓
结果判定
  ├─ 未通过 → 修复问题 → 重新执行完整自动化验收
  └─ 全部通过 → 进入开发者人工自验
    ↓
开发者人工自验
  ├─ 读取自动化验收报告
  ├─ 按人工验收清单执行真实场景验证
  └─ 补充人工验收结论
    ↓
Phase 正式交付
```

**自动化验收执行要求：**

- 执行主体：subagent（E2E / Playwright）
- 执行环境：真实本地环境，不允许将文件系统、Git CLI、SQLite、WebSocket 替换成 mock
- 执行时机：某个 Phase 的所有开发任务完成后
- 执行范围：当前 Phase 全量清单；高 Phase 验收必须包含低 Phase 全量回归

**人工验收执行要求：**

- 执行主体：开发者本人
- 前置条件：自动化验收报告中所有功能验收、视觉验收全部通过
- 目标：确认自动化未覆盖的主观体验、真实工作流完整性与交付信心

---

### 16.3 验收报告规格

验收报告必须存放在**当前项目目录**，不得写入全局目录。

```text
docs/验收报告/
├── phase-1/
│   ├── 2026-04-20-自动化验收.json
│   ├── 2026-04-20-人工验收.json
│   └── baseline-screenshots/
├── phase-2/
├── phase-3/
└── phase-4/
```

**命名规范：**

- 自动化验收报告：`<YYYY-MM-DD>-自动化验收.json`
- 人工验收报告：`<YYYY-MM-DD>-人工验收.json`
- 基线截图目录：`baseline-screenshots/`

**自动化验收报告结构：**

```json
{
  "phase": "phase-1",
  "验收时间": "2026-04-20T14:30:00Z",
  "验收类型": "自动化验收",
  "执行者": "e2e-subagent",
  "总体结果": "通过",
  "功能验收": {
    "总项数": 57,
    "通过数": 57,
    "失败数": 0,
    "失败项清单": []
  },
  "视觉验收": {
    "总项数": 17,
    "通过数": 17,
    "失败数": 0,
    "失败项清单": [],
    "截图对比结果": {
      "总对比数": 12,
      "像素差异率": "0.02%",
      "异常对比": []
    }
  }
}
```

**人工验收报告结构：**

在自动化验收报告基础上增加：

```json
{
  "人工验收": {
    "执行者": "developer-name",
    "执行时间": "2026-04-20T15:00:00Z",
    "通用验收评价": {
      "整体用户体验流畅度": "良好",
      "视觉质量主观判断": "符合预期",
      "真实业务场景完整体验": "优秀"
    },
    "Phase 交付建议": "可以交付"
  }
}
```

---

### 16.4 Phase 1 MVP E2E 验收清单

#### 16.4.1 验收前置条件

- [ ] Server 已启动（`pnpm dev` 或 `coder-studio serve`）
- [ ] 测试环境准备完成：真实临时工作区目录 + 真实 Git 仓库
- [ ] Provider CLI 可用：Claude Code CLI 已安装并可执行
- [ ] Browser 已启动：Playwright 可连接测试浏览器
- [ ] Baseline 截图已准备：`docs/验收报告/phase-1/baseline-screenshots/`

#### 16.4.2 功能验收清单

##### 一、工作区管理验收（PRD §7）

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **F1-01** | 启动新工作区 | 1. 打开应用首页；2. 点击 `Open Workspace`；3. 选择临时目录；4. 点击确认 | 1. 成功进入工作区页面；2. 文件树显示目录内容；3. 连接状态为 `connected`；4. `workspace.open` 成功 |
| **F1-02** | 文件树浏览 | 1. 点击 `README.md`；2. 展开 `src`；3. 点击 `src/index.ts` | 1. 文件树结构正确；2. 展开/折叠正常；3. Monaco 正确打开文件 |
| **F1-03** | 文件树刷新 | 1. 外部创建新文件；2. 点击刷新按钮 | 1. 新文件出现在文件树；2. watcher 工作正常 |
| **F1-04** | 关闭工作区 | 1. 点击工作区关闭按钮；2. 确认关闭 | 1. 返回欢迎页；2. 连接断开；3. `workspace.close` 成功 |
| **F1-05** | 工作区恢复 | 1. 打开工作区；2. 关闭应用；3. 重新打开 | 1. 已打开工作区列表可恢复；2. 状态恢复符合预期 |

##### 二、Agent 会话管理验收（PRD §8）

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **F1-06** | 启动 Agent 会话 | 1. 点击 `Claude`；2. 点击 `Start Session` | 1. Agent 终端出现；2. Session 状态为 `running`；3. PTY 启动成功；4. `resumeId` 已设置 |
| **F1-07** | Agent 输入交互 | 1. 输入 `创建一个 hello.ts 文件`；2. 点击发送 | 1. 输出流正常；2. 文件树出现新文件；3. 输入被正确写入 PTY |
| **F1-08** | 停止 Agent 会话 | 1. 点击停止按钮 | 1. PTY 被终止；2. Session 状态变为 `stopped`；3. 终端显示终止信息 |
| **F1-09** | Agent 会话恢复 | 1. 点击 `Resume Session` | 1. 基于 `resumeId` 恢复成功；2. 状态回到 `running` |
| **F1-10** | 多 Agent 并行 | 1. 启动两个 Claude 会话；2. 分别输入不同任务 | 1. 两个会话并行运行；2. 状态互不干扰 |

##### 三、代码编辑器验收（PRD §9）

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **F1-11** | 打开文件编辑 | 1. 打开 `src/index.ts`；2. 修改内容 | 1. Monaco 正确渲染；2. 文件进入 dirty 状态 |
| **F1-12** | 保存文件 | 1. 修改文件；2. `Ctrl+S` 保存 | 1. 文件写入磁盘成功；2. dirty 状态消失；3. `file.write` 成功 |
| **F1-13** | 大文件处理 | 1. 创建 >2MB 文件；2. 尝试打开 | 1. 不进入 Monaco；2. 改为只读预览；3. 显示提示 |
| **F1-14** | 二进制文件 | 1. 点击图片文件 | 1. 提示二进制文件不可预览 |
| **F1-15** | 路径逃逸防护 | 1. 发送 `file.read ../../etc/passwd` | 1. 请求被拒绝；2. 返回安全错误 |

##### 四、Git 集成验收（PRD §10）

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **F1-16** | Git 状态显示 | 1. 创建新文件；2. 修改已有文件；3. 打开 Git 面板 | 1. Untracked/Modified 分组正确 |
| **F1-17** | Git 暂存 | 1. 点击暂存按钮 | 1. 文件进入 Staged；2. 真 git 状态一致 |
| **F1-18** | Git 取消暂存 | 1. 点击取消暂存 | 1. 文件回到未暂存区域 |
| **F1-19** | Git 提交 | 1. 暂存全部；2. 输入 commit message；3. 提交 | 1. 提交成功；2. Git 面板清空；3. `git log -1` 可验证 |
| **F1-20** | Git 差异查看 | 1. 修改文件；2. 打开 diff | 1. Monaco diff 视图正确渲染 |

##### 五、终端系统验收（PRD §11）

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **F1-21** | Agent 终端输出 | 1. 启动会话并触发输出 | 1. xterm 实时渲染；2. scrollback 正常 |
| **F1-22** | Shell 终端启动 | 1. 新建 `Shell Terminal` | 1. shell 提示符出现；2. PTY 启动成功 |
| **F1-23** | Shell 终端交互 | 1. 输入 `ls -la` 并执行 | 1. 命令输出正确显示 |
| **F1-24** | 终端面板布局 | 1. 切换标签；2. 调整高度 | 1. 布局保存并可恢复 |

##### 六、命令面板验收（PRD §12）

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **F1-25** | 打开命令面板 | 1. 按 `Cmd/Ctrl+K` | 1. 浮层出现；2. 输入框聚焦 |
| **F1-26** | 命令搜索执行 | 1. 搜索 `git`；2. 执行一个命令 | 1. 过滤正确；2. 命令成功执行 |

##### 七、专注模式验收（PRD §14）

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **F1-27** | 进入专注模式 | 1. 按 `F` | 1. 侧边栏/底部面板隐藏；2. 中央区扩大 |
| **F1-28** | 退出专注模式 | 1. 按 `Escape` | 1. 布局恢复；2. 状态恢复 |

##### 八、WebSocket 协议验收（Spec §3）

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **F1-29** | WS 连接建立 | 1. 打开工作区；2. 监听连接事件 | 1. 收到 `connection.ready`；2. 状态为 `connected` |
| **F1-30** | WS 断线重连 | 1. 主动断开连接；2. 等待自动重连 | 1. 自动重连；2. `resync` 补发 missed events |
| **F1-31** | 多 Tab 独占 | 1. 两个 tab 打开同一工作区 | 1. 第二个 tab 被拒绝或进入只读策略（按当前 Phase 约束） |

##### 九、边界情况验收（PRD §20）

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **F1-32** | 文件写入冲突 | 1. UI 修改文件；2. 外部同时修改；3. 保存 | 1. 检测冲突；2. UI 显示冲突提示 |
| **F1-33** | 非 Git 目录 | 1. 打开非 Git 工作区；2. 查看 Git 面板 | 1. 显示 `Not a Git repository`；2. Git 操作禁用 |
| **F1-34** | Provider CLI 未安装 | 1. 让 CLI 不在 PATH；2. 启动会话 | 1. 显示未安装错误；2. Session 创建失败 |
| **F1-35** | PTY 异常终止 | 1. 启动会话；2. kill PTY | 1. Session 变为 `error`；2. UI 显示异常终止 |
| **F1-36** | 大仓库性能 | 1. 打开大仓库；2. 刷新 Git 状态 | 1. UI 无明显卡顿；2. 刷新时间可接受 |

##### 十、数据完整性验收

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **F1-37** | 文件内容一致性 | 1. UI 保存；2. 读取磁盘；3. 刷新页面 | 1. UI 内容与磁盘一致 |
| **F1-38** | Git 状态一致性 | 1. UI 执行 Git 操作；2. 真 `git status` 验证 | 1. UI 与真实 Git 结果一致 |
| **F1-39** | Session 状态一致性 | 1. 启动会话；2. 刷新页面 | 1. Server 侧 session 状态可恢复且正确 |
| **F1-40** | WebSocket 消息完整性 | 1. 监听消息流；2. 校验结构 | 1. Command/Event schema 与 Spec 一致 |

#### 16.4.3 视觉验收清单

**前置准备：**

- Baseline 截图目录：`docs/验收报告/phase-1/baseline-screenshots/`
- 截图对比允许像素差异率：`≤ 0.1%`
- 视觉验收必须同时满足：截图对比通过 + CSS/DOM token 检查通过

##### 一、全局样式验收

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **V1-01** | 色彩系统对齐 | 1. 打开首页；2. 检查全局 CSS 与 DOM 计算样式 | 1. 无硬编码颜色；2. 背景/文本/强调色均使用 token；3. 对齐 `visual-spec.html` |
| **V1-02** | 字体系统对齐 | 1. 检查 UI 与代码区字体 | 1. UI 用 IBM Plex Sans；2. 代码区与终端用 JetBrains Mono |
| **V1-03** | 间距系统对齐 | 1. 检查 padding/margin/gap | 1. 全部使用 spacing token；2. 4px grid 合规 |

##### 二、核心组件视觉验收（截图对比）

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **V1-04** | 欢迎页整体视觉 | 1. 打开首页；2. 截图；3. 对比 baseline | 1. 主布局、标题、按钮、背景全部对齐 |
| **V1-05** | 顶栏视觉 | 1. 打开工作区；2. 截取顶栏 | 1. 顶栏高度、标签样式、圆角对齐 |
| **V1-06** | 文件树视觉 | 1. 截取文件树面板 | 1. 背景、图标、hover 状态对齐 |
| **V1-07** | Agent 面板视觉 | 1. 启动会话；2. 截图 | 1. 输入框、状态点、按钮样式对齐 |
| **V1-08** | Agent 终端视觉 | 1. 截取终端区域 | 1. 终端背景、字体、颜色对齐 |
| **V1-09** | Monaco 编辑器视觉 | 1. 打开文件；2. 截图 | 1. 主题、行号、背景对齐 |
| **V1-10** | Git 面板视觉 | 1. 打开 Git 面板；2. 截图 | 1. 徽章、按钮、输入框样式对齐 |
| **V1-11** | Shell 终端视觉 | 1. 启动 shell 终端；2. 截图 | 1. 终端标签页和背景样式对齐 |
| **V1-12** | 命令面板视觉 | 1. 打开命令面板；2. 截图 | 1. 浮层、输入框、列表 hover 样式对齐 |

##### 三、交互状态视觉验收

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **V1-13** | 按钮 hover 状态 | 1. 截取默认；2. hover；3. 对比 | 1. 背景变亮但不偏色；2. 过渡时长对齐 |
| **V1-14** | 输入框 focus 状态 | 1. 默认；2. focus；3. 对比 | 1. focus 边框为 `var(--border-focus)` |
| **V1-15** | 按钮 disabled 状态 | 1. 截图禁用按钮 | 1. `opacity: 0.5`；2. `pointer-events: none` |

##### 四、动画效果验收

| # | 验收项 | 测试步骤 | 验证点 |
|---|---|---|---|
| **V1-16** | 模态框入场动画 | 1. 触发模态框；2. 录制动画 | 1. `fadeIn` + `--duration-normal` + `--ease-out` |
| **V1-17** | 侧边栏项目入场动画 | 1. 打开文件树；2. 录制动画 | 1. `slideIn` + `--duration-normal` + `--ease-out` |

**Phase 1 总验收项：**

- 功能验收：40 项
- 视觉验收：17 项
- 总计：57 项自动化验收项

---

### 16.5 Phase 2 Shareable E2E 验收清单

Phase 2 验收必须包含 **Phase 1 的全部 57 项**，并新增以下验收范围：认证系统、设置系统、国际化、Provider 完整接入。

| 模块 | 新增验收项数 | 关键内容 |
|---|---:|---|
| 认证系统 | 6 | 登录、登出、密码修改、认证失效、多设备认证、密码强度 |
| 设置系统 | 8 | 设置页、外观、Provider 配置、Hook 状态、保存恢复、导出 |
| 国际化 | 4 | 语言切换、文本全量走 `t()`、持久化、fallback |
| Provider 完整接入 | 7 | Claude Full、Codex Limited、降级、merge-write、备份恢复 |
| 认证/设置/i18n 视觉验收 | 12 | 认证页、设置页、多语言布局和视觉 |

**Phase 2 总验收项：** 57 + 37 = **94 项**

---

### 16.6 Phase 3 Full PRD E2E 验收清单

Phase 3 验收必须包含 **Phase 1-2 的全部 94 项**，并新增以下验收范围：Supervisor、Worktree、多 Tab 并发。

| 模块 | 新增验收项数 | 关键内容 |
|---|---:|---|
| Supervisor 系统 | 15 | 目标设定、执行跟踪、暂停恢复、通知、历史记录 |
| Worktree 管理 | 8 | 创建、切换、隔离、删除、冲突处理 |
| 多 Tab 并发 | 12 | Writer/Observer、takeover、状态同步、冲突处理 |
| 对应视觉验收 | 18 | Supervisor UI、Worktree 弹窗、多 Tab 指示器 |

**Phase 3 总验收项：** 94 + 53 = **147 项**

---

### 16.7 Phase 4 Quality E2E 验收清单

Phase 4 验收必须包含 **Phase 1-3 的全部 147 项**，并新增性能、稳定性、持久化、打包优化验收。

| 模块 | 新增验收项数 | 关键内容 |
|---|---:|---|
| 性能验收 | 15 | 启动、运行时、资源占用、网络性能 |
| 稳定性验收 | 8 | 长时间运行、异常恢复、极端场景 |
| 持久化验收 | 6 | Session、配置、SQLite 完整性 |
| 打包优化验收 | 4 | bundle split、worker chunk、CSS 压缩 |

**Phase 4 总验收项：** 147 + 33 = **180 项**

---

### 16.8 开发者人工自验指南

开发者人工自验只在自动化验收全部通过后执行，目标是确认自动化难以覆盖的主观体验、真实业务流与交付信心。

#### 16.8.1 通用人工验收项

| # | 验收项 | 验收内容 |
|---|---|---|
| **M-01** | 整体流畅度 | 整体交互是否顺滑，无明显卡顿 |
| **M-02** | 视觉主观质量 | 配色、布局、层次、精致度是否达到可展示水准 |
| **M-03** | 真实业务流完整体验 | 用真实项目完整走一遍工作流 |
| **M-04** | 错误提示友好性 | 错误是否可理解、可恢复 |
| **M-05** | 文档完整性 | 使用与维护文档是否足够支撑交付 |
| **M-06** | 跨功能交互体验 | 编辑/Git/Agent/终端组合使用是否自然 |
| **M-07** | 性能主观感受 | 打开、保存、切换、运行是否符合预期 |
| **M-08** | 多平台兼容性（如适用） | 至少在主要目标平台上验证核心路径 |

#### 16.8.2 Phase 特定人工验收项（概要）

| Phase | 关键人工验收内容 |
|---|---|
| Phase 1 | Agent 辅助开发真实体验、Git 工作流、终端体验、专注模式、多 Agent 并行 |
| Phase 2 | 认证流程、设置可用性、i18n 切换、Provider 配置、朋友试用体验 |
| Phase 3 | Supervisor 目标管理、Worktree 使用体验、多 Tab 真实协作、复杂项目完整验证 |
| Phase 4 | 长时间运行稳定性感受、大项目性能、打包后首次启动体验、跨版本升级 |

#### 16.8.3 人工验收结论规则

- **可以交付**：所有通用项 ≥ `良好`，且无阻塞问题
- **需修复后交付**：存在 major 问题或主观评价为 `差`
- **不能交付**：存在阻塞级问题，必须重新进入修复 → 自动化验收 → 人工验收闭环

---

## 17. 附录

### 17.1 目录和路径约定

```
用户家目录:
~/.coder-studio/
├── data.db                 # SQLite
├── runtime.json            # 当前 server 的 port/token（启动时写）
├── hooks/
│   ├── claude-bridge.js    # bridge 脚本
│   └── codex-bridge.js
├── backups/                # Provider 全局配置备份
│   └── claude-settings.<timestamp>.json
└── logs/                   # Phase 4 才使用

服务端启动参数:
coder-studio serve
  [--port 7500]
  [--host 127.0.0.1]          # Phase 2+ 支持 0.0.0.0
  [--data-dir ~/.coder-studio]
  [--password <hash>]         # Phase 2+
  [--no-auth]                 # Phase 2+，显式禁用
```

### 17.2 版本演进

- 本文档版本：1.0
- 修改需更新文件头版本号 + 在此处加一行变更记录
- 1.0 — 初始版本 (2026-04-13)

### 17.3 术语表

| 术语 | 含义 |
|---|---|
| Provider | Agent CLI 的抽象层（Claude、Codex、...） |
| Full / Limited / Unsupported | Provider 的能力等级 |
| Hook | Provider CLI 主动调用的事件回调 |
| Bridge script | Hook → Coder Studio HTTP 的桥接小脚本 |
| Ring buffer | PTY 输出的内存环形缓冲，用于 WS 断线补发 |
| Writer tab | 拥有写权限的浏览器 tab |
| Managed hook | Coder Studio 写入全局配置的 hook（带 marker） |
| Marker | 用来识别 Coder Studio 写入的配置项的标识 |
| Resume ID | Provider 提供的会话标识，用于 CLI 的 --resume |

---

*文档结束*
