# Memory Panel Remove Selected Detail Design

> Date: 2026-06-13
> Status: Draft
> Owner: Codex

## Problem

当前工作区的 `MemoryPanel` 在同一个 side panel 中同时承载两类职责：

- 上半部分负责搜索、筛选、浏览和删除记忆条目
- 下半部分负责展示“选中记忆”详情，并允许直接编辑和保存

这和当前目标不一致。用户要求把截图中位于记忆 side panel 下方的“选中记忆”模块整个移除，只保留记忆列表和现有的新建入口。

## Goal

移除 `MemoryPanel` 中列表下方的“选中记忆 / 未选中记忆”详情模块，保证：

- 记忆 side panel 不再渲染详情编辑区
- 面板内不再显示保存按钮、详情表单和详情 footer
- 现有的搜索、类型筛选、列表浏览、新建和删除能力继续可用
- 改动保持在 `packages/web` 范围内，不扩散到 server 或 shared contract

## Non-Goals

- 不删除整个 `MemoryPanel`
- 不修改 `memory.create`、`memory.delete` 或 `memory.list` 的协议
- 不新增新的编辑入口
- 不移除“新建记忆”弹窗里的表单
- 不重构记忆数据模型、国际化结构或 side panel 外层布局

## Decision

采用最小删除方案，只移除 `MemoryPanel` 下半部分详情区和与其直接耦合的保存编辑流程。

不采用以下替代方案：

1. 同时移除列表选中态
原因：这会额外改变列表交互，不属于这次请求的最小范围。

2. 保留详情区结构但隐藏内容
原因：会留下无用 DOM、样式和状态逻辑，后续维护成本更高。

3. 顺手删除更新能力的所有底层代码
原因：当前需求只针对 side panel 展示层，过度清理会扩大影响面，并可能误伤未来其它编辑入口。

## Scope

### In Scope

- 删除 `packages/web/src/features/workspace/views/shared/memory-panel.tsx` 中详情区渲染
- 删除该组件中仅用于详情编辑区的本地状态、派生值和保存事件
- 更新 `packages/web/src/features/workspace/views/shared/memory-panel.test.tsx`，移除详情区相关断言，保留列表、新建、删除和筛选覆盖

### Out of Scope

- `packages/web/src/features/workspace/actions/use-memory-panel.ts`
- server `memory.*` commands
- locale 文案清理
- 记忆列表样式的大规模重排

## Target UI Shape

删除后，`MemoryPanel` 保留以下结构：

- 顶部标题区
- 错误提示
- 搜索框
- 类型筛选 chips
- 记忆列表
- 新建记忆弹窗
- 删除记忆确认弹窗

以下结构从 side panel 中移除：

- “Selected Memory / No memory selected” 详情区标题
- 详情区保存按钮
- 类型、标题、内容、标签编辑表单
- 来源和更新时间 footer
- 未选中状态下的详情占位文案

## Behavior After Removal

- 点击列表项仍可保留当前选中高亮
- 点击列表项不再展示下方详情编辑内容
- 新建记忆继续通过现有 modal 表单完成
- 删除记忆继续通过现有确认弹窗完成
- `memory.update` 不再从这个 side panel 触发

## Implementation Notes

- 优先直接删除详情区 JSX，而不是保留条件分支
- 删除 `selectedEntry` 详情渲染后，保留是否继续维护 `selectedId` 仅用于高亮，由实现阶段根据最小改动原则决定
- 仅在测试中保留仍然对外可见的行为断言，避免继续断言已删除的保存或详情内容

## Testing

需要通过与这次改动直接相关的前端测试，至少覆盖：

- `MemoryPanel` 仍能加载并显示记忆列表
- 搜索和类型筛选仍为本地过滤
- 新建记忆流程仍可用
- 删除记忆流程仍可用
- 不再渲染“Selected Memory”详情区和保存按钮

## Risks

- 如果只删 JSX，不删依赖详情区的测试，前端测试会失败
- 如果误删过多状态逻辑，可能影响列表选中高亮或创建后选中行为
- 如果顺手清理超出展示层范围，容易碰到已有未提交改动并引入不必要冲突

## Validation

完成实现后应满足：

- 记忆 side panel 中不再出现详情编辑区
- 新建和删除入口仍正常工作
- 列表仍可正常加载、搜索和筛选
- `packages/web/src/features/workspace/views/shared/memory-panel.test.tsx` 通过
