# Workspace Launch Modal Title And New Folder Design

Date: 2026-05-28
Status: Draft
Owner: Codex

## Problem

当前“启动工作区”流程里的目录选择弹框存在两个明显问题：

- 标题区重复表达了同一件事。中文下同时出现 `启动工作区` 和 `打开工作区`，与其他弹框的单一标题模式不一致。
- 用户只能浏览已有目录，不能在启动前直接创建一个新文件夹作为工作区根目录。

这会带来两个后果：

- 弹框头部信息层级冗余，视觉上显得不像同一套 modal grammar。
- 用户想新建一个项目目录时，需要切出当前流程到系统文件管理器或终端，打断“选择目录 -> 启动工作区”的主路径。

## Goals

- 让工作区启动弹框的主标题与其他弹框保持一致，只保留 `启动工作区`。
- 在当前浏览目录下提供 `新建文件夹` 能力。
- 新建文件夹使用最短路径完成，不引入二级弹框。
- 创建成功后刷新当前目录列表，并选中新建文件夹，但不自动进入。
- 保持现有浏览、返回上一级、选择目录、启动工作区行为不变。

## Non-Goals

- 不重做整个工作区启动流程。
- 不把普通文件树中的创建弹窗整体搬进工作区启动弹框。
- 不在本次加入“新建文件”。
- 不加入完整路径输入模式；用户只输入文件夹名。
- 不在创建成功后自动打开或自动进入新文件夹。
- 不修改已打开工作区内文件树的创建交互。

## User Decisions Captured

- 标题改成和其他弹框一致，只保留 `启动工作区`。
- 新建文件夹的默认行为是：
  - 在当前浏览目录下创建
  - 创建成功后刷新目录列表
  - 选中新建文件夹
  - 不自动进入
- 新建交互采用工具栏内联模式，不再打开二级弹框。

## Approaches Considered

### Option A: 复用文件树现有创建对话框

优点：

- 可复用现有 `file.create / file.mkdir` 交互模型。
- 校验和错误呈现模式已经存在。

缺点：

- 文件树交互是围绕“已打开 workspaceId”设计的，不适合直接照搬到启动前目录浏览。
- 为一个轻量需求引入过多状态和 UI 负担。

### Option B: 在工作区启动弹框里做内联最小创建流（推荐）

优点：

- 改动集中在启动弹框链路。
- 用户不离开当前上下文即可完成创建。
- 只需最小量状态：展开态、输入值、提交中、错误。

缺点：

- 需要为“未打开工作区时创建目录”补一条专用命令链路或扩展已有浏览命令能力。
- 与文件树的创建逻辑会有少量重复校验。

### Option C: 先启动一个父目录工作区，再在文件树里创建目录

优点：

- 复用现有文件树能力最多。

缺点：

- 明显偏离用户要在启动弹框内完成创建的诉求。
- 打断启动流程，并引入额外工作区切换成本。

## Final Choice

采用 Option B。

工作区启动弹框保留当前目录浏览主体，在工具栏里新增 `新建文件夹` 按钮。创建流程使用内联输入，不叠加二级弹框。服务端增加一条专供启动前目录浏览使用的受控目录创建命令，避免强行复用依赖 `workspaceId` 的 `file.mkdir`。

## Final Design

### 1. Title Unification

当前中文 locale 中：

- `workspace.launch.kicker` 为 `启动工作区`
- `workspace.launch.title` 为 `打开工作区`

本次统一规则：

- 弹框头部只表达一次主动作。
- 中文 `workspace.launch.title` 改为 `启动工作区`。
- 桌面端不再让 `kicker + title` 形成语义重复。
- 移动端 `Sheet` 标题同样显示 `启动工作区`。

推荐实现：

- 保留共享 modal/sheet 结构。
- 桌面端移除或弱化 launch-specific kicker，让 `.launch-title` 成为唯一主标题。
- 如需保留 eyebrow 位置，可留空，不再显示第二份语义重复文案。

### 2. New Folder Entry Point

入口放在目录浏览工具栏，与现有：

- `主目录`
- `返回上一级`

同层级展示。

新增按钮：

- 文案：`新建文件夹`
- 行为：切换一个内联创建区

此入口只对当前浏览目录生效。

### 3. Inline Create UI

点击 `新建文件夹` 后，在目录列表上方显示一条轻量创建区，不开启新的 modal。

创建区包含：

- 输入框
- `创建` 按钮
- `取消` 按钮
- 就地错误提示区

交互规则：

