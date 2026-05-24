# System Dependency Installer — Design

Date: 2026-05-24
Status: Draft
Owner: spencer

## Problem

诊断页当前可以展示基础环境状态，但对 `git`、`node` 这类系统依赖只做到“检测并提示缺失”，没有安装流程，也没有可恢复的诊断闭环。

仓库现状里已经存在两套相近但不完全适用的能力：

- Provider CLI 安装：
  - [`packages/server/src/provider-runtime/install-manager.ts`](../../../packages/server/src/provider-runtime/install-manager.ts)
  - [`packages/server/src/commands/provider.ts`](../../../packages/server/src/commands/provider.ts)
- LSP 工具安装：
  - [`packages/server/src/lsp-tools/install-manager.ts`](../../../packages/server/src/lsp-tools/install-manager.ts)
  - [`packages/server/src/commands/lsp.ts`](../../../packages/server/src/commands/lsp.ts)

这两套流程都具备结构化 job、平台策略选择、前端轮询状态等优点，但它们的执行模型是非交互式命令运行，默认假设“安装命令直接跑完即可得出结果”。这与系统依赖安装的核心约束不一致：

- `git` / `node` 安装往往依赖系统包管理器。
- Linux / macOS 的安装经常需要 `sudo`。
- 用户要求在网页内完成交互式提权，而不是跳到外部终端。

因此当前缺口不是“少一个按钮”，而是缺少一条适配系统依赖、支持网页内交互式提权的正式安装链路。

## Goals

- 为 `git` 与 `node` 提供一条独立的系统依赖安装能力。
- 在诊断页内支持一键安装，并在网页内完成交互式提权。
- 复用现有 installer 的 job/strategy 思路，但不把系统依赖伪装成 provider。
- 安装成功后自动重新检查诊断状态，形成闭环。
- v1 覆盖 `Linux + macOS`。

## Non-Goals

- v1 不支持 Windows 交互式管理员提权。
- v1 不支持任意系统命令执行。
- v1 不把系统依赖安装入口合并到普通终端面板。
- v1 不支持 `git`、`node` 之外的其他系统依赖。
- v1 不尝试在 provider installer 内直接塞入 `sudo` 密码交互。

## User Decisions Captured

- 目标是“完整版”，不是只补文档链接。
- 服务端允许直接调用系统包管理器。
- 需要网页内交互式提权，而不是要求用户切到外部终端。
- v1 平台范围限定为 `Linux + macOS`。
- 现有 `claude` / `codex` 安装流程只复用共性，不直接复用为系统依赖 installer 本体。

## Approaches Considered

### Option A: 新增独立的系统依赖 installer，并使用 PTY 支撑网页内交互式提权（推荐）

优点：

- 能完整覆盖 `sudo` 密码输入、安装日志、取消安装、重新验证等流程。
- 保持系统依赖和 provider 安装的领域边界清晰。
- 后续可以扩展到更多基础依赖，而不污染 provider 语义。
- 仍可复用现有 installer 的 job/strategy/failure 模式。

缺点：

- 需要新增一套 manager、命令和前端安装面板。
- 需要把 PTY 输出和结构化 job 状态做桥接。

### Option B: 继续使用当前 provider installer 模型，把 `git` / `node` 伪装成 provider

优点：

- 表面上改动路径更短。

缺点：

- 领域语义错误：`git`、`node` 不是 provider。
- 会混淆 `provider.runtimeStatus`、provider 设置页、会话启动语义。
- 现有 provider installer 不支持网页内交互式提权。

### Option C: 诊断页只拉起一个专用终端，让安装在终端面板中完成

优点：

- 复用现有 terminal/PTY 基础设施最多。

缺点：

- 体验割裂，诊断页拿不到结构化步骤和交互状态。
- 用户需要理解普通终端，而不是在诊断场景内完成修复。
- 很难把“安装成功后自动 recheck”做成自然闭环。

## Final Choice

采用 Option A。

实现一套独立的 `systemDeps.*` 能力：服务端新增系统依赖安装 manager，规划基础依赖安装策略；一旦进入可能需要提权的安装步骤，就切换到 PTY 驱动的交互式安装会话；前端诊断页以内嵌安装面板承载实时输出与密码输入；安装成功后自动重新跑诊断检查。

