# Coder Studio PRD（Current Implementation Baseline）

版本：2026-03-19  
状态：现状对齐版 / Current implementation baseline  
适用范围：基于当前代码实现整理，作为“已实现能力”的产品说明，不作为未来路线图

## 1. 文档目的 / Purpose

本 PRD 只描述当前代码里已经落地或已形成稳定交互闭环的能力，重点回答三个问题：

1. 这个产品现在是什么。
2. 用户现在可以怎么用。
3. 哪些能力虽然在数据模型或后端中有痕迹，但还不应被视为当前正式功能。

本文档的事实基线来自当前实现，包括但不限于：

- `src/App.tsx`
- `src/state/workbench.ts`
- `src/i18n.ts`
- `src-tauri/src/main.rs`

## 2. 产品定义 / Product Summary

Coder Studio 是一个基于 Tauri 的桌面端本地工作台，用来把以下工作集中到一个操作面中：

- 连接本地或远程 Git 仓库
- 启动并管理 Claude Agent 会话
- 并行拆分多个 Agent 工作流
- 查看、编辑和保存代码文件
- 查看 Git 改动并执行常见 Git 操作
- 在内置终端中执行命令

当前版本的产品定位是：

- 本地优先的单机开发工作台
- 面向代码仓库的 Agent 协作界面
- 不是完整 IDE，也不是多用户协作平台

## 3. 目标用户 / Target Users

1. 独立开发者：希望在一个桌面应用中同时驱动 Agent、代码预览、Git 与终端。
2. 工程师：需要在处理真实仓库时快速切换任务、查看改动、提交代码。
3. 使用 Claude Code 的开发者：希望把 Claude CLI 的运行、状态感知和仓库操作整合在一起。

## 4. 当前支持范围 / Supported Environment

- 运行形态：桌面应用（Tauri）
- 工作区来源：`Remote Git` 或 `Local Folder`
- 执行目标：`Native`；在环境允许时支持 `WSL`
- Agent 提供方：当前仅支持 `Claude`
- 语言：中文、English
- 主题：当前仅保留深色主题
- 数据存储：本地存储为主，前端状态保存在 Local Storage，后端会话/归档支持本地持久化

## 5. 当前产品范围 / Current Product Scope

### 5.1 工作区创建与接入 / Workspace Onboarding

- 应用启动后默认进入工作区启动浮层。
- 用户可以选择 `Remote Git` 或 `Local Folder` 两种接入方式。
- 远程仓库模式下，输入 Git URL 后，应用会在目标运行时环境中克隆仓库到临时目录。
- 本地目录模式下，应用提供服务端目录浏览器，支持：
  - 查看当前浏览路径
  - 回到 Home
  - 返回上一级目录
  - 选择当前目录或某个子目录
- 本地目录接入是“仓库导向”的：最终会解析到 Git 仓库根目录，而不是把任意普通文件夹当成完整工作区。
- 当系统可用时，用户可以为工作区选择 `Native` 或 `WSL` 执行目标。
- 选择 `WSL` 时，可以额外填写 distro 名称。

### 5.2 多工作区管理 / Multi-Workspace Management

- 顶部支持多个工作区标签页。
- 用户可以新增、切换、关闭工作区。
- 工作区标签显示：
  - 工作区名称或路径名
  - 是否有运行中任务的状态点
  - 未读计数
- 工作区支持按快捷键快速切换：
  - `Cmd/Ctrl + N` 新建工作区
  - `Cmd/Ctrl + Shift + [` 切换到上一个工作区
  - `Cmd/Ctrl + Shift + ]` 切换到下一个工作区
- 工作台布局和工作区状态会持久化到本地存储。

### 5.3 Agent 会话与 Pane 模型 / Agent Sessions and Pane Model

- 当前的并行任务模型是“分屏 Pane”，而不是独立的 Session 列表页或任务甲板。
- 每个 Agent Pane 对应一个 Session。
- 用户可以在当前 Pane 上执行：
  - 纵向分屏
  - 横向分屏
- 分屏会创建一个新的草稿 Session，并立即在新 Pane 中获得焦点。
- 新建出来的 Pane 在 Agent 尚未启动前，会显示一个独立输入框。
- 该输入框只在 Agent 启动前出现，启动后消失，交互切换为终端直连模式。
- 草稿输入框 placeholder 为：
  - 中文：`请输入内容开启新任务`
  - 英文：`Type to start a new task`
- 用户首次提交的有效输入会用于生成 Session 标题。
- Session 当前可见状态语义包括：
  - `idle`
  - `running`
  - `background`
  - `waiting`
  - `queued`
