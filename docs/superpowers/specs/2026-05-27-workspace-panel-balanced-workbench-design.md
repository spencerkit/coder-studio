# Workspace Panel Balanced Workbench 统一设计

> Status: Draft for review
> Date: 2026-05-27
> Scope: `packages/web/src/features/workspace/views/shared/*`, `packages/web/src/features/workspace/views/mobile/*`, `packages/web/src/styles/components.css`, related view tests and theme tests

## 目标

统一 workspace 中 `Explorer`、`Search`、`Source Control / Git` 在桌面端和移动端的 panel grammar，让三块侧栏真正像同一套专业编辑器 workbench，而不是三个独立产品。

本轮目标：

- 保留现有桌面端 `Activity Bar + Sidebar View` 信息架构
- 保留移动端 `Explorer / Search / Source Control` 三视图切换模型
- 统一三块面板的 section header、row、input、action、selected state、密度和分隔语法
- 让整体气质收敛到 `flush / 紧凑 / 硬朗 / 高扫描效率`
- 在不减功能的前提下完成视觉统一，尤其不能弱化 `Search` 的现有搜索结果能力

本轮不做：

- 不增加新的 Git 工作流能力
- 不重做桌面和移动端的信息架构
- 不引入新的页面私有主题系统
- 不为了“统一”而删除现有有效能力

## 设计结论

采用 `Balanced Workbench` 重做方向，但不是继续走“section 外框卡片化”的路线，而是收敛为：

- `panel flush`
- `section 无外框`
- `无重复 panel 标题`
- `row / control 保留小圆角`
- `用分隔线、留白、header grammar 建层级`

最终的统一重点不是“每块内容外面再包一个壳”，而是让 `Explorer / Search / Git` 共用一套结构语法：

- `chevron`
- `section title`
- `count`
- `actions`
- `body`
- `selected row`

## 已确认的设计约束

用户已明确确认以下方向：

- panel 本身不要圆角
- section 不要线框式卡片分块
- panel 内不要重复出现 `资源管理器 / 搜索 / Git` 模块大标题
- 视觉上不要“一块一块”的卡片式切割
- Search 必须保留真实能力，不能在重做中被弱化

这些不是建议，而是本次实现必须遵守的约束。

## 当前问题

### 1. 三块面板仍在使用三套 grammar

- `Explorer` 更像树控件集合
- `Search` 更像独立搜索工具页
- `Git` 更像提交表单加列表

这导致用户在同一个侧栏内切换 tab 时，仍然需要重新理解不同面板的结构语气。

### 2. section 语义不统一

当前不同面板对 section 的表达不一致：

- 有的是纯标题行
- 有的是带 action 的 header
- 有的是局部组标题
- 有的是近似卡片块

折叠、收起、计数、动作的表达没有统一到一个稳定 contract。

### 3. 容器感过强，内容感过弱

上一轮视觉变化之所以“不像重做”，核心原因不是颜色或 radius 调整不够，而是 panel grammar 没有真正统一。

用户首先感知到的是：

- 层级怎么组织
- section 是否一致
- row 是否一致
- 内容是否连续

如果这些不统一，即使 token 微调了，整体观感也不会拉开。

### 4. Search 容易在“视觉统一”过程中被误伤

`Search` 的问题不是功能少，而是 mock 和视觉表达很容易把它画成“只有输入框和结果列表”。

但当前真实实现已经具备：

- 按文件分组的结果结构
- 文件组默认展开
- 文件组可展开/收起
- 行号展示
- 命中内容预览
- 命中片段高亮
- 当前选中 match 状态

这些能力必须保留。

## 真实行为基线

以下现有行为被视为本轮必须保留的功能基线。

### Explorer

保留：

- `Open Editors`
- `Workspace`
- 新建文件 / 新建目录 / 收起
- 文件树展开、打开、上下文相关操作

### Search

保留：

- 输入内容后执行文件内容搜索
- 搜索结果按文件分组
- 每个文件组默认展开
- 每个文件组可展开/收起
- 每个文件组显示文件名、完整路径、命中数量
- 每条 match 显示行号
- 每条 match 显示命中上下文预览
- 命中片段高亮
- 点击 match 打开对应位置
- 结果截断提示、错误态、空态、无结果态

### Git

保留：

- commit 输入区
- changes 列表
- worktrees 列表
- history 列表
- 行内操作按钮
- 状态色用于文件状态表达

## 核心视觉原则

## 1. Panel Flush

panel 是工作台的一部分，不是独立卡片。

要求：

- panel 容器本身不使用圆角
- panel 容器不通过圆角塑造“单独一块”的感觉
- panel 外层结构更多依赖边界线与背景层级建立

这适用于：

- desktop sidebar panel
- mobile files content panel
- Git / Search / Explorer 运行时主体

## 2. Section Without Box

section 必须存在，但不采用线框式卡片包裹。

要求：

- section 不使用明显外边框框出一个个 block
- section 之间依赖细分隔线和留白节奏组织
- section header 是结构锚点，不是卡片头
- body 与 header 构成同一连续工具面

允许：

- 使用极轻的 separator
- 在 group 内部使用局部分隔

不允许：

