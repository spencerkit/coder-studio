# Mobile Supervisor Sheet Flat Redesign

Date: 2026-05-19
Status: Draft
Owner: Codex

## Problem

这次实际需要调整的是移动端 `MobileSupervisorSheet`，不是桌面 `ObjectiveDialog`。

当前移动端 Supervisor 详情页偏厚、偏重，和站内其他更扁平的移动设置页不一致：

- `Sheet` 已经自带顶部 `MobilePageHeader`，但 detail body 里又重复渲染了一块 `.mobile-supervisor-sheet__detail-header`，造成重复标题和额外垂直占位
- `.mobile-supervisor-sheet__root` / `__detail` 自身又是一层大圆角、大边框、带阴影的内卡，使 fullscreen sheet 里出现“sheet 里再套 card”的厚重感
- footer 现在是独立的厚面板，更像悬浮操作盒，而不是贴底的轻量操作条
- 用户明确要求对齐“面内平铺设置面板”，并强调“不要像现在这样占据大量的空间”

## Goals

- 将移动端 Supervisor sheet 调整为更扁平、更省空间的设置面板风格
- 删除移动端 detail 页中的重复头部信息，避免重复标题/副标题
- 保留现有共享表单逻辑、字段顺序和命令行为不变
- 保留此前已经落地的共享紧凑字号，尤其输入控件约 `12px` 的 token

## Non-Goals

- 不回滚这次已经合入的共享字号收紧改动
- 不再继续修改桌面 `ObjectiveDialog` 视觉结构
- 不改变移动端 Supervisor 的流程模型：root 视图、edit/disable detail、enable 直达 detail 仍保留
- 不重写 `SupervisorCard` 的业务行为或 action 语义

## User Decisions Captured

- 本次真正要改的是移动端，不是 PC 弹框
- 可以保留当前共享输入字号收紧
- 核心要求是扁平化、减少空间占用、对齐其他页面设计

## Approaches Considered

### Option A: 只删掉 detail 里的重复 header

优点：

- 改动最小
- 风险最低

缺点：

- root/detail 的厚卡壳仍在
- footer 仍然偏重
- 整体仍不够“面内平铺”

### Option B: 扁平化移动端设置面板（推荐）

优点：

- 直接解决重复头部、厚卡壳和 footer 过重三个主要问题
- 保留现有流程和共享表单逻辑
- 与站内移动 fullscreen sheet 的扁平风格更一致

缺点：

- 需要同时更新结构测试和样式契约测试

### Option C: 重构为单页合并流

优点：

- 空间利用最高
- 层级更少

缺点：

- 改交互结构，超出本次范围
- 回归风险更高

## Final Choice

采用 Option B。

保留移动端 `Sheet` 自带 header，删除 detail body 里的重复头部卡片。`root` 和 `detail` 改为更扁平的内容层，不再使用大边框、大圆角、阴影内卡；footer 收紧为更轻量的底部操作条。enable/edit/disable 的业务逻辑与共享表单保持不变。

## Final Design

### 1. Mobile Detail Structure

`MobileSupervisorSheet` 的 detail 页继续使用 fullscreen `Sheet`，但 body 结构调整为：

1. 可选的轻量说明行或直接无额外 intro
2. `ObjectiveDialogContent`
3. 轻量 footer actions

移除 `.mobile-supervisor-sheet__detail-header`，不再在 body 内重复渲染标题、图标和副标题。

### 2. Root And Detail Surface Treatment

`.mobile-supervisor-sheet__root` 和 `.mobile-supervisor-sheet__detail` 从“厚卡壳”改成更平的内容容器：

- 去掉外层显著边框
- 去掉大圆角顶盖效果
- 去掉阴影
- 保留必要的内边距，但从当前 `var(--sp-4)` / `var(--sp-5)` 收紧
- 通过更轻的分组间距而不是卡片壳来组织内容

目标是让 fullscreen sheet 看起来像一个直接铺开的设置页，而不是底板上再套一块悬浮卡。

### 3. Footer Treatment

`.mobile-supervisor-sheet__footer` 调整为轻量操作条：

- 收紧 padding
- 降低边框和背景存在感
- 保持双按钮布局和 44px 触控高度
- 仍保留 safe-area bottom 适配

footer 继续固定在 `Sheet` footer 区域，但不再像独立面板。

### 4. Typography And Density

沿用现有共享紧凑 token：

- 输入、下拉、时间选择器：`var(--type-label-size)`
- `Textarea`：`var(--type-code-inline-size)`
- helper 文案：`var(--type-meta-size)`

这次移动端改动重点是减少结构冗余和容器体积，而不是再次调整全局字体 token。

### 5. Root View

已启用时的 root 页继续展示 `SupervisorCard` 和两个操作按钮，但外层 `mobile-supervisor-sheet__root` 收紧为平铺内容层，避免再叠一层厚卡。`SupervisorCard` 自身保持现有结构。

### 6. Testing

需要补的保护点：

- mobile detail 页不再渲染 `.mobile-supervisor-sheet__detail-header`
- enable 直达 detail 时仍能正常提交
- edit detail 的返回与 picker 行为不回归
- 样式契约从“内卡 + 厚 footer”更新为“扁平内容层 + 轻 footer”

### 7. Files To Update

- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`
- `packages/web/src/styles/components.css`
- `packages/web/src/styles/components.theme.test.ts`

## Implementation Notes

- 继续复用 `ObjectiveDialogContent`，不拆共享表单逻辑
- 不修改 `Sheet` primitive API
- 移动端样式作用域限定在 `.mobile-supervisor-sheet*`
- 如果需要补充轻量说明文案，优先使用现有 copy，不新增文案 key
