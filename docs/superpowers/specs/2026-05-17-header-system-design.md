# Header System Design

Date: 2026-05-17
Status: Draft
Owner: Codex

## Problem

当前 `packages/web` 里 header 的问题不是单纯样式不一致，而是**语义边界没有收口**。

同一项目里已经同时存在：

- 页面级 header
- 移动端 sheet header
- 弹框 header
- 面板 / 列表 header
- 编辑器 header
- 会话卡 header

但这些 header 不是由统一体系派生出来的，而是各自按页面需要单独写样式、单独定字号、单独定高度，导致：

- 同一层级的标题在不同页面看起来不是同一系统
- 页面 header 和弹框 header 的职责混在一起
- 业务侧继续新增 `*-header` 时，样式会再次分叉
- 后续维护只能靠局部覆盖，无法形成稳定规范

现状中可见的典型例子包括：

- `packages/web/src/features/shared/components/page-header.tsx`
- `packages/web/src/features/shared/components/mobile-page-header.tsx`
- `packages/web/src/components/ui/modal/index.tsx`
- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`

## Goals

- 把 header 收敛为固定的少数几类，不再允许业务层随意新写。
- 让页面 header、面板 header、弹框 header 共享同一套设计语言，但保留职责差异。
- 统一高度、字号、字重、间距、actions 规则，减少局部覆写。
- 给现有 header 提供明确迁移目标，避免继续扩散。

## Non-Goals

- 不重做整体页面 chrome。
- 不调整正文、表单、按钮等非 header 组件的视觉体系。
- 不把所有场景强行压成一套完全相同的 header。
- 不新增新的公开 header 类型。

## User Decisions Captured

- 接受 `PageHeader` 的 `primary` / `secondary` 两级。
- 接受页面 header 和弹框 header 区分。
- 接受只保留固定几个组件，不允许继续单独写 header。

## Approaches Considered

### Option A: 单一万能 Header

优点：

- 表面上最统一
- 接入最快

缺点：

- 很快会长出一堆 `dense / modal / page / panel / mobile` 参数
- 组件本身会变成样式垃圾场
- 业务仍然可以通过局部参数把系统重新分叉

### Option B: 三类固定 Header（推荐）

优点：

- 语义清楚
- 视觉稳定
- 方便约束新增场景
- 兼容当前项目里已经存在的页面、面板、弹框三种主语义

缺点：

- 首次迁移需要归并现有专用 header
- 需要补一层共享骨架与规范

### Option C: 只定 token，不定组件

优点：

- 自由度高

缺点：

- 仍然会继续出现各写各的 header
- 不适合当前项目的收敛阶段

## Final Choice

采用 Option B。

公开层只保留 3 个 header 组件：

- `PageHeader`
- `PanelHeader`
- `DialogHeader`

内部可以有共享的 header shell / layout primitive，但业务层不可直接新增新的 header 组件或新的业务 header class。

## Final Design

### 1. Header Taxonomy

#### 1.1 PageHeader

用于：

- 一级页
- 二级页
- 全屏 sheet
- 需要返回上一级的详情页

语义：

- 这是导航层 header，不是内容容器 header

公开能力：

- `level="primary" | "secondary"`
- `back`
- `kicker`
- `title`
- `actions`

固定规则：

- `primary` 用于页面主标题
- `secondary` 用于详情页、设置子页、次级页面
- 只有 `PageHeader` 允许 `back`
- `actions` 最多显示 2 个显性操作，更多进入 overflow

尺寸建议：

- `primary`: desktop `56px`，title `20px/28px/600`
- `secondary`: desktop `48px`，title `16px/24px/600`
- mobile: `44px`，title `16px/24px/600`

#### 1.2 PanelHeader

用于：

- 侧栏
- 列表容器
- 卡片顶部
- 编辑器头部
- session / workspace 等局部工作区面板

语义：

- 这是内容容器 header，不承担页面导航

公开能力：

- `title`
- `meta`
- `status`
- `actions`

固定规则：

- 不允许页面级返回
- 不允许大号页面标题感
- 不允许主按钮挤在 header 内
- `actions` 以 icon-only 为主，最多 3 个显性操作

尺寸建议：

- desktop `40px`
- mobile `44px`
- title `14px/20px/600`

#### 1.3 DialogHeader

用于：

- modal
- confirm
- destructive dialog
- 阻断式弹层

语义：

- 这是弹层上下文 header

公开能力：

- `icon`
- `title`
- `description`
- `close`
- `tone="default" | "danger"`

固定规则：

- 不允许在 header 内放主操作按钮
- 主操作统一放 footer
- `danger` 只改变语义强调，不改变整套字号体系

尺寸建议：

- padding `16px 20px`
- title `16px/24px/600`
- description `13px/20px/400`

### 2. Shared Anatomy

三个 header 都应使用同一套基础骨架：

- `leading`
- `copy`
- `actions`

允许变化的是内容和有限 variant，不允许变化的是排版逻辑。

硬规则：

- 标题默认单行省略
- `actions` 永远右对齐
- header 之间只允许在固定规格内变化
- 业务侧不允许再写新的 `*-header__title`、`*-header__copy` 作为长期方案

### 3. Existing Code Mapping

建议归并如下：

- `packages/web/src/features/shared/components/page-header.tsx`
  - 保留
  - 作为 `PageHeader` 的唯一实现入口
  - 增加 `level` 支持

- `packages/web/src/features/shared/components/mobile-page-header.tsx`
  - 保留为过渡层
  - 长期应收敛回 `PageHeader`

- `packages/web/src/components/ui/modal/index.tsx`
  - 继续保留 `ModalHeader` 入口
  - 语义上归入 `DialogHeader`

- `packages/web/src/features/settings/components/settings-page.tsx`
  - 迁回 `PageHeader level="secondary"`

- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
  - 迁回 `PanelHeader`

- `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`
  - 迁回 `PanelHeader`

- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
  - `workspace-sidebar-panel__header` 迁回 `PanelHeader`

- `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`
  - 迁回 `DialogHeader`

### 4. Migration Rules

- 新增 header 前必须先判断属于 `Page / Panel / Dialog` 哪一类。
- 业务层只允许组合 slot，不允许单独调字号、行高、padding 来伪造新 header。
- 如果场景有特殊需求，只能加受控 variant，不能新造公开 header。
- 除迁移期外，不允许再新增业务私有 `*-header` 结构作为长期方案。

### 5. Acceptance Criteria

- 公开 header 组件只保留 3 类。
- 页面 header 与弹框 header 明确分层，但共享同一设计语言。
- 现有 settings / session / editor / modal 头部能映射到三类之一。
- 后续新增页面不需要再写新的 header 形态。
- header 的高度、字号、字重、actions 规则在规范里是固定的，不再由业务页面自行决定。