- `suspended` 虽然存在于状态模型中，但当前版本还没有形成完整、可验证的前端自动挂起产品闭环。
- 当非焦点 Session 持续输出或完成时，工作区会累积未读数，并可触发 toast 提示。

### 5.4 Agent 启动与交互 / Agent Launch and Interaction

- Agent 启动采用 PTY 方式运行，当前 UI 以终端交互为主。
- 草稿 Pane 在首次输入时才会真正物化为后端 Session，并启动 Agent 进程。
- Agent 启动后，用户后续输入直接写入 PTY，不再经过单独的聊天输入框逻辑。
- Pane 大小变化会同步到 Agent PTY 的列宽和行高。
- 当前设置项里的 Launch Command 用于决定实际启动命令。
- 应用会基于当前工作区执行目标检查该命令是否可用，并展示校验状态。
- 当前 Provider 实际上固定为 `Claude`，不应将该版本描述为多 Provider Agent 平台。

### 5.5 Claude 相关增强 / Claude-Specific Enhancements

- 当前版本会在 Claude 运行目录下自动写入/更新 `.claude/settings.local.json` 的 hook 配置。
- 应用会接收 Claude 生命周期事件，并用于更新会话状态与会话上下文。
- 当前已对接的生命周期类别包括：
  - `session_started`
  - `turn_waiting`
  - `tool_started`
  - `tool_finished`
  - `approval_required`
  - `turn_completed`
  - `session_ended`
- Claude 的会话 ID 会被记录下来，用于后续恢复同一会话上下文。

### 5.6 代码面板 / Code Panel

- 右侧代码面板可显隐切换。
- 代码面板支持展开模式，展开后会显示更完整的文件导航与 Git 侧栏。
- 文件能力包括：
  - 仓库文件树浏览
  - 文件点击预览
  - 文件搜索并跳转
  - Monaco 编辑器预览和编辑
  - 保存当前文件
- 当前文件保存能力已经落地，编辑后可通过现有保存逻辑写回文件。
- `Cmd/Ctrl + S` 已接入保存当前预览文件的行为。
- 文件 Diff 能力包括：
  - 全局 Git Diff 文本预览
  - 单文件结构化 Diff 预览
  - 在结构化内容可用时显示 Monaco DiffEditor
  - 在结构化内容不可用时退回纯文本 Diff

### 5.7 Git 操作 / Git Operations

- 工作区主头部展示当前分支与改动文件数。
- 代码侧栏支持 `Source Control` 视图。
- Git 改动分组当前包括：
  - `Changes`
  - `Staged Changes`
  - `Untracked`
- 单文件级别支持：
  - Stage
  - Unstage
  - Discard
- 全局级别支持：
  - Stage All
  - Unstage All
  - Discard All
- 支持输入 Commit Message 并直接执行 Commit。
- 选择某条 Git 改动后，右侧会切换到对应 Diff 预览。

### 5.8 终端面板 / Embedded Terminal

- 右侧终端面板可显隐切换。
- 每个工作区支持多个终端实例。
- 用户可以：
  - 新增终端
  - 切换终端
  - 关闭终端
- 终端采用 PTY 交互，支持实时输入输出与尺寸同步。
- 终端运行目标与当前工作区执行目标保持一致。

### 5.9 全局操作与设置 / Global Controls and Settings

- 当前支持快速操作面板（Command Palette）。
- 快捷键：`Cmd/Ctrl + K`
- 当前快速操作覆盖的核心动作包括：
  - 新建工作区
  - 开关 Focus Mode
  - 开关代码面板
  - 开关终端面板
  - 聚焦当前 Agent
  - 横向/纵向分屏
  - 切换前后工作区
  - 打开设置
- 当前设置页只有两个一级面板：
  - `General`
  - `Appearance`
- `General` 当前包含：
  - Launch Command
  - Idle Policy 开关
  - Idle Minutes
  - Max Active
  - Memory Pressure
- `Appearance` 当前包含：
  - 深色主题展示说明
  - 中英文切换
- 设置为自动保存模式。

### 5.10 本地持久化 / Local Persistence

- 工作台状态会保存在 Local Storage。
- 当前持久化内容包括：
  - 工作区与布局状态
  - 设置项
  - 语言选择
- 后端支持把 Session 和 Archive 快照写入本地数据库。
- 关闭非草稿 Pane 时，会把对应 Session 归档到后端归档数据中。
- 当前已有只读 Archive 视图渲染能力，但归档浏览入口还不是完整正式界面的一部分。

## 6. 核心用户流程 / Core User Flows

### 6.1 启动一个工作区

