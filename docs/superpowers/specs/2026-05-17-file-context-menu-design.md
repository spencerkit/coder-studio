# File Context Menu — Design

Date: 2026-05-17
Status: Draft
Owner: Codex

## Problem

当前工作区文件树中的文件项在选中后仍然会触发浏览器原生右键菜单，这对文件交互并不友好：

- 原生菜单不理解“文件 / 文件夹 / 工作区”语义。
- 当前树节点虽然已经有部分行尾快捷操作，但它们不能覆盖右键与移动端长按场景。
- 搜索结果行、树节点、移动端文件表面没有共享的上下文动作模型。
- 现有文件命令只覆盖 `create / mkdir / delete`，缺少 `rename`，也不能把“在终端中打开”落到目标目录。

结果是：

- 桌面端右键体验与 IDE 预期不一致。
- 移动端缺少与右键等价的长按上下文操作。
- 文件相关动作分散在 hover 图标、顶部工具栏和未来的上下文菜单之间，难以维护。

本次设计的目标是把文件树改造成更接近 VS Code Explorer 的上下文交互：桌面端使用自定义右键菜单，移动端使用长按 action sheet，并且三类入口共享同一套文件动作语义。

## Goals

- 用自定义文件上下文菜单替换文件树域内的浏览器原生右键菜单。
- 桌面端树节点、桌面端搜索结果行、移动端长按菜单共享同一套动作定义。
- 首版支持：
  - `新建文件`
  - `新建文件夹`
  - `重命名`
  - `删除`
  - `复制相对路径`
  - `复制绝对路径`
  - `在终端中打开`
- 为 `重命名` 增加正式命令链路，而不是只做 UI 占位。
- 为 `在终端中打开` 增加以目标目录启动 shell terminal 的能力。
- 保持左键打开文件、左键展开目录等现有主交互不变。

## Non-Goals

- 不做全局统一的应用级右键系统。
- 不改 Git 面板、工作区列表、终端面板等非文件树表面的右键交互。
- 不实现 VS Code 式 inline rename。
- 不把重命名扩展为跨目录移动。
- 不在本次加入 `Reveal in Explorer`、`Collapse All`、`Refresh` 等额外动作。
- 不实现拖拽排序、拖拽移动、批量选择或多选右键菜单。

## User Decisions Captured

- 范围同时覆盖：
  - 桌面端树节点右键
  - 桌面端搜索结果行右键
  - 移动端长按菜单
- 菜单分组采用统一结构：
  - 创建
  - 编辑
  - 路径
  - 终端
- 动作范围采用“常用版”：
  - `新建文件 / 新建文件夹 / 重命名 / 删除 / 复制相对路径 / 复制绝对路径 / 在终端中打开`
- `在终端中打开` 默认行为是：
  - 新建一个 terminal tab
  - 文件落到其所在目录
  - 文件夹落到该文件夹本身
- 桌面端保留最少量 hover 快捷操作，移动端尽量收口到长按菜单。
- `重命名` 属于正式需求范围。
- 首版 `重命名` 仅支持同目录改名，不支持跨目录移动。
- `重命名` 首版采用弹窗，不做 inline rename。

## Approaches Considered

### Option A: 只在 `FileTreePanel` 内轻量拦截右键

