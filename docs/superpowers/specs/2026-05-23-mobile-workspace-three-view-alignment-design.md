# 移动端资源管理面板三视图对齐 PC 设计文档

> Status: Draft
> Date: 2026-05-23
> Scope: `packages/web/src/features/workspace/views/mobile/*`, `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`, `packages/web/src/features/workspace/views/shared/search-panel.tsx`, related styles and tests

## Goal

把移动端资源管理面板从当前的 `Files / Git` 双视图，升级为与 PC 信息架构对齐的三视图：

- `资源管理器`
- `搜索`
- `Git`

同时保留当前移动端已经在用的 segmented tab 切换手感，不引入桌面 Activity Bar。

本轮还需要补齐两个移动端缺口：

- `资源管理器` 内补上 `打开的编辑器`
- 把原文件树里的文件名搜索明确改名为 `快速跳转`

## User-Confirmed Requirements

本轮已和用户确认以下约束：

- 移动端采用三视图，而不是继续停留在 `Files / Git` 双视图
- 顶部切换仍保留当前 tab 效果，不改成交互完全不同的新控件
- `搜索` 语义与 PC 一致，负责文件内容搜索
- `快速跳转` 只负责按文件名或路径打开文件
- 用户口中的“最近打开”本轮按 `打开的编辑器` 处理，不新增独立 recent-history 数据模型
- 顶部 tab 不再使用纯文本标题，改为与 PC 一致的 icon 语义

## Non-Goals

本轮不包含：

- 把移动端改造成桌面那种 Activity Bar + Sidebar 双列布局
- 给移动端引入桌面 `Ctrl/Cmd+P` 式全局 overlay
- 引入真正的最近访问文件时序记录
- 改动文件详情页、diff 详情页、终端页的导航结构
- 修改 Git 核心业务逻辑

## Problem

当前移动端资源管理面板与 PC 存在三类不一致：

1. 信息架构不一致
   - PC 已经拆成 `Explorer / Search / Source Control`
   - Mobile 仍然只有 `Files / Git`

2. 资源管理器职责混杂
   - 当前文件树自带的搜索其实是文件名/路径跳转
   - 这个能力在语义上更接近 Quick Open，而不是 Search

3. 关键导航块缺失
   - 移动端没有 `打开的编辑器`
   - 移动端没有独立的内容搜索视图

结果就是移动端用户只能在一个过载的文件页里完成多种不同任务，且术语已经和 PC 脱节。

## Approaches Considered

### Approach A: 继续保留 `Files / Git`，只在 `Files` 里补几个区块

优点：

- 改动最小
- 视觉风险最低

缺点：

- 搜索职责仍然不清晰
- 无法真正与 PC 的 `Explorer / Search / Source Control` 模型对齐
- 未来继续演进时还会把 `Files` 变成杂糅容器

### Approach B: 移动端改成三视图，但保留现有 segmented tab 交互

优点：

- 与用户要求最一致
- 与 PC 的 mental model 对齐
- 不需要把移动端硬套成桌面双列布局

缺点：

- 需要改动 mobile sheet 的状态模型和测试
- 需要把原文件树内的搜索逻辑拆出来重新归位

### Approach C: 把 `搜索` 和 `快速跳转` 都做成 overlay，tab 里只保留文件树和 Git

优点：

- 视觉最轻
- 接近桌面 Quick Open 的单独入口思路

缺点：

- 移动端 discoverability 更差
- 不符合用户这轮明确要补齐“面板内容”的预期
- 交互路径会变长

## Decision

采用 **Approach B**。

具体定义：

- 顶部 segmented tab 从两项改成三项
- tab 仍保留当前移动端激活态和切换体验
- tab 内容改为 `资源管理器 / 搜索 / Git`
- tab 展示改为 icon-only，图标与 PC `WorkspaceActivityBar` 保持同语义

## Information Architecture

### Top-Level Tabs

移动端资源管理面板顶层改为：

- `资源管理器`
- `搜索`
- `Git`

显示方式：

- 使用和当前移动端一致的 segmented tab 容器
- 每个 tab 中心显示 icon，而不是文字
- 仍保留无障碍名称，`aria-label` 使用对应文案
- 激活态继续保留当前 underline/active treatment，不引入新的视觉模式