- 输入框只接收文件夹名称，不接收完整路径。
- 默认聚焦输入框。
- `Enter` 提交。
- `Escape` 或点击 `取消` 关闭创建区并清空草稿。
- 当创建区已展开时，再次点击 `新建文件夹` 不重复展开第二个创建区。

### 4. Create Semantics

用户在当前目录 `currentPath` 下输入名称 `demo` 时：

- 最终创建目标为 `${currentPath}/demo`

成功后执行顺序：

1. 关闭创建区
2. 重新加载当前目录
3. 将 `selectedPath` 设为新目录完整路径
4. 不自动调用 `handleNavigate`
5. 不自动调用 `handleOpen`

这保证用户可以继续确认是否把新目录作为工作区根目录。

### 5. Validation And Error Handling

前端最小校验：

- 去除首尾空白后为空：不允许
- 包含 `/`：不允许
- 包含 `\\`：不允许

失败时：

- 不关闭创建区
- 不清空输入值
- 在输入区下方显示错误

服务端错误直接透传常见原因，例如：

- 已存在同名目录
- 无权限创建
- 路径不可写

提交中状态：

- `创建` 按钮进入 loading 或 disabled
- 输入框和取消按钮保持禁用，避免重复提交

### 6. Command Design

现有 `workspace.browse` 可以浏览任意本机路径，但 `file.mkdir` 依赖已打开的 `workspaceId`。工作区启动弹框处于“尚未打开工作区”阶段，因此需要新增一条启动前目录操作命令。

建议新增：

- `workspace.mkdir`

输入：

- `path`: 目标绝对路径

约束：

- 复用 `workspace.browse` 同一套路径解析策略
- 只允许操作浏览器当前可导航到的本机路径
- 创建目录时使用真实绝对路径，不引入 workspace record

返回：

- `{ ok: true }`

错误策略：

- 以 command error message 形式返回可读失败原因

这样可以保持边界清晰：

- 启动前目录管理走 `workspace.*`
- 已打开工作区内文件系统操作继续走 `file.*`

### 7. Frontend State Changes

建议把以下状态加入 `useWorkspaceLaunchActions`：

- `isCreatingFolder`
- `newFolderName`
- `createFolderError`
- `creatingFolder`

新增动作：

- `openCreateFolder()`
- `closeCreateFolder()`
- `updateNewFolderName(value)`
- `submitCreateFolder()`

`submitCreateFolder()` 负责：

1. 做前端校验
2. 调用 `workspace.mkdir`
3. 成功后重新调用 `loadDirectory(currentPath)`
4. 设置 `selectedPath` 为新目录路径
5. 清理创建状态

### 8. Locale Changes

需要补充或调整文案：

- `workspace.launch.title`
- `workspace.launch.new_folder`
- `workspace.launch.new_folder_placeholder`
- `workspace.launch.create_folder`
- `workspace.launch.create_folder_cancel`
- `workspace.launch.folder_name_required`
- `workspace.launch.folder_name_invalid`
- `workspace.launch.create_folder_failed`

中英文都要补齐，避免只修中文时打断英文单测。

### 9. Testing

#### 9.1 Web Unit Tests

扩展 [`packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`](../../../packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx)：

- 标题改为单一 `Start Workspace` / `启动工作区`
- 点击 `New Folder` 后出现输入区
- 取消后输入区关闭
- 输入非法名称时显示校验错误
- 创建成功后重新加载当前目录并选中新目录
- 创建失败时保留输入区并显示错误

扩展 action hook 相关测试时，重点验证：

- `workspace.mkdir` 调用参数为绝对路径
- 成功后 `loadDirectory(currentPath)` 被再次触发
- `selectedPath` 落到新目录完整路径

#### 9.2 E2E

扩展工作区启动流程测试：

- 在启动弹框中创建新文件夹
- 新文件夹立即出现在目录列表中
- 用户可以直接选中新文件夹并点击 `启动工作区`

## Edge Cases

- 当前目录原本为空：创建成功后空状态应立即消失，显示新目录。
- 当前目录刷新后排序变化：仍应以完整路径匹配选中新目录，而不是依赖原索引。
- 用户快速重复点击 `新建文件夹`：只保留一个创建区。
- 用户在创建区展开后切换目录：创建区自动关闭，避免把旧目录上下文带到新目录。
- 用户正在创建时关闭整个弹框：不做额外恢复，下次打开从干净状态开始。

## Implementation Notes

- 该需求是对现有启动弹框的局部增强，不应引入新的页面级状态容器。
- 桌面和移动端应共享同一套创建逻辑，只在容器壳层上保持差异。
- 不要把已打开工作区文件树的 create dialog 直接嵌进来；启动前目录浏览和已打开工作区文件操作应保持边界清楚。
