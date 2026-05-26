# Draft Pane Editor Integration Design

Date: 2026-05-25
Status: Draft
Owner: codex

## Problem

当前 `session pane` 区域只支持 agent session。`draft pane` 只能作为 `Claude` / `Codex` 的启动器，不能承接文件编辑。用户如果想在同一个 pane 布局体系里并排放置 agent 与 editor，只能依赖当前 workspace 的单例 editor 主区，不能把一个 `draft pane` 固化成专门的 editor pane。

这带来三个产品问题：

- pane 资源类型没有正式建模，`draft pane` 只能通向 agent session
- 文件打开链路是 workspace 级单例，不支持“把资源管理器点击文件路由到某个 editor pane”
- `agent pane` 布局和 editor 主区是两套平行模型，不能共享同一套 split / close / persistence 心智

目标不是把 editor 混进 agent session 内部，而是把 `draft pane` 变成一种真正的资源入口：可以启动 agent，也可以固化为 editor。

## Goals

- 允许把文件拖到 `draft pane`，将其一次性转换为 `editor pane`
- `session pane` 继续只承载 agent session，不接收文件拖放
- `editor pane` 转换完成后保持 editor 类型，直到被关闭
- 当存在 focused `editor pane` 时，资源管理器、搜索结果、quick open 打开的文件都优先路由到该 pane
- 当不存在任何 `editor pane` 时，文件打开行为保持当前 workspace 级 editor 逻辑不变
- 继续复用现有 `paneLayout` split tree、close 行为和服务端持久化链路

## Non-Goals

- 不支持把 `session pane` 直接改成 `editor pane`
- 不支持把 `editor pane` 直接改成 `session pane`
- 不支持拖文件到 `session pane` 或已存在的 `editor pane`
- 不在第一期支持多个 editor pane 之间的文件拖拽交换
- 不在第一期持久化每个 editor pane 的完整打开文件、dirty buffer、diff 状态
- 不在第一期重写 Monaco model registry 主键
- 不在第一期实现通用 workbench / tabbed resource system

## Product Rules

### Pane Type Rules

Leaf pane 需要从隐式 `sessionId` 语义升级为显式资源类型：

- `draft`
- `session`
- `editor`

规则如下：

- `draft pane` 可以通过点击 provider 进入 `session`
- `draft pane` 可以通过文件拖放进入 `editor`
- `session pane` 永远只承载 agent session
- `editor pane` 永远只承载文件编辑
- `close` 是统一出口：关闭当前资源后，pane 回到 `draft`

### File Drop Rules

- 只有 `draft pane` 注册文件拖放目标
- 文件拖到 `draft pane` 的语义不是重排 pane，而是把该 draft 固化为 `editor pane`
- `session pane` 和 `editor pane` 都不允许接收文件拖放

### File Open Routing Rules

- 若当前 workspace 存在 focused `editor pane`，文件打开动作优先路由到该 pane
- 若 focused pane 已不存在或不再是 `editor`，可回退到最近活跃的 `editor pane`
- 若当前 workspace 不存在任何 `editor pane`，继续沿用现有 workspace 级 editor 打开逻辑

## Desired User Behavior

### 1. Draft To Session

用户在 `draft pane` 点击 `Claude` 或 `Codex`：

- 当前 leaf 从 `draft` 转为 `session`
- 启动对应 session
- 该 pane 后续只承载 agent session

### 2. Draft To Editor

用户从资源管理器拖一个文件到 `draft pane`：

- draft pane 出现文件拖放高亮
- drop 后该 leaf 从 `draft` 转为 `editor`
- editor pane 立即打开被拖入的文件
- 该 pane 成为当前 focused `editor pane`

### 3. Editor File Switching

当某个 `editor pane` 处于 focus 状态时：

- 点击资源管理器文件，在该 pane 打开
- quick open 打开的文件，在该 pane 打开
- 搜索结果点击打开的文件，在该 pane 打开

当没有任何 `editor pane` 时：

- 以上行为全部保持当前 workspace 级 editor 打开方式

### 4. Editor Close

关闭 `editor pane` 时：

- 清理该 pane 作用域下的 editor 状态
- 当前 leaf 回到 `draft`
- 若它是 focused `editor pane`，清空 focus 或切到另一个仍存在的 `editor pane`

该行为与现有 session close -> draft 的用户心智保持一致。

### 5. Split Behavior

`draft`、`session`、`editor` 三类 leaf 在 split 时都遵循统一规则：

- 原 leaf 保持原资源
- 新 sibling 一律创建为新的 `draft leaf`

不复制 session，不复制 editor buffer，不产生“镜像 editor pane”。

## Data Model

### Core Type Changes

把 [WorkspacePaneNode](/root/workspace/coder-studio/packages/core/src/domain/types.ts:25) 的 leaf 模型从：

```ts
type WorkspacePaneNode = {
  id: string;
  type: "leaf" | "split";
  sessionId?: string;
  direction?: "horizontal" | "vertical";
  children?: WorkspacePaneNode[];
};
```

