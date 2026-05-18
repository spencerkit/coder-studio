# Header 设计规范

> **版本：** 1.0
> **日期：** 2026-05-18
> **状态：** Draft
> **作者：** Codex

## 0. 目标

统一当前项目的页面 header、列表/面板 header、弹框 header，收敛到固定共享 contract，禁止页面、功能模块、弹层各自再写一套标题区结构和字号规则。

本规范的核心目标只有两个：

- header 结构统一
- header 排版 token 固定，禁止自定义字号

## 1. 适用范围

本规范适用于普通业务 UI 中承担“标题区 / 顶部信息区”职责的 header：

- 一级页面 header
- 二级页面 header
- panel / 列表 / 侧栏 / 卡片上沿 header
- modal / dialog / sheet 标题区

不纳入本规范的豁免面：

- terminal / code editor / diff / review 等技术面板 header
- 纯品牌展示型 hero
- 不承担页面或容器标题职责的普通工具栏

说明：

- 名字里带 `header` 不等于必须纳入本规范。
- 是否纳入，取决于它是不是“页面或容器的标准标题区”。

## 2. 唯一允许的 Header Contract

业务 UI 只允许使用以下共享 header 入口：

### 2.1 `PageHeader`

用途：

- 一级页面
- 二级页面
- 设置页、内容页、详情页的顶部标题区

当前 contract：

- `level="primary"`：页面级主标题
- `level="secondary"`：二级页 / 常规页标题
- `onBack` / `backLabel`
- `kicker`
- `rightSlot`

排版约束：

- `PageHeader.primary` title 固定使用 `--type-section-title-*`
- `PageHeader.secondary` title 固定使用 `--type-app-title-*`
- `PageHeader` kicker 固定使用 `--type-kicker-*`
- `PageHeader` back 文案固定使用 `--type-label-*`

### 2.2 `MobilePageHeader`

用途：

- 移动端页面 header
- 全屏 mobile sheet 的标准 header

说明：

- `MobilePageHeader` 是 `PageHeader` 的移动端包装，不是另一套独立排版系统。
- 它只能调整移动端布局、间距和返回区交互密度，不能自定义 title 字号。

排版约束：

- title 固定使用 `--type-app-title-*`
- back 文案固定使用 `--type-code-inline-*`

### 2.3 `PanelHeader`

用途：

- 列表区块
- workspace panel
- 侧栏 / 卡片 / 面板上沿标题区

当前 contract：

- `title`
- `status`
- `meta`
- `actions`

排版约束：

- title 固定使用 `--type-app-title-*`
- `status` / `meta` 只能使用共享辅助文案语义，不允许局部重写 panel title 字号

### 2.4 `DialogHeader`

用途：

- modal
- dialog
- 标准弹层标题区

说明：

- `DialogHeader` 是弹层 header 的 canonical 入口。
- `ModalHeader` 仅作为兼容命名，不应继续扩展成新规范分支。

推荐结构：

- `dialog-header__leading`
- `dialog-header__icon`
- `dialog-header__copy`
- `dialog-header__description`
- `ModalTitle`

排版约束：

- `ModalTitle` / dialog title 固定使用 `--type-section-title-*`
- `dialog-header__description` 固定使用 `--type-meta-*`

## 3. 允许的差异

允许存在的差异只有以下几类：

- 高度
- padding / gap / 对齐方式
- 是否带返回
- 是否带 kicker
- 是否带 actions / meta / status
- icon 样式和状态色

这些差异必须建立在共享 contract 之上实现，不能通过重新发明一套 header DOM 来实现。

## 4. 明确禁止项

以下做法一律不允许：

- 页面自己新写 `xxx-header` DOM 结构来替代 `PageHeader`
- modal / dialog 自己拼一套标题区而不走 `DialogHeader`
- panel 自己写标题区而不走 `PanelHeader`
- 在页面包装层覆盖 `.page-header__title` / `.panel-header__title` / `.modal-title` 字号
- 在场景样式里新增 header 专属 `font-size` / `line-height` / `font-weight` override
- header 继续直接使用裸写 `px`
- header 继续直接使用旧 `--text-*` 尺度 token

一句话规则：

- 页面可以改 header 的布局，不可以改 header 的排版语义。

## 5. Token 使用规则

header 只允许消费 `--type-*` 语义排版 token，不允许直接消费基础字号 token。

当前批准映射如下：

- `PageHeader.primary` -> `--type-section-title-*`
- `PageHeader.secondary` -> `--type-app-title-*`
- `MobilePageHeader.title` -> `--type-app-title-*`
- `MobilePageHeader.back` -> `--type-code-inline-*`
- `PanelHeader.title` -> `--type-app-title-*`
- `DialogHeader.title` -> `--type-section-title-*`
- `DialogHeader.description` -> `--type-meta-*`

如果未来要调整 header 的视觉层级，只能修改这份映射和共享实现，不能在业务页面就地逃逸。

## 6. 落地原则

后续新增页面或重构旧页面时，按下面规则执行：

1. 先判断这是页面 header、panel header 还是 dialog header。
2. 直接复用共享组件。
3. 如果现有 props 不够，优先扩展共享组件 contract。
4. 只有在确认不属于标准标题区时，才允许不用这套 header contract。

评审口径：

- 看到自定义 header DOM，默认视为问题
- 看到 header 自定义字号，默认视为问题
- 看到 header 使用 `--text-*` 或裸 `px`，默认视为问题

## 7. 当前仓库结论

截至 2026-05-18，这套规范在当前代码中的主路径已经收敛为：

- `PageHeader`
- `MobilePageHeader`
- `PanelHeader`
- `DialogHeader`

同时已确认：

- settings 桌面 header 已回收为共享 `PageHeader`
- dialog description 已回收为 `dialog-header__description`
- header 主路径已与 `develop` 上新的 semantic typography token 对齐

后续如果再出现 header 自定义字号，应视为违反规范而不是可接受的局部例外。