- 每个 section 都是独立描边块
- section 之间用大块背景差制造分裂感

## 3. No Repeated Panel Titles

当前模块已经由 activity bar 或 tab 切换表达，不需要在 panel 内再次重复显示：

- `资源管理器`
- `搜索`
- `源代码管理`

要求：

- desktop mock / runtime panel 内不重复出现模块大标题
- mobile files sheet 内也不重复出现这类模块标题
- 当前模块身份由 activity/tab 体系承担

例外：

- 文档评审页中的分栏说明标题可以保留，只用于解释稿件，不属于产品运行时 UI

## 4. Small Radius Only For Interactive Units

整体 radius 回到现有 token 约束，不新增更大的 panel 圆角语言。

推荐落点：

- row / input / small action: `2px - 4px`
- 局部较大 control: `4px - 6px`
- panel / section: `0`

状态 chip 可以继续保留胶囊型 radius，但只承担状态表达。

## 5. Shared Row Contract

`Explorer row`、`Search match row`、`Git row` 必须收敛到同一类 row contract：

- 相近的高度和密度
- 相近的 hover
- 相近的 focus
- 相近的 selected
- 相近的左右内边距节奏

明确不采用：

- 左侧强调条
- 通过 padding 偏移制造 current state

采用：

- 完整块级高亮
- 轻边框或轻 selected background
- hover、focus、selected 可共存

## 6. Section Header Contract

所有可折叠 section 与 group header 都应尽量遵循以下组织：

- `chevron`
- `title`
- `count`
- `actions`
- `body`

并满足：

- chevron 行为一致
- count 位置稳定
- actions 语义稳定
- body 不再像单独的控件区或卡片区

## 三个面板的具体设计

## Explorer

Explorer 作为整个 workspace sidebar grammar 的基准面板。

要求：

- `Open Editors` 与 `Workspace` 采用同一类 section header contract
- `Open Editors` 不应看起来像独立轻列表，而应归入共享 row 语言
- `Workspace` 的动作与 header 同构，不再像漂浮在树控件上的附属按钮
- 文件树 row 的 active / hover / selected 成为 Search 与 Git 的参考基线

目标：

- Explorer 不再像“树控件样式集合”
- 它应该成为 Search 与 Git 的共同母体

## Search

Search 必须在视觉上回到同一家，但功能上必须完整保留现有能力。

### 必须保留的行为

- 结果按文件分组
- 文件组默认展开
- 文件组支持展开/收起
- 文件组 header 展示文件名、路径、命中数
- match 展示行号
- match 展示命中预览
- 命中片段高亮
- active match 保留 selected 语义

### 视觉统一要求

- 搜索输入框与 Quick Jump / Explorer 搜索输入归入同一 control family
- 结果文件组 header 使用统一 section/group header grammar
- 文件组不是独立卡片
- 命中行不是独立“搜索结果卡片条目”
- 结果区继续是分组结构，但整体视觉上属于连续工具面

### 明确禁止

- 为了简化视觉，把结果扁平成纯 row 列表
- 去掉文件分组的折叠能力
- 去掉命中内容预览
- 去掉高亮命中片段

## Git / Source Control

Git 继续作为能力最复杂的 panel，但视觉上必须和另外两块统一。

要求：

- commit 输入区收紧为工具输入区，而不是“上面一整块表单”
- `changes / worktrees / history` 全部回到统一 section grammar
- `git row` 与 `explorer row / search row` 同类
- 行内操作按钮大小、位置、hover/focus 语义一致
- 状态色只用于状态表达，不形成额外容器装饰系统

目标：

- Git 保留复杂度，但不保留碎感

## Mobile 继承规则

移动端不是另一套设计语言，而是同一系统的触控版。

要求：

- 继续保留 Explorer / Search / Source Control 三视图切换
- panel 本体继续 flush
- section 继续无外框
- 不在移动端重新加回模块标题
- 只放大触控热区、间距和行高
- Search 的分组折叠、预览、高亮能力继续保留

明确不做：

- 移动端专用大圆角 panel
- 移动端专用卡片式 section
- 移动端专用另一套 hierarchy

## 主题与样式约束

本轮必须继续完全依赖现有 token 体系。

要求：

- surface 使用 workspace/sidebar 相关语义 token
- hover / selected / focus 使用现有 state token
- radius 使用共享 radius token
- 不直接写死 bespoke 颜色来“追视觉稿”

测试层应能捕获至少以下约束：

- panel 运行时不依赖 panel 圆角
- selected state 不再使用左侧强调条
- Search / Explorer / Git row 使用一致的 selected contract
- Search 的 group header / match row 语法仍可被测试覆盖

## 验收标准

当以下条件成立时，本轮设计视为达标：

- `Explorer / Search / Git` 切换时明显属于同一套 workbench
- panel 本体不再呈现卡片感
- section 不再是一块一块有外框的小盒子
- panel 内没有重复模块标题
- Search 现有分组折叠与命中预览能力完整保留
- Git 的 commit 区与下方列表不再像两套系统
- mobile 继承同一 grammar，而不是另一套 app 风格

## 参考稿

本设计对应的离线评审稿：

- `docs/superpowers/reviews/2026-05-27-workspace-panel-balanced-workbench.html`

