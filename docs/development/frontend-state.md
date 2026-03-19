# Frontend 状态模型

[English](frontend-state.en.md)

本文档梳理当前前端状态的来源、关键实体，以及几个重要的状态流转。

## 1. 状态来源

当前前端状态分成三层：

- 全局工作台状态：`src/state/workbench.ts`
- 页面级本地状态：`src/App.tsx`
- 前后端交互类型：`src/types/app.ts`

简单理解：

- `workbench.ts` 决定“工作台里有什么”
- `App.tsx` 决定“这些东西当前怎么显示、怎么交互”
- `types/app.ts` 决定“前端和后端怎么对话”

## 2. 核心实体

### 2.1 WorkbenchState

`WorkbenchState` 是全局根状态，包含：

- `tabs`：所有工作区
- `activeTabId`：当前工作区
- `layout`：左右面板宽度、底部终端比例、显示状态
- `overlay`：启动工作区时的 onboarding 浮层状态

### 2.2 Tab

`Tab` 表示一个工作区。关键字段包括：

- `project`：当前工作区对应的仓库路径与执行目标
- `agent`：当前工作区的 agent provider / command 配置
- `git`：分支、改动数、最近提交
- `gitChanges`：当前 Git 变更列表
- `worktrees`：后端刷新得到的 worktree 列表
- `sessions`：该工作区下的所有 session
- `activeSessionId`：当前聚焦 session
- `paneLayout`：Agent Pane 树
- `activePaneId`：当前聚焦 Pane
- `terminals`：内置终端集合
- `fileTree` / `changesTree`：文件树与改动树
- `filePreview`：右侧文件预览状态
- `archive`：后端归档快照列表
- `viewingArchiveId`：当前是否处于只读归档视图
- `idlePolicy`：设置页同步下来的资源策略参数

### 2.3 Session

`Session` 当前是 Agent Pane 对应的业务单元。关键字段：

- `id`
- `title`
- `status`
- `mode`
- `autoFeed`
- `isDraft`
- `queue`
- `messages`
- `stream`
- `unread`
- `lastActiveAt`
- `claudeSessionId`

其中最关键的是：

- `isDraft`：决定 pane 当前显示输入框还是终端
- `stream`：Agent 输出流文本
- `claudeSessionId`：恢复 Claude 会话时会用到

### 2.4 SessionPaneNode

Pane 结构是树，不是线性列表。

有两种节点：

- `leaf`：一个具体 Pane，对应一个 `sessionId`
- `split`：一个分割节点，包含 `axis`、`ratio`、`first`、`second`

这意味着：

- Agent 并行能力的核心实现其实是 Pane 树
- “新任务”在当前产品里更接近“新 Pane + 新 Session”

### 2.5 FilePreview

`filePreview` 驱动右侧代码区，主要字段包括：

- `path`
- `content`
- `mode`：`preview` 或 `diff`
- `diff`
- `originalContent`
- `modifiedContent`
- `dirty`
- `source`：来自文件树还是 Git
- `section`：当前对应的 Git 分组

### 2.6 Terminal

`Terminal` 表示内置 shell 终端实例，字段较少：

- `id`
- `title`
- `output`

终端的真正运行时句柄不在前端状态树里，而在 Rust 后端的 PTY runtime 中。

## 3. 页面级本地状态

`src/App.tsx` 里维护了大量仅用于界面交互的状态，例如：

- `locale`
- `appSettings` / `settingsDraft`
- `route`
- `activeSettingsPanel`
- `commitMessage`
- `toasts`
- `worktreeModal`
- `worktreeView`
- `previewMode`
- `codeSidebarView`
- `fileSearchQuery`
- `isCodeExpanded`
- `folderBrowser`
- `agentCommandStatus`
- `isFocusMode`
- `commandPaletteOpen`
- `draftPromptInputs`

可以把这些状态理解为“视图控制层状态”，而不是领域模型本身。

## 4. 关键状态流转

### 4.1 Tab 初始化

`createTab()` 会创建：

- 一个默认 session
- 一棵只有一个 leaf 的 pane 树
- 空的文件树、终端列表、Git 列表
- 默认 `overlay.visible = true`

所以新工作区的进入路径始终是：

- 先有 tab
- 再通过 overlay 选择仓库
- 然后加载真实工作区数据

### 4.2 Draft Session 到正式 Session

当前 session 生命周期里最关键的一步是“物化”：

1. 新建 Pane 时先创建 `isDraft = true` 的 session
2. 用户输入首条任务
3. `materializeSession()` 调用后端 `create_session`
4. draft session 被一个正式 session 替换
5. session 标题从首条输入里提取
6. 然后启动 Agent PTY

这也是“首次输入内容作为 session 名称”的真正落点。

### 4.3 Session 状态切换

前端对 session status 做了可见态处理：

- 焦点 session 的 `running` / `waiting` 会保持前台语义
- 非焦点 session 的前台活跃态会映射成 `background`
- 切换 session 时会重置 unread

当前产品上真正常见的状态是：

- `idle`
- `running`
- `background`
- `waiting`
- `queued`

`suspended` 虽然在模型里存在，但当前主界面没有完整展示它的闭环。

### 4.4 Pane 分屏

`splitPane()` 会：

- 创建新的 draft session
- 创建新的 leaf
- 用一个 `split` 节点替换当前 leaf
- 更新 `activePaneId` 和 `activeSessionId`

因此 Pane 树既是布局结构，也是 session 并行结构。

### 4.5 Archive 视图

前端状态里已经有 archive 相关字段：

- `archive`
- `viewingArchiveId`

当前已形成的行为是：

- 关闭非 draft pane 时可触发后端归档
- 如果进入 archive 视图，Agent 面板会进入只读显示

但当前缺少完整的 archive 浏览入口，所以它还不是一个完整可见模块。

### 4.6 代码面板状态

代码区的显示受多组状态共同影响：

- `showCodePanel`
- `isCodeExpanded`
- `codeSidebarView`
- `previewMode`
- `filePreview`
- `fileSearch*`

当用户从 Git 改动列表选择文件时，`filePreview` 会进入 `diff` 模式；从文件树打开文件时，则进入 `preview` 模式。

### 4.7 终端面板状态

终端区的状态由以下几项驱动：

- `showTerminalPanel`
- `activeTerminalId`
- `terminals`
- 面板尺寸状态 `rightSplit`

终端输出文本会存入对应 terminal 的 `output`，而 PTY 句柄只保留在后端。

## 5. 事件与前端同步

前端通过 WebSocket 订阅三类主要事件：

- `agent://event`
- `agent://lifecycle`
- `terminal://event`

这些事件用于把后端 PTY 流和 Claude lifecycle 变化映射回前端状态。

另外，前端仍大量依赖“主动刷新”来拉取最新工作区产物，例如：

- Git 状态
- Git 变更列表
- worktree 列表
- 文件树

所以当前同步策略是“事件流 + 主动刷新”混合模式。

## 6. 本地持久化

`workbench.ts` 会把工作台状态写入 Local Storage。

当前会持久化：

- tabs
- layout
- overlay 基础状态

另外 `App.tsx` 还会单独持久化：

- app settings
- locale

写入时会做一定清洗，例如 draft session 不会被原样长期持久化。

## 7. 当前状态模型和 UI 的差异点

下面这些能力在状态或后端里有明显痕迹，但当前 UI 并未完整对等开放：

- `queue`
- `archive` 浏览中心
- `worktrees` 的显式管理入口
- `SessionMode = git_tree`
- `SessionStatus = suspended`

所以在开发文档里，必须明确区分：

- “状态模型支持”
- “用户界面当前完整可用”
