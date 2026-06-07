# Coder Studio Product Spec

本文档定义 Coder Studio 的产品功能规格体系。它不是 PRD，也不是历史设计记录，而是面向开发、测试和后续 AI agent 的功能事实与验收契约。

## 1. 文档目标

Product Spec 只回答四类问题：

- 当前有哪些用户可达或内部可用的功能。
- 每个功能从哪里进入、如何交互、有哪些状态和边界。
- 每个功能依赖哪些前端入口、WebSocket command、server handler、provider 或 core 类型。
- 每个功能如何验收，如何拆成手工或自动化测试用例。

Product Spec 不承担以下职责：

- 不写市场背景、品牌叙事或愿景口号。
- 不复述历史方案、旧 PRD 或过时 specs。
- 不把未接线 UI、实验代码或未来设想写成已实现能力。
- 不替代技术设计文档、实现计划或变更记录。

## 2. 事实来源

新规格以当前代码为准。旧 `docs/PRD*.md`、`docs/superpowers/specs/*`、wiki、promotion 和历史 issue 只能作为线索，不能作为事实依据。

可信事实来源按优先级排列：

1. 用户可达入口：页面、按钮、菜单、快捷键、移动端 Sheet / Drawer。
2. 前端代码：`packages/web/src/app`、`packages/web/src/shells`、`packages/web/src/features`。
3. WebSocket 与命令分发：`packages/server/src/ws/dispatch.ts`、`packages/server/src/commands`。
4. 共享合同：`packages/core/src`。
5. Provider 能力：`packages/providers/src`。
6. 测试证据：`*.test.ts`、`*.test.tsx`、`e2e-ui/specs`。

如果代码、旧文档和 README 描述冲突，以当前代码为准。

## 3. 目录结构

建议目录如下：

```text
docs/product-spec/
  README.zh-CN.md

  modules/
    app-shell.zh-CN.md
    auth.zh-CN.md
    welcome.zh-CN.md
    workspace.zh-CN.md
    workspace-desktop.zh-CN.md
    workspace-mobile.zh-CN.md
    workspace-tabs-layout.zh-CN.md
    agent-sessions.zh-CN.md
    agent-panes.zh-CN.md
    agent-instructions.zh-CN.md
    providers.zh-CN.md
    supervisor.zh-CN.md
    files.zh-CN.md
    editor-preview.zh-CN.md
    search-quick-open.zh-CN.md
    git.zh-CN.md
    worktrees.zh-CN.md
    terminal.zh-CN.md
    settings.zh-CN.md
    diagnostics.zh-CN.md
    monitoring.zh-CN.md
    work-analysis.zh-CN.md
    skills.zh-CN.md
    updates.zh-CN.md
    notifications.zh-CN.md
    command-palette.zh-CN.md
    shortcuts.zh-CN.md
    ui-components.zh-CN.md

  flows/
    startup-and-auth.zh-CN.md
    open-workspace.zh-CN.md
    start-agent-session.zh-CN.md
    file-edit-preview.zh-CN.md
    git-change-review.zh-CN.md
    terminal-recovery.zh-CN.md
    provider-configuration.zh-CN.md

  acceptance/
    smoke.zh-CN.md
    desktop.zh-CN.md
    mobile.zh-CN.md
    server-commands.zh-CN.md
```

目录职责：

- `modules/`：按产品模块记录功能点、状态、边界和验收标准。
- `flows/`：记录跨模块用户流程，用于端到端验收和 e2e 用例设计。
- `acceptance/`：记录全局验收清单，覆盖冒烟、桌面、移动端和 server command 层。

## 4. 模块边界

模块按用户能力和代码边界共同划分。优先保持一个模块内的功能能被同一类用户入口触发，并尽量对应明确的代码目录。

初始模块边界：