升级为显式 leaf 类型：

```ts
type WorkspacePaneLeaf =
  | { id: string; type: "leaf"; leafKind: "draft" }
  | { id: string; type: "leaf"; leafKind: "session"; sessionId: string }
  | { id: string; type: "leaf"; leafKind: "editor" };

type WorkspacePaneSplit = {
  id: string;
  type: "split";
  direction: "horizontal" | "vertical";
  children: WorkspacePaneNode[];
};

type WorkspacePaneNode = WorkspacePaneLeaf | WorkspacePaneSplit;
```

`editor` 不需要单独的 `editorId`。`paneId` 本身就是 editor 作用域键。

### Migration Rules

现有持久化布局需要兼容旧结构：

- 旧 leaf 且 `sessionId` 有值 -> `leafKind: "session"`
- 旧 leaf 且 `sessionId` 为空 -> `leafKind: "draft"`
- 新 `editor pane` 只以新结构写回

读取和写入两端都应支持 normalize：

- 前端 hydration 时兼容旧布局
- 服务端保存和返回时兼容新布局

## State Model

### Pane-Scoped Editor State

当前 editor 主状态是 workspace 级单例，主要包括：

- `activeFilePath`
- `openFiles`
- `editorMode`
- `gitDiffPreview`
- `pendingEditorNavigation`

要支持 `editor pane`，需要引入 pane 级 editor 状态，例如：

```ts
editorPaneStateAtomFamily({ workspaceId, paneId })
```

推荐最小拆分为：

- `activeFilePath`
- `openFiles`
- `editorMode`
- `gitDiffPreview`
- `pendingNavigation`

每个 `editor pane` 拥有自己独立的状态域。

### Workspace Routing State

在 workspace 级新增 editor 路由状态：

- `focusedEditorPaneIdAtomFamily(workspaceId)`
- `lastActiveEditorPaneIdAtomFamily(workspaceId)`

职责：

- 决定“当前文件打开动作应该打到哪个 editor pane”
- 不承担具体 editor buffer 存储

### Fallback Workspace Editor

为降低迁移风险，第一期保留现有 workspace 级 editor 状态作为 fallback。

行为如下：

- 若存在 focused `editor pane`，文件打开路由到 pane-scoped editor state
- 若不存在任何 `editor pane`，继续使用现有 workspace 级 editor state

这样可以避免一次性重写所有 editor 消费方。

## Architecture

本次设计涉及四层：

1. pane tree 与持久化模型
2. draft file drop 与 pane resource view
3. editor open router
4. pane-scoped editor state / actions

### 1. Pane Tree Layer

主要文件：

- [packages/web/src/features/agent-panes/atoms/pane-layout.ts](/root/workspace/coder-studio/packages/web/src/features/agent-panes/atoms/pane-layout.ts:1)
- [packages/web/src/features/agent-panes/pane-layout-tree.ts](/root/workspace/coder-studio/packages/web/src/features/agent-panes/pane-layout-tree.ts:1)
- [packages/server/src/workspace/pane-layout.ts](/root/workspace/coder-studio/packages/server/src/workspace/pane-layout.ts:1)

需要做的变更：

- 新增 typed leaf helpers：`draft` / `session` / `editor`
- 关闭资源时统一把 leaf 还原为 `draft`
- split 时保留原 leaf，新建 sibling draft
- 新增 `convertDraftPaneToEditor(paneId)` pane mutation

### 2. View Layer

主要文件：

- [packages/web/src/features/agent-panes/index.tsx](/root/workspace/coder-studio/packages/web/src/features/agent-panes/index.tsx:1)
- [packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx](/root/workspace/coder-studio/packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx:1)
- [packages/web/src/features/agent-panes/views/shared/session-card.tsx](/root/workspace/coder-studio/packages/web/src/features/agent-panes/views/shared/session-card.tsx:1)
- 新增 editor pane card 组件

职责：

- `draft pane` 渲染 provider launcher
- `draft pane` 接收文件拖放并触发 draft -> editor
- `session pane` 继续渲染 `SessionCard`
- `editor pane` 渲染 `CodeEditorHost` / `EditorSurface` 的 pane 版本

### 3. Editor Open Router

新增统一入口：

- `useEditorOpenRouter(workspaceId)`

所有文件打开入口都应先经过 router，而不是直接写 workspace 级 `activeFilePath`。

路由流程：

1. 读取 `focusedEditorPaneId`
2. 验证该 pane 仍存在且 `leafKind === "editor"`
3. 若成立，打开到该 pane 的 editor state
4. 否则若存在可回退的 editor pane，打开到该 pane
5. 否则走当前 workspace fallback editor 逻辑

需要接入 router 的入口包括：

- 文件树选择
- 搜索结果选择
- quick open
- 其它现有 open file 调用点

### 4. Pane-Scoped Editor Hooks

需要让现有 editor 能按 scope 工作，而不是只能依赖 active workspace：