图标映射与 PC 对齐：

- `资源管理器` -> `FolderTree`
- `搜索` -> `Search`
- `Git` -> `GitBranch`

### Detail Route

移动端文件详情态保持不变：

- 当 route 是 `detail` 时，继续直接进入编辑器 / diff 内容面
- 顶层三视图只作用于 root 态资源管理面板

## View Design

## 1. 资源管理器

`资源管理器` 是移动端对齐 PC Explorer 的主入口。

### Structure

自上而下包含三个区块：

1. `打开的编辑器`
2. `快速跳转`
3. `工作区`

### 1.1 打开的编辑器

用途：

- 展示当前工作区已打开文件
- 作为移动端“最近打开”误称的实际落点

行为：

- 点击条目直接打开对应文件
- 当前激活文件高亮
- 首版不加关闭按钮
- 首版不加额外拖拽和排序能力

数据策略：

- 复用现有 `openFilesAtomFamily(workspaceId)` 数据
- 不新增 recent 文件历史存储
- 语义与 PC 当前 `Open Editors` 一致

### 1.2 快速跳转

这是对原 `FileTreePanel` 文件搜索框的重新归类。

语义：

- 只负责按文件名或路径进行跳转
- 不负责内容搜索

文案调整：

- 区块标题改为 `快速跳转`
- 输入 placeholder 改为 `输入文件名或路径`
- 原先 `搜索文件` 的误导性文案不再保留

交互：

- 输入后调用现有 `file.search`
- 结果列表展示匹配文件
- 点击结果直接打开文件
- 结果属于独立区块，不再占据整个文件树主体

这意味着：

- 文件树区域本身不再承载“我正在搜索文件”的语义
- `快速跳转` 和 `工作区树` 变成两个平级但职责不同的块

### 1.3 工作区

继续承载文件树浏览能力：

- 展开/收起目录
- lazy load 子目录
- 新建/重命名/删除/上下文菜单
- 移动端长按菜单行为保持现状

调整点：

- 文件树自身不再显示原来的搜索输入
- `FileTreePanel` 在移动端 Explorer 模式下以 `showSearch={false}` 运行

## 2. 搜索

`搜索` 独立成第二个 tab，语义与 PC Search 对齐。

### Responsibility

- 搜索当前工作区内的文件内容
- 不承担文件名跳转

### Behavior

- 复用现有 `file.searchContent`
- 输入框 placeholder 与 PC 一致，表达“搜索文件内容”
- 按文件分组展示结果
- 每个匹配项展示行号与 snippet
- 点击匹配项打开文件并跳到对应位置
- 切换文件后仍保留搜索面板上下文

### Mobile Presentation

移动端应复用现有 `SearchPanel` 的结果语义，但收敛为适合 sheet 的形态：

- 不重复渲染桌面侧栏式 panel header
- 使用更贴近移动 sheet 的内边距和滚动容器
- 保持紧凑、文本优先、无大卡片感

## 3. Git

`Git` 作为第三个 tab 保留现有 Git 功能。

范围：

- 继续复用现有 `GitPanel`
- 不新增 Git 业务功能
- 仅调整它在移动端 root 态中的位置和切换入口

顶层变化仅是：

- 从原先的 `Files / Git` 双 tab，变成三 tab 的第三项
- 图标语义与 PC 对齐

## Header Actions

顶部右侧操作区只在 `资源管理器` tab 显示：

- 新建文件
- 新建文件夹
- 折叠全部

在 `搜索` 和 `Git` tab 下：

- 不显示这组三个文件操作
- 避免把文件树动作错误地延续到非 Explorer 语义里

## Visual Direction

本轮沿用已确认的移动端扁平化方向，并增加三视图约束：

- 顶部仍然是 segmented tab，不改模式
- tab 内由文本切换为 icon-only
- 图标对齐 PC，但外层视觉仍是移动端当前的 flat segmented 样式
- Explorer / Search / Git 三个视图共享同一块 content panel 语言

不采用桌面 Activity Bar 的原因：

- 移动端横向空间有限
- 当前 sheet 结构更适合顶部切换
- 用户明确要求保留当前 tab 效果