| 模块 | 覆盖范围 | 主要代码线索 |
| --- | --- | --- |
| App Shell | 启动、路由壳层、连接态、桌面/移动壳层选择 | `packages/web/src/app`、`packages/web/src/shells` |
| Auth | 登录、会话门禁、认证状态 | `packages/web/src/features/auth`、`packages/server/src/auth` |
| Welcome | 欢迎页、打开工作区入口、设置入口 | `packages/web/src/features/welcome` |
| Workspace | 工作区总入口、active workspace、加载/错误/空态 | `packages/web/src/features/workspace`、`packages/server/src/commands/workspace.ts` |
| Workspace Desktop | 桌面工作区布局、侧栏、主区、底部终端 | `packages/web/src/features/workspace/views/desktop` |
| Workspace Mobile | 移动端 Dock、Sheet、Drawer、移动端工作区状态 | `packages/web/src/features/workspace/views/mobile` |
| Workspace Tabs / Layout | workspace tab、布局持久化、focus/fullscreen、最后查看目标 | `packages/web/src/features/workspace/actions/use-workspace-ui-state-persistence.ts`、`packages/web/src/features/workspace/actions/use-workspace-layout-actions.ts` |
| Agent Sessions | Agent 会话创建、运行态、历史、metadata | `packages/web/src/features/agent-panes`、`packages/server/src/commands/session.ts` |
| Agent Panes | Agent pane 布局、pane card、draft launcher、pane navigation | `packages/web/src/features/agent-panes` |
| Agent Instructions | Agent 指令生成、读取、编辑、token 趋势 | `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts`、`packages/server/src/agent-instructions` |
| Providers | Provider 配置、切换、运行边界、自定义 provider | `packages/web/src/features/agent-providers`、`packages/providers/src`、`packages/server/src/provider-runtime` |
| Supervisor | Supervisor 列表、目标、详情、移动端 Sheet | `packages/web/src/features/supervisor`、`packages/server/src/supervisor` |
| Files | 文件树、刷新、上下文菜单、上传、打开文件 | `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`、`packages/server/src/commands/file.ts` |
| Editor Preview | 文本编辑、图片/Markdown/HTML 预览、Diff viewer | `packages/web/src/features/code-editor`、`packages/server/src/preview` |
| Search / Quick Open | 搜索、快速打开、搜索预览 | `packages/web/src/features/quick-open`、`packages/web/src/features/workspace/views/shared/search-panel.tsx` |
| Git | Git 状态、Diff、commit、branch、push/pull | `packages/web/src/features/workspace/actions/use-git-actions.ts`、`packages/server/src/commands/git.ts` |
| Worktrees | Worktree 列表、详情、管理入口 | `packages/web/src/features/workspace/views/shared/worktree-*`、`packages/server/src/commands/worktree.ts` |
| Terminal | shell terminal、agent terminal、多终端、恢复、上传 | `packages/web/src/features/terminal-panel`、`packages/server/src/terminal` |
| Settings | 设置页、provider 设置、外观、快捷键、监控设置、关于 | `packages/web/src/features/settings`、`packages/server/src/commands/settings.ts` |
| Diagnostics | 系统依赖、诊断页、安装流程 | `packages/web/src/features/diagnostics`、`packages/server/src/commands/diagnostics.ts` |
| Monitoring | 运行监控、指标展示、监控设置 | `packages/web/src/features/monitoring`、`packages/server/src/monitoring` |
| Work Analysis | 工作分析、时间范围、归因、趋势、导出 | `packages/web/src/features/work-analysis`、`packages/server/src/work-analysis` |
| Skills | skills 面板、挂载目录、归因和管理 | `packages/web/src/features/workspace/actions/use-skills-panel.ts`、`packages/server/src/skills` |
| Updates | 更新检查、更新提示、footer update rail | `packages/web/src/features/updates`、`packages/server/src/update` |
| Notifications | Toast、系统通知、会话完成通知 | `packages/web/src/features/notifications`、`packages/web/src/components/ui/toast` |
| Command Palette | 命令面板、命令入口、键盘交互 | `packages/web/src/features/command-palette` |
| Shortcuts | 全局快捷键、工作区导航快捷键、设置页快捷键展示 | `packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.ts`、`packages/web/src/features/settings/components/shortcuts-settings.tsx` |
| UI Components | 可复用 UI 原语和组件库状态 | `packages/web/src/components/ui` |

模块边界不是永久固定的。后续盘点发现某个模块过大时，应拆分为更小的文档，但功能 ID 要保持稳定。

## 5. 功能状态

每个功能点必须标记一个状态：

| 状态 | 定义 |
| --- | --- |
| `Implemented` | 代码已接线，用户可达，可按验收标准验证。 |
| `Partial` | 有部分代码或 UI，但流程、状态、错误处理或验收路径不完整。 |
| `Internal` | 内部能力存在，但没有稳定用户入口，或只被其他功能间接使用。 |
| `Deprecated` | 代码可能仍存在，但产品上不再承诺或不建议使用。 |
| `Planned` | 计划做，但当前代码没有实现。 |
| `Removed` | 曾经存在或曾被文档记录，但当前代码已移除。 |

只有 `Implemented` 和 `Partial` 可以写入当前功能规格的主流程。`Planned` 必须明确标注，不得混入已实现能力。

## 6. 功能 ID 规则

功能 ID 用模块前缀加三位数字，稳定后不要随意修改。

建议前缀：

| 前缀 | 模块 |
| --- | --- |
| `APP` | App Shell |
| `AUTH` | Auth |
| `WELCOME` | Welcome |
| `WS` | Workspace |
| `WSD` | Workspace Desktop |
| `WSM` | Workspace Mobile |
| `WSL` | Workspace Tabs / Layout |
| `SESSION` | Agent Sessions |
| `PANE` | Agent Panes |
| `INSTR` | Agent Instructions |
| `PROVIDER` | Providers |
| `SUP` | Supervisor |
| `FILE` | Files |
| `EDITOR` | Editor Preview |
| `SEARCH` | Search / Quick Open |
| `GIT` | Git |
| `WT` | Worktrees |
| `TERM` | Terminal |
| `SETTINGS` | Settings |
| `DIAG` | Diagnostics |
| `MON` | Monitoring |
| `WA` | Work Analysis |
| `SKILL` | Skills |
| `UPDATE` | Updates |
| `NOTIFY` | Notifications |
| `CMD` | Command Palette |
| `SHORTCUT` | Shortcuts |
| `UI` | UI Components |