在现有 [`file-tree-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/file-tree-panel.tsx) 中直接处理 `contextmenu`、移动端长按、菜单渲染和所有动作。

优点：

- 实现最快。
- 初次接入文件树改动面最小。

缺点：

- 树节点、搜索结果行、移动端逻辑容易各写一套。
- 菜单状态、复制逻辑、终端创建逻辑都会堆进一个文件。
- 后续扩动作时维护成本高。

### Option B: 共享动作模型 + 专用上下文菜单层（推荐）

把“文件项上下文动作”抽成共享描述层；树节点、搜索结果行、移动端长按都消费同一套动作模型。桌面端使用坐标锚定的专用右键菜单，移动端使用 action sheet。

优点：

- 最符合 IDE 风格的语义收口方式。
- 三类入口共享同一动作源，行为一致。
- 后续扩展文件动作或增加别的 explorer 表面时可复用。

缺点：

- 比 Option A 多一层结构性抽象。
- 需要新增 `file.rename` 与扩展 `terminal.create`。

### Option C: 泛化成全局 Explorer Command Registry

先建立更抽象的 explorer 命令中心，再由右键菜单、工具栏、快捷键统一消费。

优点：

- 长期结构最整洁。
- 可直接支撑更大范围的 IDE 命令系统。

缺点：

- 对当前需求明显过重。
- 需要额外定义 registry 生命周期、权限模型、快捷键接入方式。

## Final Choice

采用 Option B。

本次只在文件树域内建立共享动作模型和专用上下文菜单层，不把范围扩展到全局右键系统。这样既能解决桌面右键与移动端长按的问题，也能把 `rename`、路径复制、终端打开这类动作规范地收敛在一起。

## Final Design

### 1. Interaction Model

#### 1.1 Desktop

- 在文件树节点和文件搜索结果行上监听 `onContextMenu`。
- 阻止浏览器原生菜单。
- 被右键命中的项先成为当前选中项，再弹出自定义菜单。
- 左键行为保持不变：
  - 文件左键：打开文件
  - 文件夹左键：展开 / 收起

#### 1.2 Mobile

- 文件树项支持长按触发上下文菜单。
- 触发时长建议为 `450ms`。
- 长按成功后打开底部 action sheet。
- 普通点击仍保持当前行为，不与长按冲突。
- 长按期间如果发生明显移动、滚动或 pointer/touch cancel，则取消菜单触发。

#### 1.3 Menu Structure

菜单分组固定为四段，并在桌面与移动端保持一致：

1. 创建
   - `新建文件`
   - `新建文件夹`
2. 编辑
   - `重命名`
   - `删除`
3. 路径
   - `复制相对路径`
   - `复制绝对路径`
4. 终端
   - `在终端中打开`

规则：

- 文件夹显示全部四组动作。
- 文件不显示“创建”组。
- `删除` 使用 danger 呈现。
- 桌面端可以显示快捷键样式占位，但本次不要求绑定实际快捷键。

### 2. Scope of Surfaces

本次只覆盖以下三个表面：

- [`FileTreeNode`](../../../packages/web/src/features/workspace/views/shared/file-tree-panel.tsx) 渲染出的树节点
- [`FileSearchResultRow`](../../../packages/web/src/features/workspace/views/shared/file-tree-panel.tsx) 渲染出的搜索结果行
- [`MobileFilesSheet`](../../../packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx) 中的移动端文件树项长按入口

不覆盖：

- Git 改动列表
- 工作区列表
- Worktree 详情树
- 编辑器标签

### 3. Shared Action Model

新增一层文件上下文动作构建逻辑，建议位置：

- `packages/web/src/features/workspace/actions/use-file-context-actions.ts`

该层输入：

- `workspaceId`
- `workspacePath`
- `node`
- `surface`
  - `"tree"`
  - `"search"`
  - `"mobile"`

该层输出标准化菜单项集合，包含：

- 文案
- icon
- tone
- disabled
- onSelect

动作层负责统一这些规则：

- 文件夹才允许 `新建文件 / 新建文件夹`
- `复制相对路径` 直接复制节点相对路径
- `复制绝对路径` 由 `workspace.path + node.path` 计算
- `在终端中打开` 自动把文件映射到父目录，把目录映射到自身
- `删除` / `重命名` 打开对应 feature-owned dialog，而不是直接内联执行

这样可以避免树节点、搜索结果行和移动端 sheet 各自拼装动作。

### 4. UI Architecture

#### 4.1 `FileTreePanel` 保持组合层职责

[`file-tree-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/file-tree-panel.tsx) 继续负责：

- 文件树和搜索结果的渲染
- create / delete / rename dialog 的挂载
- 选中文件路径
- 文件树加载和刷新

不直接承担完整菜单系统实现。

#### 4.2 新增专用上下文菜单层