## Scope

### Included In v1

- 依赖项：`git`、`node`
- 平台：`darwin`、`linux`
- Linux 包管理器识别：
  - `apt-get`
  - `dnf`
  - `yum`
  - `pacman`
  - `zypper`
- macOS 包管理器识别：
  - `brew`
- 诊断页中的安装、进度、密码输入、取消、重新检查

### Excluded From v1

- Windows 的 `winget` / `choco` / UAC 流程
- 多依赖批量安装
- 安装输出的长期持久化
- 普通终端列表中的可见安装终端

## Current Product Constraints

### Diagnostics Today

诊断命令当前在手动检查时会直接读取 `git --version` 与 `node --version`，并把结果映射为 `git_ready` / `git_missing`、`nodejs_ready` / `nodejs_missing`：

- [`packages/server/src/commands/diagnostics.ts`](../../../packages/server/src/commands/diagnostics.ts)

前端诊断页当前仅展示文案、版本、缺失命令和文档链接，没有安装动作：

- [`packages/web/src/features/diagnostics/page.tsx`](../../../packages/web/src/features/diagnostics/page.tsx)

### Installer Patterns Worth Reusing

现有 provider installer 已经验证了以下模式可用：

- 单资源单活动 job
- `start/get` 轮询接口
- 平台策略和 prerequisite 规划
- 结构化 `steps` / `failure`

参考：

- [`packages/server/src/provider-runtime/install-manager.ts`](../../../packages/server/src/provider-runtime/install-manager.ts)
- [`packages/core/src/domain/provider-install.ts`](../../../packages/core/src/domain/provider-install.ts)

### PTY Capability Already Exists

项目已经有稳定的 PTY 能力和终端输入输出命令：

- PTY host:
  - [`packages/server/src/terminal/pty-host.ts`](../../../packages/server/src/terminal/pty-host.ts)
- Terminal commands:
  - [`packages/server/src/commands/terminal.ts`](../../../packages/server/src/commands/terminal.ts)

这意味着“网页内交互式提权”的底层技术不需要从零开始发明，但需要为系统依赖安装封装成专用的隐藏安装会话。

## Architecture

### 1. 独立的系统依赖安装域

新增 `systemDeps` 领域，与 `provider-runtime`、`lsp-tools` 平行，而不是依附在 provider 域下。

建议目录：

- `packages/core/src/domain/system-dependency-install.ts`
- `packages/server/src/system-deps/definitions.ts`
- `packages/server/src/system-deps/runtime-status.ts`
- `packages/server/src/system-deps/install-manager.ts`
- `packages/server/src/commands/system-deps.ts`

职责拆分：

- `definitions.ts`
  - 定义 `git` / `node` 的检测命令、文档链接、平台安装策略。
- `runtime-status.ts`
  - 读取当前依赖状态与版本，并计算是否支持自动安装。
- `install-manager.ts`
  - 管理 job 生命周期、策略规划、PTY 安装会话、输出解析、状态更新。
- `commands/system-deps.ts`
  - 暴露 `runtimeStatus`、`install.start`、`install.get`、`install.input`、`install.cancel`。

### 2. 结构化 job + 隐藏 PTY 会话

系统依赖安装同时包含两类状态：

- 结构化安装状态：
  - 当前正在检测什么、安装什么、验证什么、是否失败、失败分类是什么
- 交互式终端状态：
  - 包管理器当前输出了什么、是否在等 `sudo` 密码、用户输入是否已提交

v1 采用“双层模型”：

- `SystemDependencyInstallJobSnapshot`
  - 诊断页用于渲染结构化状态
- 隐藏 PTY 会话
  - manager 用它执行真实安装命令，并把输出解析回 job

PTY 会话不出现在普通终端列表中，不允许用户把它当通用 shell 使用。

### 3. 复用 installer 共性，不复用 installer 实体

以下能力直接沿用现有 provider installer 的思路：

- 单依赖单活动 job
- `start/get` 幂等语义
- `step` / `failure` snapshot 风格
- 平台策略选择
- prerequisite 检查

以下能力是 system dependency installer 独有的：

- `install.input`
- `install.cancel`
- `interaction` 状态
- PTY 输出解析
- `sudo` 密码交互