- [useCodeEditorActions](/root/workspace/coder-studio/packages/web/src/features/code-editor/actions/use-code-editor-actions.ts:1)
- [useOpenLocation](/root/workspace/coder-studio/packages/web/src/features/code-editor/actions/use-open-location.ts:1)
- [useOpenEditorsActions](/root/workspace/coder-studio/packages/web/src/features/workspace/actions/use-open-editors-actions.ts:1)

不复制一套 editor，而是为这些 hooks 增加 scope 参数：

- `workspace` fallback scope
- `pane` scope

例如：

```ts
type EditorScope =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "pane"; workspaceId: string; paneId: string };
```

这样现有 `CodeEditorHost` 可以继续复用，只是数据源改为 scope-aware。

## Interaction Details

### Draft File Drop Feedback

`draft pane` 的文件拖拽交互如下：

- 默认态：沿用当前 session launcher
- 文件 hover 态：整块 pane 高亮
- 中心文案切为 `Open in editor`
- drop 后立即切成 editor pane

文件拖拽不使用现有 session pane 的五向 overlay。它不是 pane reorder，而是资源类型激活。

### Editor Pane Chrome

`editor pane` 的外层 chrome 应保持 pane 风格，而不是 workspace 主区样式。

header：

- 左侧：文件名、dirty 状态、当前模式
- 右侧：split horizontal、split vertical、save、close

主体：

- 复用 [CodeEditorHost](/root/workspace/coder-studio/packages/web/src/features/code-editor/views/shared/code-editor-host.tsx:1) 与 `EditorSurface`

### Focus Rules

点击 `editor pane` 内任意可交互区域时：

- 设为 `focusedEditorPaneId`

注意：

- 点击 `session pane` 不应清掉 editor focus
- editor focus 是“文件打开路由目标”，不是全局最后点击 pane

否则用户查看 session 输出后，文件树打开目标会被意外重置。

## Persistence Strategy

### Persisted

第一期持久化：

- `paneLayout`

### Not Persisted In V1

第一期不持久化：

- `focusedEditorPaneId`
- editor pane 的 `openFiles`
- dirty buffer
- `pendingNavigation`
- `gitDiffPreview`

刷新后允许出现：

- pane layout 仍存在
- `editor pane` 恢复为空 editor shell，等待重新打开文件

这比持久化未保存 buffer 更安全，也更符合当前代码基础。

## Implementation Plan

按以下顺序实现：

1. 扩展 `WorkspacePaneNode` 与 pane tree helpers
2. 增加 `draft -> editor` mutation 和 `editor pane` 视图容器
3. 引入 editor open router，先接管所有 open file 入口
4. 为 editor hooks 增加 scope，支持 pane-scoped editor state
5. 补齐 focus、dispose、close -> draft 细节
6. 完善测试与旧布局迁移

这样每一步都可单独验证，不需要一次性重写整个 editor 系统。

## Testing

至少需要覆盖四类测试。

### Pane Tree Tests

- 旧 leaf 迁移为 typed leaf
- `draft -> editor`
- `editor close -> draft`
- `editor split -> editor + draft`

### Component Interaction Tests

- 文件拖到 `draft pane` 后转换为 `editor pane`
- 文件拖到 `session pane` 无效
- 点击 `editor pane` 后成为 focused editor target

### Router Tests

- 有 focused `editor pane` 时，文件树点击打开到该 pane
- focused pane 失效时，回退到下一个 editor pane 或 fallback editor
- 没有 editor pane 时，保持当前 workspace 级打开行为

### End-To-End Tests

- split 出两个 pane
- 左边启动 `Codex` session
- 右边把文件拖入 `draft pane` 变成 `editor pane`
- 在资源管理器继续点文件，确认都在右侧 editor pane 打开
- 关闭 editor pane，确认回到 draft launcher

## Risks And Mitigations

### 1. Dual State During Migration

风险：

- pane-scoped editor state 和 workspace fallback editor state 会并存一段时间

控制：

- 所有 open file 行为统一先走 router
- 避免调用点直接双写两套 atom

### 2. Monaco Lifecycle Complexity

风险：

- 当前 model registry 以 workspace + path 为主，不是 pane + path

控制：

- 第一阶段继续共享 model registry
- 只把 editor UI 状态分 pane，不立即改 model key 体系

### 3. Broad Existing Workspace-Level Coupling

风险：

- 现有很多代码直接依赖 workspace 级 editor atom

控制：

- 先把 pane editor 作为新的 scoped consumer
- workspace fallback editor 继续服务旧路径
- 逐步迁移消费方，而不是一次性重写

## Acceptance Criteria

- 文件可以拖入 `draft pane`，并把其转换为 `editor pane`
- `session pane` 无法接收文件拖放
- `editor pane` 获得 focus 后，资源管理器点击文件会持续在该 pane 打开
- 没有任何 `editor pane` 时，文件打开行为保持当前逻辑
- 关闭 `editor pane` 后，pane 回到 `draft`
- 旧 `paneLayout` 可以安全迁移到 typed leaf 结构