1. 用户打开应用。
2. 进入工作区启动浮层。
3. 选择 `Remote Git` 或 `Local Folder`。
4. 选择 `Native` 或 `WSL` 目标。
5. 输入 Git URL 或选择本地目录。
6. 启动工作区后，主界面加载仓库、文件树、Git 信息。

### 6.2 启动第一个 Agent 任务

1. 进入工作区后，默认可见一个 Agent Pane。
2. Agent 尚未启动时，该 Pane 显示草稿输入框。
3. 用户输入任务并回车。
4. 应用创建后端 Session，启动 Claude PTY。
5. 首次输入内容被用于生成 Session 标题。
6. 输入框消失，Pane 切换为交互式终端流。

### 6.3 并行拆分多个 Agent 任务

1. 用户在当前 Agent Pane 点击横向或纵向分屏。
2. 系统创建新的草稿 Session。
3. 新 Pane 获得焦点并显示启动输入框。
4. 原 Pane 保持原有任务状态继续运行或转为后台状态。

### 6.4 查看和编辑代码

1. 用户打开代码面板。
2. 通过文件树或文件搜索定位目标文件。
3. 在 Monaco 中查看或修改文件内容。
4. 通过现有保存逻辑将改动写回文件。

### 6.5 查看 Git 改动并提交

1. 用户切换到 Git 侧栏。
2. 查看 `Changes / Staged / Untracked` 分组。
3. 选择某个文件查看 Diff。
4. 执行 Stage、Unstage 或 Discard。
5. 输入 Commit Message 并提交。

### 6.6 使用内置终端

1. 用户打开终端面板。
2. 新建一个或多个终端实例。
3. 在终端中执行命令。
4. 在多个终端间切换。

## 7. 明确不应视为当前正式功能的内容 / Not Current Shipped Features

以下内容虽然在旧 PRD、数据模型、样式文件或后端命令中存在痕迹，但不应被写成“当前正式可用能力”：

- 多 Agent Provider 支持
- Light Theme
- 独立的任务队列面板或 Dispatch Board
- 用户可见的 Auto-feed 任务投喂流程
- 完整的 Archive Log 浏览中心
- 明确可见的 Worktree 管理入口
- 完整闭环的 Idle Auto-Suspend 执行逻辑
- 用户可操作的 Session Mode 切换（`branch` / `git_tree`）
- MCP 设置页或 Claude 高级配置面板

## 8. 当前已知约束 / Current Constraints

- 本地目录接入依赖 Git 仓库解析，不是任意目录浏览器。
- 远程仓库克隆到临时目录，目录位置会随运行目标变化。
- WSL 能力依赖宿主机存在 `wsl.exe`，且部分路径解析需根据 distro 环境决定。
- Claude 命令必须在当前执行目标环境中可执行。
- 当前归档、队列、worktree 等能力存在“底层能力先行、主界面入口不足”的状态，文档表述必须以用户实际能完成的操作为准。

## 9. 验收标准 / Acceptance Criteria

1. 应用首次进入或新增工作区时，必须显示工作区启动浮层。
2. 用户必须可以通过 `Remote Git` 或 `Local Folder` 两种方式启动工作区。
3. 在支持 WSL 的环境中，用户必须可以选择 `Native` 或 `WSL` 作为执行目标。
4. 工作区进入主界面后，必须可以看到 Agent 主区域，并且未启动 Agent 的 Pane 显示草稿输入框。
5. 用户在草稿输入框提交首条内容后，必须触发 Session 物化、Agent 启动、标题生成，并切换为交互式终端。
6. 用户必须可以通过横向或纵向分屏创建并行 Agent Pane。
7. 用户必须可以打开代码面板，浏览文件树、搜索文件、预览文件、编辑文件并保存。
8. 用户必须可以在 Git 视图中完成 Stage、Unstage、Discard、Commit 等基础操作。
9. 用户必须可以在终端面板中新增、切换、关闭多个终端。
10. 用户必须可以通过 `Cmd/Ctrl + K` 打开快速操作面板并执行核心全局操作。
11. 用户必须可以在设置页修改 Launch Command、Idle Policy 数值以及界面语言。
12. 当前版本的主题说明必须与实现一致，即仅提供深色主题。

## 10. 后续文档建议 / Documentation Follow-up

如果后续继续完善文档，建议把以下内容从 PRD 中拆出去，单独形成开发文档：

- 前端状态模型说明
- Tauri 命令清单
- Claude Hook 事件流
- 文件树、Git、终端的数据流
- 本地持久化与数据库结构
- 未来路线图与未实现能力清单