## Domain Model

新增共享类型，建议放在 [`packages/core/src/domain`](../../../packages/core/src/domain)。

### Dependency Id

```ts
export type SystemDependencyId = "git" | "node";
```

### Runtime Status

```ts
export interface SystemDependencyRuntimeEntry {
  dependencyId: SystemDependencyId;
  available: boolean;
  version?: string;
  autoInstallSupported: boolean;
  installReadiness: "ready" | "unsupported_platform" | "unsupported_package_manager";
  packageManager?: "brew" | "apt-get" | "dnf" | "yum" | "pacman" | "zypper";
  manualGuideKeys: string[];
  docUrl?: string;
}
```

### Install Interaction

```ts
export interface SystemDependencyInstallInteraction {
  kind: "none" | "sudo_password" | "confirm";
  promptExcerpt?: string;
  echo: boolean;
}
```

### Install Step

```ts
export interface SystemDependencyInstallStepSnapshot {
  id: string;
  titleKey: string;
  kind: "check" | "install" | "verify";
  command: string;
  args: string[];
  status: "pending" | "running" | "succeeded" | "failed";
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
}
```

### Install Failure

```ts
export interface SystemDependencyInstallFailure {
  code:
    | "unsupported_platform"
    | "unsupported_package_manager"
    | "permission_denied"
    | "user_cancelled"
    | "pty_disconnected"
    | "command_not_found"
    | "command_failed"
    | "verification_failed"
    | "unknown_failure";
  dependencyId: SystemDependencyId;
  failedStepId: string;
  message: string;
  command: string;
  args: string[];
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  packageManager?: string;
  manualGuideKeys: string[];
  docUrl?: string;
}
```

### Install Job

```ts
export interface SystemDependencyInstallJobSnapshot {
  jobId: string;
  dependencyId: SystemDependencyId;
  status: "queued" | "running" | "waiting_input" | "succeeded" | "failed" | "cancelled";
  packageManager?: string;
  currentStepId?: string;
  steps: SystemDependencyInstallStepSnapshot[];
  interaction: SystemDependencyInstallInteraction;
  failure?: SystemDependencyInstallFailure;
}
```

## Server Design

### Runtime Status

新增 `systemDeps.runtimeStatus` 命令，返回结构化基础依赖状态，而不是复用现有 `diagnostics.get` 的通用 checks 结果。

建议语义：

- 对每个支持的依赖运行版本探测：
  - `git --version`
  - `node --version`
- 识别当前平台和包管理器
- 计算：
  - `available`
  - `version`
  - `autoInstallSupported`
  - `installReadiness`
  - `manualGuideKeys`
  - `docUrl`

诊断命令可以在需要时复用这份运行时状态，而不是再次散落地手写探测逻辑。

### Package Manager Detection

Linux / macOS 的自动安装能力不取决于“平台是否支持”，还取决于“能否识别可用包管理器”。

建议检测顺序：

- `darwin`
  - `brew`
- `linux`
  - `apt-get`
  - `dnf`
  - `yum`
  - `pacman`
  - `zypper`

返回策略：

- 找到包管理器：
  - `autoInstallSupported = true`
  - `installReadiness = "ready"`
- 平台支持但包管理器未识别：
  - `autoInstallSupported = false`
  - `installReadiness = "unsupported_package_manager"`
- 平台不支持：
  - `autoInstallSupported = false`
  - `installReadiness = "unsupported_platform"`

### Strategy Planning

系统依赖安装不需要像 provider installer 那样有多层 prerequisite 依赖树，但仍建议保留“计划步骤”的机制。

示例：

- `git` + `brew`
  - `detect-package-manager`
  - `install-git`
  - `verify-git`
- `node` + `apt-get`
  - `detect-package-manager`
  - `install-node`
  - `verify-node`

示例命令：

- macOS
  - `brew install git`
  - `brew install node`
- Linux
  - `sudo apt-get update`
  - `sudo apt-get install -y git`
  - `sudo apt-get install -y nodejs npm`
  - `sudo dnf install -y git`
  - `sudo dnf install -y nodejs`
  - `sudo yum install -y git`
  - `sudo yum install -y nodejs`
  - `sudo pacman -Sy --noconfirm git`
  - `sudo pacman -Sy --noconfirm nodejs npm`
  - `sudo zypper --non-interactive install git`
  - `sudo zypper --non-interactive install nodejs`