建议新增：

- `packages/web/src/features/workspace/views/shared/file-context-menu.tsx`
- `packages/web/src/features/workspace/actions/use-file-tree-context-menu.ts`

职责划分：

- `use-file-tree-context-menu.ts`
  - 管理右键菜单打开状态
  - 记录桌面端菜单坐标
  - 管理移动端长按计时器
  - 接收目标节点并驱动菜单打开
- `file-context-menu.tsx`
  - 渲染桌面端右键菜单
  - 渲染移动端 action sheet
  - 接收共享动作列表并展示

#### 4.3 为什么不直接复用 `ActionMenu`

现有 [`ActionMenu`](../../../packages/web/src/components/ui/action-menu/index.tsx) 是“触发器锚定”模型，适合按钮下拉或 overflow 菜单；文件右键菜单需要“鼠标坐标锚定”模型。

因此本次不修改共享 `ActionMenu` 原语，避免把通用原语改成同时兼顾按钮锚定和坐标锚定的复杂组件。文件树右键菜单应由 feature layer 自行实现坐标定位，但在视觉与键盘语义上对齐现有菜单样式。

### 5. Dialog Model

本次保留 feature-owned modal 路线，与当前创建 / 删除行为一致。

#### 5.1 Create

继续使用现有创建弹窗：

- `新建文件`
- `新建文件夹`

右键菜单只负责把上下文目录传给现有 create dialog state。

#### 5.2 Delete

继续使用现有删除确认弹窗。

#### 5.3 Rename

