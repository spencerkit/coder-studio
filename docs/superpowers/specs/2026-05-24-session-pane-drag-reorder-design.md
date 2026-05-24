# Session Pane Drag Reorder Design

Date: 2026-05-24
Status: Draft
Owner: codex

## Problem

当前 workspace 里的 session pane 支持 split、close、replace 和持久化布局，但不支持直接拖拽 pane 改变位置。用户如果想把一个 session 挪到另一块区域，只能先关闭、再重建 split，或者新建 pane 后手动重排。这对多 session 并行工作的场景很笨重。

现有实现已经具备这项能力所需的大部分基础：

- `PaneNode` 已经是明确的 split tree，`leaf` 代表 pane，`split` 代表布局关系。
- pane 结构已经通过 `workspace.uiState.paneLayout` 做服务端持久化。
- split ratio 已经是本地状态，不需要为这次变更引入多端同步。
- `pane-layout-tree.ts` 已经负责 split、close、remove、collapse 等树变换。

缺的是一条桌面端的拖拽交互链路：用户能抓住一个 session pane，把它拖到另一个 pane 的左、右、上、下或中间，并让 pane tree 稳定地重排。

## Goals

- 桌面端支持拖拽 session pane 改变布局位置。
- 支持五个 drop 语义：
  - `left`
  - `right`
  - `top`
  - `bottom`
  - `center`
- 拖到 `left/right/top/bottom` 时，把 source pane 插入到 target pane 对应方向。
- 拖到 `center` 时：
  - target 为 session pane：交换两个 pane 的 session 内容
  - target 为 draft pane：把 session 移动到这个空槽位
- 所有布局变更继续复用现有 `paneLayout` 持久化链路。
- 保持现有二叉 split tree 模型，不引入自由布局或多叉容器。

## Non-Goals

- 不覆盖移动端。
- 不支持跨 workspace 拖拽。
- 不支持多选拖拽。
- 不支持 touch drag。
- 不引入拖拽中实时改树预览；只显示 hover feedback，drop 后再提交布局。
- 不做实时多客户端协同拖拽。
- 不做完整键盘拖拽可访问性模型。
- 不允许 draft pane 作为拖拽源。
- 不允许对 draft pane 使用边缘插入；draft pane 只接受 `center` drop。

## Desired User Behavior

### Drag Source

- 只有带真实 `sessionId` 的 pane 可拖拽。
- 拖拽必须从 `SessionCard` header 内一个显式 drag handle 开始。
- terminal 区域、整个 pane body、draft pane 均不能作为 drag start 区域。

### Drop Target

- session pane 可作为五向 drop target：`left/right/top/bottom/center`
- draft pane 可作为单向 drop target：`center`

### Drop Semantics

#### 1. Drop Center On Session Pane

不新建 split，仅交换两个 leaf 上承载的 `sessionId`。

- `paneId` 保持不变
- `sessionId` 互换
- 任何 split 结构和 ratio 都不改变

#### 2. Drop Center On Draft Pane

把 source session 移入 target draft leaf：

- target draft leaf 获得 source 的 `sessionId`
- source 原 leaf 被移除
- source 原路径上的单子节点 split 继续按现有规则 collapse

#### 3. Drop Left / Right / Top / Bottom On Session Pane

采用“包裹目标 leaf”的插入规则：

1. 先把 source leaf 从旧位置移除
2. 旧树若出现只剩一个 child 的 split，则沿用现有 collapse 规则
3. 在 target leaf 原位置创建一个新的二叉 split
4. 按 drop 方向决定 child 顺序：
   - `left` => `split(horizontal, [source, target])`
   - `right` => `split(horizontal, [target, source])`
   - `top` => `split(vertical, [source, target])`
   - `bottom` => `split(vertical, [target, source])`

#### 4. Invalid Drops

以下情况直接 no-op：

- source 拖到自己
- target 不存在
- drop 区域无效
- source 已在 target draft center 的等价位置
- 会导致无结构变化的重复提交

## Architecture

本次设计继续沿用现有 `agent-panes` 的分层：

1. 视图层：负责 drag handle、hover overlay、drop surface
2. 控制层：负责当前拖拽状态与 drop intent 决策
3. 树操作层：负责纯函数变换 `PaneNode`

### View Layer

主要文件：

