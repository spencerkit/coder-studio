# Workspace

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- workspace 列表、打开、关闭、浏览目录、创建目录。
- active workspace、空态、加载态、错误态。
- workspace intelligence 和历史记录。

不覆盖：
- 桌面布局、移动布局、文件/Git/终端细节。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| `/workspace` | Both | 主工作区页面。 |
| Workspace launch modal | Both | 浏览目录、创建目录、打开 workspace。 |
| Workspace tab / drawer | Both | 切换或关闭 workspace。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| WS-001 | 拉取 workspace 列表 | Implemented | `packages/server/src/commands/workspace.ts`、`workspace.list` | `packages/server/src/__tests__/workspace-commands.test.ts` |
| WS-002 | 浏览可打开目录 | Implemented | `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`、`workspace.browse` | `packages/web/src/features/workspace/actions/use-workspace-launch-actions.test.tsx` |
| WS-003 | 创建目录 | Implemented | `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`、`workspace.mkdir` | `packages/server/src/__tests__/workspace-commands.test.ts` |
| WS-004 | 打开 workspace | Implemented | `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`、`workspace.open` | `packages/web/src/features/workspace/actions/use-workspace-launch-actions.test.tsx` |
| WS-005 | 关闭 workspace | Implemented | `packages/web/src/features/workspace/actions/use-workspace-close-action.ts`、`workspace.close` | `packages/server/src/__tests__/workspace-close-state-cleanup.test.ts` |
| WS-006 | 激活/停用 workspace | Implemented | `packages/server/src/commands/workspace-activity.ts`、`workspace.activate`、`workspace.deactivate` | `packages/server/src/__tests__/workspace-commands.test.ts` |
| WS-007 | workspace 加载、空态和错误态 | Implemented | `packages/web/src/features/workspace/views/shared/workspace-route-gate.tsx`、`workspace-loading-state.tsx`、`workspace-empty-state.tsx` | `packages/web/src/features/workspace/views/shared/workspace-route-gate.test.tsx` |
| WS-008 | workspace 历史列表 | Implemented | `workspace.history.list`、`packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts` | 手工验收：启动器最近 workspace 区域 |
| WS-009 | workspace intelligence | Internal | `workspace.intelligence`、`packages/server/src/workspace/intelligence.ts` | `packages/server/src/__tests__/workspace-intelligence-command.test.ts` |
| WS-010 | workspace runtime check 和 validator | Internal | `packages/server/src/workspace` | `packages/server/src/__tests__/workspace/runtime-check.test.ts`、`packages/server/src/__tests__/workspace/validator.test.ts` |

## 4. 模块级验收线索

- 打开有效目录后进入 `/workspace` 并成为 active workspace。
- 关闭最后一个 workspace 后应进入无 workspace 状态。
- 目录浏览失败和打开失败应有错误反馈。

## 5. 功能点规格

### WS-002 浏览可打开目录

状态：`Implemented`

用户行为：
- 用户打开 workspace 启动器。
- 用户进入某个目录、返回父目录或选择根路径。

系统响应：
- 前端通过 `workspace.browse` 请求目录列表。
- 服务端把空路径、`~` 或相对路径解析到用户 home 目录下。
- 返回 `currentPath`、`parentPath`、按名称排序的目录列表和 `rootPaths`。
- 普通文件不出现在目录列表；指向目录的符号链接可以出现。

状态与边界：
- Loading：启动器处于 `browsing` 状态。
- Success：更新当前路径、父路径、目录列表、根路径和 home 路径。
- Error：请求失败时在启动器内展示错误。

验收标准：
- Given 启动器已打开
- When 用户进入一个包含多个子目录的路径
- Then 启动器显示该路径下的目录项
- And 目录项按名称排序
- And 非目录文件不出现在列表中