v1 只允许执行服务端策略表中预定义的命令，不接受前端传入任意命令。

### PTY Execution Model

非交互式命令执行继续使用现有 `runCommandAsString()` 适合的场景：

- 初始版本探测
- 包管理器探测
- 最终版本验证

安装步骤改为走 PTY 会话。原因：

- `sudo` 提示需要伪终端环境
- 包管理器可能直接把交互提示写到 TTY
- 网页需要把密码输入实时回写到会话

实现建议：

- manager 通过 `TerminalManager` 创建隐藏安装终端
- 安装终端使用内建 argv，直接启动 shell：
  - macOS / Linux: `["/bin/sh", "-lc", "<install command>"]`
- manager 订阅该终端输出流并更新 job
- `systemDeps.install.input` 调用时，把输入写入该隐藏终端

### Hidden Install Terminal

不要让安装终端出现在普通 terminal 列表里。

建议方式二选一：

1. 为 terminal 增加 `visibility: "public" | "internal"` 字段，并让 `terminal.list` 只返回 `public`
2. manager 不经公开 terminal 命令，而是直接通过 `TerminalManager` 内部 API 创建不入库的内部会话

推荐第 2 种：范围更小，不影响终端业务语义，也不需要改普通终端 UI 的过滤逻辑。

### Interaction Detection

manager 需要从 PTY 输出中识别“当前需要用户输入”。

v1 只识别有限模式：

- `sudo` 密码提示
  - 常见模式：
    - `[sudo] password for ...:`
    - `Password:`
- 包管理器确认提示
  - 如果策略里无法完全避免交互，则识别 `Proceed? [Y/n]` 等模式

状态转换示例：

- 默认：
  - `interaction.kind = "none"`
- 检测到密码提示：
  - `status = "waiting_input"`
  - `interaction.kind = "sudo_password"`
  - `interaction.echo = false`
- 用户提交输入后：
  - `status = "running"`
  - `interaction.kind = "none"`

密码输入不写入任何日志、snapshot excerpt 或持久化字段。

### Cancellation

新增 `systemDeps.install.cancel`：

- 终止当前隐藏 PTY
- 将 job 标记为 `cancelled`
- 清理 active job 映射

如果 PTY 异常退出且当前 job 不是成功状态，则映射为：

- `pty_disconnected`
  或
- `command_failed`

### Verification

成功标准不依赖单个安装命令退出码，而依赖最终重新验证：

- `git --version`
- `node --version`

只有最终验证通过，job 才能标记为 `succeeded`。

## Diagnostics Integration

### Which Contexts Show Base Runtime Checks

`manual_check`：

- 一定显示 `git` / `node` 的基础依赖状态。

`session_start`：

- 补进基础依赖状态。
- 原因：provider CLI 即使安装成功，基础依赖缺失时仍可能无法实际使用。

`workspace_open`：

- 显示基础依赖状态，但不因 `git_missing` 阻塞工作区打开。

`mobile_continue`：

- 继续只关心 host / auth，不额外引入 `git` / `node` 阻塞逻辑。

### Diagnostics Check Enrichment

现有 `DiagnosticsCheck` 需要为基础依赖安装增加可操作字段。建议新增：

```ts
dependencyId?: "git" | "node";
autoInstallSupported?: boolean;
installReadiness?: "ready" | "unsupported_platform" | "unsupported_package_manager";
manualGuideKeys?: string[];
docUrl?: string;
```

这样 `git_missing` / `nodejs_missing` 卡片就能从“纯展示”升级为“可安装”。

## Web UX

### Diagnostics Card Actions

对 `git_missing` / `nodejs_missing`：

- 若 `autoInstallSupported = true`：
  - 显示 `Install` 按钮
- 若 `autoInstallSupported = false`：
  - 显示手动引导文案
  - 如有 `docUrl`，显示官方文档按钮

### Embedded Install Panel

点击 `Install` 后，不跳走，不打开普通 terminal 面板，而是在诊断页当前卡片下展开安装面板。

面板包含：