- `packages/web/src/features/agent-panes/index.tsx`
- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`

职责：

- 为 session pane 暴露 drag handle
- 为 leaf pane 暴露 drop surface
- 根据 controller 的 hover state 绘制五向或单向 overlay
- 不直接改 pane tree

### Controller Layer

新增一个 workspace-scoped drag controller hook，例如：

- `packages/web/src/features/agent-panes/actions/use-pane-drag-controller.ts`

职责：

- 维护拖拽过程中的瞬时 UI 状态
- 记录 source 与 hover target
- 根据 pointer 位置计算 drop placement
- 在 `pointerup` 时生成最终 `dropIntent`
- 调用 `usePaneActions` 暴露的新 mutation

推荐状态：

```ts
interface PaneDragState {
  isDragging: boolean;
  sourcePaneId: string | null;
  sourceSessionId: string | null;
  hoverTargetPaneId: string | null;
  hoverPlacement: "left" | "right" | "top" | "bottom" | "center" | null;
}
```

### Tree Mutation Layer

主要文件：

- `packages/web/src/features/agent-panes/pane-layout-tree.ts`
- `packages/web/src/features/agent-panes/actions/use-pane-actions.ts`

职责：

- 对 `PaneNode` 做纯函数变换
- 返回新的 pane tree
- 继续通过 `applyLayout()` 写入 jotai + `persistUiState({ paneLayout })`

## Tree Identity Rules

拖拽逻辑内部一律以 `paneId` 定位 leaf，不以 `sessionId` 定位位置。

原因：

- draft pane 没有 `sessionId`
- 移动和交换后 `sessionId` 会变化
- `paneId` 更适合作为“位置身份”
- `center swap` 语义更适合交换 `sessionId`，而不是交换节点身份

结论：

- `paneId` 表示布局中的位置
- `sessionId` 表示这个位置当前承载的 session 内容

## Tree Mutation Rules

### Recommended Pure Helpers

建议在 `pane-layout-tree.ts` 中新增以下纯函数：

- `extractLeafByPaneId(node, paneId)`
- `swapPaneSessionsByPaneId(node, sourcePaneId, targetPaneId)`
- `moveSessionToDraftPane(node, sourcePaneId, targetPaneId)`
- `insertPaneAtEdge(node, sourcePaneId, targetPaneId, placement)`
- `wrapLeafWithSplit(node, targetPaneId, direction, order, incomingSessionId)`

这些函数的输入输出只处理 `PaneNode`，不接触 DOM 或 React state。

### Source Extraction

`extractLeafByPaneId()` 负责：

- 找到 source leaf
- 返回一个去掉 source 的新 tree
- 如果某个 split 删除 child 后只剩一个 child，则 collapse 为该 child
- 如果整棵树被删空，则返回一个空 root leaf

### Center Swap

`swapPaneSessionsByPaneId()` 只交换两个 leaf 的 `sessionId`：

- 不交换 `paneId`
- 不改 child 顺序
- 不新建 split
- 不影响 ratio

### Move To Draft Center

`moveSessionToDraftPane()` 分两步：

1. 从 source 位置提取 session
2. 把这个 `sessionId` 填入 target draft leaf

效果：

- target draft 变成 session pane
- source 原位置被移除并触发必要 collapse

### Edge Insert

`insertPaneAtEdge()` 分三步：

1. `extractLeafByPaneId(sourcePaneId)`
2. 用 `targetPaneId` 在新树里重新定位 target leaf
3. 调用 `wrapLeafWithSplit()` 生成新的二叉 split

新 split 的方向和 child 顺序：

- `left` => `direction = "horizontal"`, children = `[source, target]`
- `right` => `direction = "horizontal"`, children = `[target, source]`
- `top` => `direction = "vertical"`, children = `[source, target]`
- `bottom` => `direction = "vertical"`, children = `[target, source]`

### Draft Edge Drops

V1 明确不支持 draft pane 的边缘插入：

- draft pane 只接受 `center`
- 这样避免“空槽位再包一层 split”的交互歧义
- 同时减少 helper 分叉和 hover UI 复杂度

## Split IDs And Ratios

### Existing Rule

- pane 结构持久化到服务端
- split ratio 通过 `readPaneRatio()` / `writePaneRatio()` 保存在本地

### New Rule

#### Center Swap

- 不新建 split
- ratio 全部保留

#### Move To Draft Center

- 不新建 split
- ratio 只会因 source 原路径上的 split 被 collapse 而自然消失

#### Edge Insert

- 创建新的 `splitId`
- 新 split 默认 `ratio = 0.5`

### No Ratio Inheritance

V1 不尝试继承 source 旧 split 的 ratio。

原因：

- source 旧空间关系已经失效
- 强行继承比例会让新布局结果难以预测
- 默认 `0.5` 更稳定，也符合现有 split 初始行为

### Local Ratio Cleanup

V1 不主动清理 localStorage 中失效的旧 split ratio key。

原因：

- 这些 key 变成无引用数据后不会影响渲染
- 清理逻辑可以独立作为后续维护项
- 当前阶段应优先降低拖拽功能的实现复杂度

## Interaction Model

### Drag Handle

`SessionCard` header 增加一个显式 drag handle：

- 仅 handle 响应 `pointerdown`
- split / close 等按钮维持原有点击职责
- 不从 terminal 区域开启拖拽

### Global Dragging State

开始拖拽后给 `document.body` 添加全局 class，例如：

- `is-dragging-pane`

用途：

- 统一 cursor
- `user-select: none`
- 控制 overlay、hover 和交互禁用样式

### Drag Preview

V1 使用自绘轻量浮层，而不是浏览器原生 drag image。

预览内容只需包含：

- session title
- provider
- state dot / badge

不渲染真实 terminal 内容。

### Hit Testing

drop target 只挂在 leaf pane 上，不挂在 split container 上。

对 session pane：

- 读取 target pane 的 `DOMRect`
- 切成五块：
  - left strip
  - right strip
  - top strip
  - bottom strip
  - center rect

边缘带宽建议：

- 默认取 pane 宽/高的 `22%`
- 最小 `48px`
- 最大 `96px`

命中优先级：

1. 先判定四边
2. 四边都不命中时落到 center

对 draft pane：

- 整块 pane 都视为 `center` target
- 不显示四边命中区

### Hover Feedback

session pane hover 时显示五向 overlay：

- 当前命中的方向高亮
- 其它方向可弱提示或不显示

draft pane hover 时：

- 整块 center 高亮
- 可显示轻量文案，例如 `Move here`

### Invalid Target Handling

以下 target 不显示可 drop 样式：

- source pane 自己
- 被判断为 no-op 的无效投放点
- controller 无法解析 placement 的区域

## Event Handling Rules

### Start

- drag handle 上的 `pointerdown` 必须 `stopPropagation()`
- 避免触发 session card 当前已有的 focus / active click 逻辑

### During Drag

- 浮层预览必须 `pointer-events: none`
- hover 命中计算不依赖 `event.target`
- 命中统一通过 pane ref map + pointer 坐标计算

这样可以避免以下干扰：

- overlay 自己挡住事件
- terminal 内部子元素影响命中
- header / badge / button 嵌套结构影响 target 判断

### End

- `pointerup` 时由 controller 生成 `dropIntent`
- 仅当 `dropIntent` 有效时调用 pane action
- 无效 intent 直接清空 drag state

## Persistence

拖拽完成后的布局变更继续走现有持久化链路：

- `setPaneLayout(next)`
- `persistUiState({ paneLayout: next })`

不新增后端接口，不修改 workspace 数据结构。

## Recommended Pane Actions

在 `use-pane-actions.ts` 中新增面向拖拽的 mutation，例如：

- `swapPaneSessions(sourcePaneId, targetPaneId)`
- `moveSessionToDraftPane(sourcePaneId, targetPaneId)`
- `insertPaneAtEdge(sourcePaneId, targetPaneId, placement)`

这些 action 继续复用现有 `applyLayout()`。

## Testing

### Tree Unit Tests

重点覆盖 `pane-layout-tree.ts` 的纯函数：

1. `center` 交换两个 session pane，只互换 `sessionId`
2. source 移动到 draft center
3. `left/right/top/bottom` 插入后创建新 split
4. source 移除后旧父 split 正确 collapse
5. 拖到自己 no-op
6. target 不存在 no-op
7. draft pane 只接受 center 的数据层约束

### Component Tests

重点覆盖视图与 controller：

1. 只有 header handle 能触发 drag start
2. session pane 会根据 pointer 位置算出正确 placement
3. draft pane 只返回 `center`
4. 有效 drop 会调用正确的 pane action
5. 无效 target 不触发 mutation

### E2E

V1 至少覆盖两条高价值路径：

1. 两个 session pane 互换位置
2. 一个 session pane 移动到 draft pane

## Rollout Plan

建议按以下顺序实现：

1. 先新增 tree helpers 和单测
2. 再扩展 `usePaneActions`
3. 再接入 `SessionCard` drag handle、controller 和 overlay
4. 最后补组件测试和最小 e2e

## Risks

- 命中区如果抖动，会让 hover feedback 和 drop 结果不稳定
- terminal 区域若被错误纳入 drag start，会破坏文本选择和输入体验
- source 抽取后再定位 target 的逻辑如果不严格依赖 `paneId`，容易产生错误重排
- 新增 overlay 如果参与命中，会污染 target 判断

## Open Questions

无。v1 的交互语义、draft pane 规则、数据边界和桌面端范围都已确认。