代码索引：
- `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- `packages/server/src/commands/workspace.ts`

### WS-003 创建目录

状态：`Implemented`

用户行为：
- 用户在 workspace 启动器中输入新目录名并提交。

系统响应：
- 前端校验目录名不能为空，且不能包含 `/` 或 `\`。
- 服务端通过 `workspace.mkdir` 创建目录。
- 创建成功后重新 browse 当前目录，并选中新目录。

状态与边界：
- Loading：创建中时 `creatingFolder` 为 true。
- Success：关闭创建输入态，清空错误，并选中新目录。
- Error：目录名非法、当前路径为空、创建失败或重新 browse 失败时显示 `createFolderError`。
- Race：如果用户关闭创建态或发起新的创建请求，旧请求结果会被 request id 忽略。

验收标准：
- Given 启动器当前路径有效
- When 用户创建一个合法的新目录
- Then 目录创建成功
- And 启动器刷新当前路径
- And 新目录被选中

代码索引：
- `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- `packages/server/src/commands/workspace.ts`

### WS-004 打开 workspace

状态：`Implemented`

用户行为：
- 用户选择目录并点击打开，或从最近 workspace 记录打开路径。

系统响应：
- 前端调用 `workspace.open`。
- 服务端通过 workspace manager 打开路径，记录 workspace history，并同步 agent instructions。
- 打开成功后前端设置 active workspace，写入 workspace map，恢复 editor UI state，并把 workspace id 放到 order 头部。
- 如果当前不在 `/workspace`，前端跳转到 `/workspace`。

状态与边界：
- Loading：打开过程中 `loading` 为 true。
- Success：modal 关闭，workspace load state 进入 `ready`，load error 清空。
- Error：命令失败或返回缺少 workspace id 时跳转到 diagnostics，context 为 `workspace_open`。

验收标准：
- Given 启动器中已选择有效路径
- When 用户确认打开
- Then active workspace 切换为打开结果
- And 页面进入 `/workspace`
- And workspace order 中该 workspace 位于最前

代码索引：
- `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- `packages/server/src/commands/workspace.ts`

### WS-005 关闭 workspace

状态：`Implemented`

用户行为：
- 用户从 workspace tab、drawer 或其他关闭入口关闭 workspace。

系统响应：
- 前端调用 `workspace.close`。
- 服务端关闭 workspace，并清理对应 workspace 状态。
- 前端应从 workspace map/order 中移除该 workspace，并选择下一个可用 workspace 或进入空态。

状态与边界：
- Success：关闭目标 workspace 后不再显示在列表中。
- Empty：关闭最后一个 workspace 后进入无 workspace 状态。
- Error：关闭失败时应保持原 workspace 状态并反馈错误。

验收标准：
- Given 当前有两个 workspace
- When 用户关闭 active workspace
- Then active workspace 从列表中移除
- And 应自动选择另一个 workspace

代码索引：
- `packages/web/src/features/workspace/actions/use-workspace-close-action.ts`
- `packages/server/src/commands/workspace.ts`

### WS-007 workspace 加载、空态和错误态

状态：`Implemented`

用户行为：
- 用户访问 `/workspace` 或刷新工作区页面。

系统响应：
- route gate 根据 workspace load state、active workspace 和 workspace 列表决定显示内容。
- 没有 workspace 时展示空态或回到欢迎路径。
- active workspace 未解析或加载失败时展示加载态或错误态。

状态与边界：
- Loading：workspace 列表或 active workspace 仍在解析。
- Empty：当前没有可进入 workspace。
- Ready：active workspace 可用，渲染桌面或移动工作区。
- Error：加载失败时展示错误状态。

验收标准：
- Given workspace 列表为空
- When 用户访问 `/workspace`
- Then 页面不应渲染无效工作区
- And 应展示空态或返回欢迎入口

代码索引：
- `packages/web/src/features/workspace/views/shared/workspace-route-gate.tsx`
- `packages/web/src/features/workspace/views/shared/workspace-loading-state.tsx`
- `packages/web/src/features/workspace/views/shared/workspace-empty-state.tsx`

## 6. 未确认项

- workspace intelligence 的用户入口需在 Agent Instructions 或 Work Analysis 规格轮确认。