新增 rename modal，建议位置仍在 [`file-tree-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/file-tree-panel.tsx) 内挂载，状态由 [`use-file-actions.ts`](../../../packages/web/src/features/workspace/actions/use-file-actions.ts) 扩展管理。

首版 rename modal 规则：

- 只编辑“名称”，不编辑完整路径。
- 目标目录固定为源项当前父目录。
- 文件与目录都支持重命名。
- 表单预填当前 `node.name`。
- 提交时组合为：
  - `fromPath = node.path`
  - `toPath = parentDir + "/" + nextName`

前端校验：

- 不能为空
- 去掉首尾空白后不能为空
- 不能包含 `/` 或 `\\`
- 名称不变时允许直接关闭，不发请求

### 6. Server Command Changes

#### 6.1 `file.rename`

在 [`packages/server/src/fs/file-io.ts`](../../../packages/server/src/fs/file-io.ts) 新增：

- `renameEntry(rootPath, fromPath, toPath): Promise<void>`

行为要求：

- 源路径和目标路径都必须通过 `resolveSafe`
- 源不存在时报错
- 目标已存在时报错
- 允许重命名文件
- 允许重命名目录
- 同目录重命名与子树目录重命名都应生效

在 [`packages/server/src/commands/file.ts`](../../../packages/server/src/commands/file.ts) 注册新命令：

- `file.rename`

参数：

- `workspaceId`
- `fromPath`
- `toPath`

成功后必须发出：

- `fs.dirty`

#### 6.2 `terminal.create` 扩展 `cwdPath`

在 [`packages/server/src/commands/terminal.ts`](../../../packages/server/src/commands/terminal.ts) 扩展 `terminal.create` 参数：

- `workspaceId`
- `cols?`
- `rows?`
- `cwdPath?`

规则：

- `cwdPath` 为相对 workspace 的路径，不接收绝对路径
- 服务端用 `resolveSafe` 解析
- 未提供时回落到 `workspace.path`
- 如果 `cwdPath` 指向不存在路径或非目录，返回错误

这样前端就不需要传绝对路径，也不会把路径校验放在浏览器端完成。

### 7. Terminal Integration

前端的“在终端中打开”应复用现有 terminal panel 创建逻辑，而不是手工向当前 terminal 注入 `cd` 命令。

推荐行为：

- dispatch `terminal.create`
- 带上 `cwdPath`
- 成功后沿用现有 terminal panel 行为：
  - 新 terminal 立即出现在列表中
  - 新 terminal 成为活动 terminal

路径映射规则：

- 若命中项是文件：
  - `cwdPath = dirname(node.path)`
  - 根目录文件则回到 `"."` 或省略 `cwdPath`
- 若命中项是目录：
  - `cwdPath = node.path`

### 8. Selection and Refresh Behavior

#### 8.1 Selection

- 文件树域内需要新增一个轻量的“上下文目标 / 选中节点”状态，不能只依赖 `activeFilePath`。
- 桌面右键前先更新该“上下文目标”状态，再打开菜单。
- 文件右键后：
  - 当前活动文件切换到该文件
  - “上下文目标”同步为该文件
- 文件夹右键后：
  - 不改变展开状态
  - 只更新“上下文目标”高亮，不写入 `activeFilePath`
- 搜索结果行右键同样先选中当前文件。

建议：

- `activeFilePath` 继续表示“当前打开 / 当前活动文件”
- 新增 feature-local 的 `contextTargetPath` 或等价状态，表示文件树当前高亮目标

这样可以同时满足：

- 文件仍然沿用已有 editor 激活模型
- 目录可以拥有独立的右键高亮态
- 移动端长按目录时也能复用同一状态模型

#### 8.2 Refresh

`rename / delete / create` 成功后沿用当前 [`use-file-actions.ts`](../../../packages/web/src/features/workspace/actions/use-file-actions.ts) 的刷新策略：

- 调用 `loadFileTree()`
- 依赖 `fs.dirty` 事件与现有 stale 机制保持一致性

附加要求：

- `rename` 成功后，如果被重命名的是当前 active file，则需要把 `activeFilePath` 更新为新路径。
- 如果该文件已经在 `openFilesAtomFamily` 中，也需要同步把 key 从旧路径迁到新路径，避免打开标签断链。

### 9. Inline Row Actions

为了更贴近 VS Code Explorer 的主菜单交互，本次收口行尾快捷操作：

#### 9.1 Desktop

- 文件行：
  - 移除删除按钮
- 文件夹行：
  - 保留 `新建文件`
  - 保留 `新建文件夹`
  - 移除删除按钮

这些快捷操作继续保持 hover / selected 时可见。

#### 9.2 Mobile

- 移除所有树节点行尾操作
- 顶部 tab actions 保留：
  - `新建文件`
  - `新建文件夹`
  - `全部折叠`

移动端节点级操作统一收口到长按菜单。

### 10. Accessibility

桌面端右键菜单至少满足：

- `role="menu"`
- 菜单项 `role="menuitem"`
- `Escape` 可关闭
- 键盘上下键可在菜单项间移动
- 右键菜单关闭后焦点回到触发来源项或其可聚焦容器

移动端 action sheet 继续沿用现有 sheet 无障碍能力。

重命名 / 删除 / 创建弹窗继续使用现有 `Modal` / `ConfirmDialog` 语义，不额外引入自定义弹层系统。

### 11. Error Handling

#### 11.1 Rename

前端直接拦截：

- 空名称
- 全空白名称
- 含路径分隔符名称

服务端错误包括但不限于：

- 源不存在
- 目标已存在
- 非法路径

这些错误在 rename modal 内联展示，不使用 toast 代替表单反馈。

#### 11.2 Clipboard Copy

策略：

1. 优先 `navigator.clipboard.writeText`
2. 如需要，沿用项目现有 clipboard failure fallback 思路
3. 仍失败则弹 error toast

成功反馈：

- 桌面端默认不弹 success toast，降低打扰
- 若移动端实测缺少可见反馈，可补轻量 success toast，但不作为首版硬要求

#### 11.3 Open in Terminal

- `terminal.create` 失败时弹 error toast
- 成功时不额外弹 success toast

### 12. Testing Strategy

#### 12.1 Server

在 [`packages/server/src/__tests__/file-commands.test.ts`](../../../packages/server/src/__tests__/file-commands.test.ts) 补充：

- `file.rename` 成功重命名文件
- `file.rename` 成功重命名目录
- `file.rename` 目标已存在时报错
- `file.rename` 越界路径被拒绝
- `file.rename` 成功后发出 `fs.dirty`

在 terminal command tests 中补充：

- `terminal.create` 传 `cwdPath` 时使用目标子目录
- `terminal.create` 缺省 `cwdPath` 时仍回退到 workspace 根目录
- `terminal.create` 对非法 `cwdPath` 返回错误

#### 12.2 Web

在 [`packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`](../../../packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx) 补充：

- 右键文件节点时阻止浏览器原生菜单并打开自定义菜单
- 右键目录节点时菜单含创建项
- 右键前会先切换选中项
- 搜索结果行右键可打开同一套菜单
- 点击菜单 `重命名` 可打开 rename modal
- 提交 rename modal 会 dispatch `file.rename`
- rename 成功后更新 active file path
- 点击菜单 `复制相对路径`
- 点击菜单 `复制绝对路径`
- 点击菜单 `在终端中打开` 会 dispatch `terminal.create` 且 `cwdPath` 正确
- 桌面文件行不再显示删除按钮
- 桌面目录行只保留两个创建快捷操作
- 移动端树节点不再显示行尾操作
- 移动端长按触发 action sheet，普通点击不触发

如有需要，可在独立 hook 测试中补：

- 长按计时被 pointer cancel / move 清除
- 桌面坐标菜单关闭逻辑

### 13. Risks and Mitigations

#### Risk 1: 右键菜单实现与现有共享原语脱节

Mitigation:

- 不修改 `ActionMenu` 的公开模型
- 文件树上下文菜单只在 feature layer 内实现
- 视觉与键盘语义尽量贴近共享菜单

#### Risk 2: Rename 导致当前打开文件状态错乱

Mitigation:

- 成功后同步更新：
  - `activeFilePath`
  - `openFilesAtomFamily`
- 统一通过 `use-file-actions.ts` 收口更新逻辑

#### Risk 3: 长按与滚动冲突

Mitigation:

- 设置明确长按阈值
- 在 pointer move / cancel / scroll 时取消长按
- 不在顶层 sheet 容器做全局长按监听，只绑定到文件项

#### Risk 4: 终端打开路径校验放在前端导致漏洞

Mitigation:

- `cwdPath` 只传相对路径
- 服务端统一 `resolveSafe`

## Architecture

```text
Desktop tree row/search row
  -> onContextMenu
  -> select target item
  -> use-file-tree-context-menu.openAt(x, y, node)
  -> shared context action builder
  -> FileContextMenu (desktop anchored menu)
  -> action callback
     -> create modal | rename modal | delete confirm
     -> clipboard write
     -> dispatch("terminal.create", { cwdPath })

Mobile tree row
  -> long press (450ms)
  -> use-file-tree-context-menu.openSheet(node)
  -> shared context action builder
  -> FileContextMenu (mobile sheet)
  -> same callbacks

Rename modal submit
  -> dispatch("file.rename", { fromPath, toPath })
  -> fs.dirty
  -> reload tree + update active/open file state
```

## Implementation Outline

1. 在 server 增加 `renameEntry()` 与 `file.rename` 命令。
2. 扩展 `terminal.create` 支持 `cwdPath`。
3. 在 web 增加共享文件上下文动作 hook。
4. 在 web 增加文件右键 / 长按菜单组件。
5. 在 `use-file-actions.ts` 增加 rename state 与 rename submit。
6. 在 `file-tree-panel.tsx` 接入：
   - 树节点右键
   - 搜索结果行右键
   - 移动端长按
   - rename modal
7. 收口行尾快捷操作。
8. 补 server / web 测试。

## Open Questions Resolved

- `重命名` 是否做？
  - 做，属于正式范围。
- `重命名` 是否支持跨目录移动？
  - 不支持，首版只做同目录改名。
- `重命名` 是否 inline？
  - 不做，首版使用 modal。
- `在终端中打开` 是否复用当前 terminal？
  - 不复用，默认新开一个 terminal tab。
- 是否覆盖移动端？
  - 覆盖，使用长按 action sheet。