- 当前依赖名
- 包管理器标识
- job 状态
- 当前步骤
- 实时日志区
- 输入区
- `Cancel` 按钮

### Input States

`interaction.kind = "sudo_password"` 时：

- 展示密码输入框
- `type="password"`
- 不回显
- 回车提交到 `systemDeps.install.input`

`interaction.kind = "confirm"` 时：

- 展示普通文本输入或确认按钮
- v1 优先通过安装命令参数规避确认型交互，尽量不依赖该态

### Recheck Loop

job 进入 `succeeded` 后：

- 自动触发 `diagnostics.recheck`
- 当前依赖卡片更新为 `ready`
- 若该诊断上下文依赖此项才能继续，则主动作恢复可用

示例：

- `session_start` 场景下，`node` 缺失会先阻塞继续
- 安装成功并 recheck 后，`Continue Session` 变为可用

## Security

### Password Handling

- 密码只通过 PTY stdin 写入
- 不落库
- 不进入 job snapshot
- 不进入 stdout/stderr excerpt
- 不写 server log

### Command Safety

- 前端不能提交任意命令
- 所有安装命令都来自服务端内建策略表
- 同一时刻只允许一个依赖一个活动安装 job
- v1 不支持并发多依赖安装，避免包管理器锁冲突

### Surface Isolation

- 安装终端不进入普通终端面板
- 普通 terminal 输入命令无法劫持安装 job
- 诊断页只暴露与当前 job 绑定的最小输入能力

## Failure Model

以下情况都应明确映射为失败：

- 平台不支持
- 平台支持但包管理器不可识别
- 用户取消安装
- `sudo` 密码错误导致安装失败
- 包管理器命令退出非 0
- PTY 异常断开
- 最终版本验证失败

失败后诊断页应保留：

- 当前 job 的失败摘要
- 当前依赖的手动修复文案
- `Recheck` 能力
- 再次 `Install` 的能力（创建新 job）

## Testing Strategy

### Core

新增共享类型和状态模型测试：

- `packages/core/src/domain/system-dependency-install.ts`
- 对应 domain 测试文件

覆盖点：

- snapshot 类型收敛
- failure code 枚举
- interaction 类型

### Server

新增测试：

- package manager 检测优先级
- `git` / `node` runtime status
- installer job 生命周期
- `start` 幂等返回活动 job
- PTY 输出触发 `waiting_input`
- 密码输入后恢复 `running`
- 取消安装
- 验证成功与验证失败
- diagnostics wiring 在不同 context 下的包含/排除逻辑

### Web

新增测试：

- 诊断页缺失 `git` / `node` 时渲染 `Install`
- 安装中展开日志面板
- `sudo` 密码输入态
- 成功后自动 recheck
- 失败后展示手动指引与重试入口
- `workspace_open` 不因 `git_missing` 阻塞继续

## Implementation Notes

### Shared Abstraction Opportunity

本次不强制把 provider installer 与 system dependency installer 抽成完全统一的抽象基类。

原因：

- 现有 provider installer 是非交互式 install runner
- 新系统依赖 installer 是 PTY 驱动的交互式 install runner
- 过早抽象容易把两条执行模型强行统一，反而提高复杂度

推荐做法：

- 先只复用类型风格、失败码风格、步骤规划思路
- 等 system dependency installer 稳定后，再评估是否抽共用 helper，例如：
  - `cloneJobSnapshot`
  - excerpt 裁剪
  - install strategy helpers

### Docs And Copy

需要补齐中英文文案：

- `diagnostics.checks.git_missing`
- `diagnostics.checks.nodejs_missing`
- `system_deps.install.*`
- 手动修复 guide keys

需要为每个受支持依赖提供官方文档链接：

- Git 官方安装文档
- Node.js 官方安装文档

## Rollout Summary

v1 交付后，诊断页对于基础依赖将从“只报告问题”升级为“可在原地修复问题”的闭环体验：

- 检测缺失
- 一键开始安装
- 网页内输入提权密码
- 实时查看日志
- 自动重新检查
- 继续原本被阻塞的操作

这是一个新的系统依赖安装能力，不是 provider installer 的变体；但它会刻意沿用现有 installer 已经验证可行的状态模型和策略规划方式。