示例：

```text
### WS-001 打开工作区
### SESSION-004 恢复 Agent 会话
### GIT-006 查看文件 Diff
```

如果功能移动到另一个模块，旧 ID 保留，并在新位置标注迁移说明。

## 7. 模块文档模板

每个 `modules/*.zh-CN.md` 使用以下结构：

```text
# 模块名

## 1. 模块范围

覆盖：
- workspace 列表、打开、关闭。

不覆盖：
- Git、终端和文件编辑细节。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Workspace launch modal | Both | 浏览目录并打开 workspace。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| WS-004 | 打开 workspace | Implemented | `packages/server/src/commands/workspace.ts` | `packages/server/src/__tests__/workspace-commands.test.ts` |

## 4. 功能点规格

### WS-004 打开 workspace

状态：`Implemented`

用户行为：
- 用户选择目录并点击打开。

系统响应：
- 前端调用 `workspace.open`，服务端打开目录并返回 workspace。

状态与边界：
- Loading：打开请求处理中。
- Empty：没有可打开 workspace 时展示空态。
- Success：active workspace 切换到打开结果。
- Error：打开失败时展示诊断或错误反馈。

桌面端差异：
- 桌面端在 workspace tab 中显示新 workspace。

移动端差异：
- 移动端进入移动工作区视图。

数据与命令：
- Frontend：`packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- WebSocket command：`workspace.open`
- Server handler：`packages/server/src/commands/workspace.ts`
- Core / provider 类型：`packages/core/src/domain/types.ts`

验收标准：
- Given 启动器中已选择有效路径
- When 用户确认打开
- Then active workspace 切换为打开结果

代码索引：
- `packages/server/src/commands/workspace.ts`

测试线索：
- `packages/server/src/__tests__/workspace-commands.test.ts`
- `packages/web/src/features/workspace/actions/use-workspace-launch-actions.test.tsx`

## 5. 模块级验收清单

- [ ] 能打开一个有效目录作为 workspace。
- [ ] 打开失败时有错误反馈。

## 6. 未确认项

- workspace history 的 UI 排序规则需补充更多代码证据。
```

未确认项必须说明缺少哪类证据。不要用英文占位词代替问题描述。

## 8. 流程文档模板

每个 `flows/*.zh-CN.md` 用于描述跨模块路径：

```text
# 流程名

## 1. 流程目标

## 2. 参与模块

## 3. 前置条件

## 4. 主路径

| 步骤 | 用户行为 | 系统响应 | 关联功能 ID |
| --- | --- | --- | --- |
| 1 | 用户选择目录 | 系统打开 workspace 并进入工作区 | `WS-004` |

## 5. 分支与错误路径

## 6. 验收标准

## 7. 自动化测试建议
```

流程文档不重复模块规格细节，只引用功能 ID。

## 9. 验收写法

验收标准优先使用 Given / When / Then：

```text
验收标准：
- Given 当前没有打开的 workspace
- When 用户从欢迎页选择一个有效目录
- Then 应用进入工作区页
- And 顶部工作区栏显示该 workspace
- And 刷新页面后仍能恢复该 workspace
```

每个功能点至少要有一条可手工验证的验收标准。适合自动化的场景再补充测试建议。

验收标准要避免以下写法：

- “体验正常”
- “逻辑正确”
- “展示合理”
- “和以前一样”
- “参考旧 PRD”

## 10. 盘点顺序

全量盘点按三轮推进：

1. 模块索引轮：为所有模块建立功能 ID、功能名、状态、代码入口和初始验收入口。
2. 功能规格轮：补齐用户行为、系统响应、状态、边界、数据与命令。
3. 验收清单轮：从功能 ID 反向生成模块验收、跨模块流程验收和冒烟清单。

第一轮不要追求完整叙述，重点是覆盖面和代码证据。第二轮再补细节。第三轮再生成测试用例。

## 11. 维护规则

- 修改功能行为时，同步更新对应模块 spec。
- 新增功能时，先分配功能 ID，再补代码索引和验收标准。
- 删除或废弃功能时，不删除 ID，改状态并说明当前代码状态。
- 如果只存在组件代码但没有用户入口，标记为 `Internal` 或 `Partial`。
- 如果只有旧文档描述但当前代码没有实现，标记为 `Planned`、`Deprecated` 或 `Removed`，不得写成 `Implemented`。
- 模块文档中不得大段复制旧 PRD 或旧 specs。
- 验收标准应能被人工执行，也应尽量能转成自动化测试。