## Component Boundaries

推荐按以下边界落实现有代码：

### `mobile-files-sheet.tsx`

负责：

- 顶层三 tab 的切换
- detail/root 两种 route 分流
- header actions 的按 tab 条件渲染

建议：

- `activeTab` 从 `"files" | "git"` 升级为三态 view
- 名称建议对齐桌面：`"explorer" | "search" | "source-control"`

### 新增移动端 Explorer 内容组件

建议新增一个专门的移动端 Explorer 容器，例如：

- `mobile-explorer-panel.tsx`

负责：

- 组合 `打开的编辑器`
- 组合 `快速跳转`
- 渲染 `FileTreePanel(showSearch={false})`

### 打开的编辑器抽取

桌面 `ExplorerPanel` 和移动端 Explorer 都需要相同的 `Open Editors` 列表语义。

建议抽出共享展示组件，例如：

- `open-editors-section.tsx`

这样可以：

- 避免桌面和移动端重复维护列表渲染逻辑
- 保持标题、激活态和点击行为一致

### 快速跳转抽取

原 `FileTreePanel` 内的文件名搜索逻辑建议抽成独立块，而不是继续留在树组件内部。

建议：

- 抽出共享 hook 或小组件来承接 `file.search`
- 移动端 Explorer 内以内联 section 形式使用

这样做的好处是：

- 语义上不再把“跳转”伪装成“树搜索”
- 未来如果桌面 Quick Open 和移动端快速跳转要共用查询逻辑，也更容易收敛

### `search-panel.tsx`

建议支持移动端复用，例如：

- `variant?: "desktop" | "mobile"`
- 或 `showHeader?: boolean`

目标是：

- 保留结果语义和状态处理
- 去掉桌面侧栏特有的 header chrome

## State Model

移动端当前 `mobileFilesTab` 需要升级为三态。

推荐：

- `mobileWorkspaceView = "explorer" | "search" | "source-control"`

状态约束：

- root 态保留当前 tab view
- detail 态不改变当前 root view，只是临时进入详情
- 关闭详情返回 root 时，回到之前所在 tab

## Testing Impact

至少需要覆盖以下测试面：

1. `MobileFilesSheet`
   - 三个 tab 是否存在
   - tab 是否改为 icon 驱动且保留无障碍名称
   - 仅 Explorer tab 显示文件操作按钮
   - 切到 Search / Git 时不显示 Explorer actions

2. 移动端 Explorer
   - 渲染 `打开的编辑器`
   - 渲染 `快速跳转`
   - 文件树在该模式下不再自带旧搜索框

3. 移动端 Search
   - 搜索输入调用 `file.searchContent`
   - 结果分组与跳转行为延续 PC 语义

4. 共享组件回归
   - Desktop Explorer 不被这次抽取破坏
   - `FileTreePanel(showSearch={false})` 的无搜索模式继续工作

5. 样式测试
   - 新 tab icon 样式
   - Explorer/Search/Git 内容容器一致性
   - 移动端 segmented tab 激活态未回退

## Risks

### 风险 1：`快速跳转` 与 `工作区树` 关系不清

应对：

- 在结构上把它明确成独立 section
- 用标题和 placeholder 强化“跳转”语义

### 风险 2：移动端 SearchPanel 直接复用桌面样式会显得过重

应对：

- 复用逻辑，不强行复用完整外壳
- 通过 `variant` 或 `showHeader` 降低桌面壳层感

### 风险 3：顶部 icon-only tab 可理解性下降

应对：

- 使用与 PC 一致的三枚图标，降低学习成本
- 保留 tooltip 或 aria-label
- 激活态保持明确，不只靠颜色变化

## Summary

本轮推荐方案是：

- 移动端资源管理面板采用 `资源管理器 / 搜索 / Git` 三视图
- 顶部切换继续保留现有 segmented tab 效果
- tab 从文本切换为与 PC 对齐的 icon-only 语义
- `资源管理器` 内补齐 `打开的编辑器` 和 `快速跳转`
- `搜索` 独立成内容搜索视图
- `Git` 维持现有能力，仅作为第三个顶层视图归位

这是当前最稳妥、也最符合用户目标的移动端对齐方案。
