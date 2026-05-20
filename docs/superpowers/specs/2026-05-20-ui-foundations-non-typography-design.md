# UI Foundations Beyond Typography — Design

Date: 2026-05-20
Status: Draft
Owner: Codex

## Problem

当前 Web UI 的 typography 已经开始形成“基础 token + 语义 token + 使用边界 + guardrail”的完整体系，但排版之外的其余基础维度仍然处于三种状态并存：

- 一部分已经有基础 token，但只有数值层，没有语义层。
- 一部分已经被主题系统接管，但只接管了底色或阴影，具体交互配方仍散落在组件里。
- 一部分既没有主题语义，也没有统一约束，只是被组件和页面反复局部拼值。

当前的典型症状包括：

- 尺寸 / 密度已存在 `--btn-height-*`、`--input-height-*`、`--touch-target-*` 等 token，但缺少跨组件统一的语义层，按钮、输入框、icon button、列表行、toolbar、代码型界面 chrome 各自维护自己的尺寸语义。
- 状态色 / 交互态虽然依赖 `--accent-*`、`--color-*`、`--border-focus`、`--border-error` 等主题 token，但 focus ring、selected、disabled、status tint、diff 状态色、overlay 状态配方仍大量散落在组件 CSS 中。
- 间距 / 布局节奏虽然已有 `--sp-*` 4px 网格，但缺少 `panel padding`、`section gap`、`row inset`、`form gap`、`stack rhythm` 等语义约束。
- Surface / Overlay 已经部分依赖 `--bg-*`、`--shadow-*`、`--z-*` 和部分主题 token，但 backdrop、elevated chrome、local overlay、terminal / editor / diff 的局部浮层仍没有统一语义框架。
- 圆角已经有 `--radius-sm/md/lg/xl/full` 基础 token，但没有“哪个角色该用哪个 radius”的统一规则，更多仍是组件级自由使用。

如果继续只在组件层局部修补，这几类基础规范会一直停留在“看起来都合理，但合在一起不稳定”的状态。后续再增加主题、代码型界面、可访问性皮肤或密度差异时，复杂度会快速上升。

本次需要补齐 typography 之外的另外 5 类基础规范，并且明确它们与主题系统的关系。

## Goals

- 为以下 5 类基础维度建立统一规范：
  - 尺寸 / 密度
  - 状态色 / 交互态
  - 间距 / 布局节奏
  - Surface / Overlay
  - 圆角角色
- 让普通 UI、terminal、agent session、code editor、diff 全部纳入这套总规范。
- 允许代码型界面在总规范内维护自己的子规范和专用 token，而不是被排除在系统外。
- 明确每一类基础规范的 token 分层、使用边界、禁止项和迁移方向。
- 明确每一类规范里哪些已经纳入主题，哪些当前仍是全局 token，哪些未来必须纳入主题。
- 建立“可主题化”与“当前主题必须有差异值”之间的区分，避免把主题系统误解为“所有主题都要改所有数值”。
- 为后续代码迁移提供一致的命名和治理方向。

## Non-Goals

- 不重写 typography 规范。字体体系继续由独立 typography 设计文档负责。
- 不取消 terminal、editor 等界面的字体大小用户自定义能力。
- 不在本次设计中直接改写 `tokens.css` 或组件实现；本次先完成规范与归属定义。
- 不要求代码型界面与普通 UI 共用完全相同的细粒度 token 值。
- 不在本次设计中引入用户自定义主题编辑器。
- 不在本次设计中重做现有主题家族或新增新的官方主题。

## User Decisions Captured

- 这 5 类规范需要覆盖普通 UI，也要覆盖 `terminal / agent session / code editor / diff`。
- typography 之所以未覆盖终端和文件编辑，是因为这些区域允许用户自定义字体大小；这个例外不外推到其他基础维度。
- 主题化策略选择为“这 5 类都尽量设计成可主题化，只是有些主题先不启用差异化”。
- 代码型界面应共享同一套总规范，但允许维护子规范和专用 token。
- 当前阶段先输出规范文档，用户确认后再开始改代码。

## Approaches Considered

### Option A: 把 5 类基础规范全部并成和普通 UI 完全一致的一套细粒度 token

优点：

- 表面上最统一。
- 所有界面看起来都在用同一套命名。

缺点：

- terminal、editor、diff 在密度、局部 overlay、状态高亮、行结构等方面有明显不同需求。
- 为了适配代码型界面，最终会在统一规则中塞入大量例外，规范会迅速失真。

### Option B: 建立统一总规范，每类规范都允许代码型界面有子规范和专用 token（推荐）

优点：

- 总层仍然统一，命名、边界、主题归属可收口。
- 代码型界面可以保留自己的配方和密度策略，而不必脱离系统。
- 适合后续把普通 UI、terminal、editor、diff 都纳入同一主题框架。

缺点：

- 需要在规范层同时定义共享语义层和域子规范边界。
- 首次迁移时需要梳理哪些 token 属于总层，哪些属于子层。

### Option C: 只写高层原则，不强制形成统一 token 体系

优点：

- 文档最轻。
- 短期阻力最小。

缺点：

- 无法真正收敛现有散落的组件实现。
- 不足以支撑主题系统、代码型界面和长期设计治理。

## Final Choice

采用 Option B。

这 5 类基础规范将采用统一总规范 + 域子规范的结构：

- 所有界面都必须先对齐到统一总规范。
- terminal、agent session、code editor、diff 可以在总规范之下扩展自己的子规范和专用 token。
- 不允许继续把代码型界面当作规范之外的特殊地带。

主题系统也采用统一接管原则：

- 这 5 类规范最终都纳入主题系统。
- 但“纳入主题系统”不等于“每个主题现在都必须有不同值”。
- 允许一部分规范以“theme-capable shared default”的方式进入主题系统，即主题层有权接管，但当前多数主题先共享同值。

## Final Design

### 1. Scope

本次规范覆盖以下所有运行态界面：

- 普通 UI 页面和组件
- topbar、sidebar、settings、sheet、modal、command palette、toast、popover、local overlay
- terminal shell
- agent session 相关运行态面板
- code editor 相关运行态面板
- diff / review code 相关界面

明确说明：

- typography 继续独立治理
- terminal 和 editor 的字体大小用户偏好高于主题和统一规范
- 其他基础维度不因“代码型界面”而自动豁免

### 2. Design Principles

这 5 类规范统一遵循以下原则：

#### 2.1 三层 token 架构

每一类规范都分为三层：

1. 基础层

- 提供数值、基础配方或最底层种子
- 不直接给业务组件随意消费

2. 共享语义层

- 提供跨域统一的角色语义
- 普通 UI 和代码型界面都先消费这一层

3. 域子规范层

- 为 `ui / terminal / session / editor / diff` 提供允许的局部扩展
- 只能在共享语义层之下扩展，不允许重新发明一套平行体系

#### 2.2 主题归属与差异化是两个维度

规范中把主题项分成两类：

- `actively themed`
  - 不同主题通常会给出不同值
  - 常见于颜色、状态配方、surface、shadow

- `theme-capable shared default`
  - 已纳入主题系统管理
  - 但大多数主题当前先共享同值
  - 常见于 spacing、density、radius、部分布局上限

#### 2.3 viewport 优先保证人体工学

当主题与 viewport 同时作用于尺寸或密度时：

- touch 设备的人体工学最小值优先
- 主题可以表达“更紧凑”或“更舒展”的视觉倾向
- 但不能压低移动端最小触控目标或破坏可达性下限

#### 2.4 代码型界面共享总规范，不共享所有具体数值

- terminal、editor、diff 不要求与普通 UI 共用完全相同的细粒度值
- 但它们必须遵守相同的角色定义和主题归属方式
- 不允许继续长期存在“只在某个组件里裸写一套视觉配方”的状态

### 3. Category A: Size / Density

#### 3.1 Definition

尺寸 / 密度规范负责定义：

- 控件高度
- icon button 尺寸
- 列表行高与点击行高
- toolbar / panel header / tab chrome 的垂直密度
- overlay 内容区的密度等级
- terminal / editor / diff 的 chrome 密度和辅助行高

不负责定义：

- 字体大小
- terminal / editor 的用户字体偏好

#### 3.2 Token Layers

基础层示例：

- `--size-ctrl-28`
- `--size-ctrl-32`
- `--size-ctrl-40`
- `--size-touch-44`
- `--size-touch-48`
- `--size-touch-56`

共享语义层示例：

- `--control-height-sm`
- `--control-height-md`
- `--control-height-lg`
- `--icon-button-size-sm`
- `--icon-button-size-md`
- `--icon-button-size-lg`
- `--list-row-height-compact`
- `--list-row-height-regular`
- `--toolbar-height-compact`
- `--toolbar-height-regular`
- `--panel-header-height`
- `--touch-target-min`

域子规范层示例：

- `--terminal-tab-height`
- `--terminal-toolbar-height`
- `--session-row-height`
- `--editor-toolbar-height`
- `--editor-breadcrumb-height`
- `--diff-toolbar-height`
- `--diff-row-min-height`

#### 3.3 Rules

- 普通 UI 不得再把按钮、输入框、icon button 的尺寸语义拆散到组件内私有实现中。
- 代码型界面的“内容密度”和“chrome 密度”可以不同，但都必须映射到显式语义 token。
- 移动端 `touch target` 最小值属于系统级下限，不允许被主题压缩。
- 字体大小自定义不会改变其他尺寸语义，只允许在局部界面引起必要的最小适配。

#### 3.4 Theme Strategy

尺寸 / 密度属于 `theme-capable shared default`。

含义：

- 它必须纳入主题系统的 schema
- 但默认多数主题可以共用一组尺寸值
- 如果未来出现“compact / spacious / accessibility”类主题，主题层可接管这些 token

#### 3.5 Current Ownership

当前已存在的基础 token 主要是全局 token，例如：

- `--btn-height-*`
- `--input-height-*`
- `--touch-target-*`
- `--topbar-height`
- `--desktop-topbar-height`

这些当前还不算真正主题化，只是“全局存在”。

### 4. Category B: State Color / Interaction State

#### 4.1 Definition

状态色 / 交互态规范负责定义：

- `hover / active / selected / focus / disabled`
- `info / success / warning / error`
- 交互 ring、selected tint、disabled fill、status border、status surface、status icon
- diff add / modify / delete / neutral
- editor selection / inactive selection / diagnostics emphasis
- terminal running / idle / reconnecting / warning / failure 等运行态状态

#### 4.2 Token Layers

基础层示例：

- `--accent-*`
- `--color-*`
- `--border-focus`
- `--border-error`

共享语义层示例：

- `--state-focus-ring-color`
- `--state-focus-ring-width`
- `--state-hover-bg-subtle`
- `--state-hover-bg-strong`
- `--state-active-bg`
- `--state-selected-bg`
- `--state-selected-border`
- `--state-disabled-bg`
- `--state-disabled-border`
- `--state-disabled-text`
- `--state-success-bg`
- `--state-success-border`
- `--state-success-text`
- `--state-success-icon`
- `--state-warning-*`
- `--state-error-*`
- `--state-info-*`

域子规范层示例：

- `--terminal-state-running-*`
- `--terminal-state-reconnecting-*`
- `--editor-selection-bg`
- `--editor-selection-inactive-bg`
- `--editor-diagnostic-warning-*`
- `--editor-diagnostic-error-*`
- `--diff-add-*`
- `--diff-modify-*`
- `--diff-delete-*`

#### 4.3 Rules

- 任何交互态都不应直接在组件里手写具体 `rgba()` 配方作为长期方案。
- focus ring、selected tint、disabled 态必须从统一状态语义层派生。
- 普通 UI 的 success / warning / error / info 与代码型界面的 diff / diagnostics / runtime status 必须共享同一套高层语义。
- domain 子规范只允许扩展状态角色，不允许绕过共享状态层直接重新定义一套无命名约束的颜色配方。

#### 4.4 Theme Strategy

状态色 / 交互态属于 `actively themed`。

含义：

- 它们必须由主题系统直接接管
- 不同主题可以也应该给出不同配方
- 高对比度主题允许使用明显不同的 focus、selected、error、warning 视觉策略

#### 4.5 Current Ownership

当前这类规范处于“部分主题化、部分散落组件”的状态：

- 主题底色已由 `[data-theme]` 接管的颜色 token 提供
- 但具体状态配方仍大量留在组件和 feature 样式中

它是当前最需要从“组件内联配方”迁移到“语义 token 配方”的一类。

### 5. Category C: Spacing / Layout Rhythm

#### 5.1 Definition

间距 / 布局节奏规范负责定义：

- 组件内边距
- row / cell / list item 的 inset
- panel / sheet / modal / drawer 内容间距
- stack、cluster、section 之间的节奏
- form group、field block、help text 的垂直节奏
- terminal / editor / diff chrome 的外层节奏与安全边距

#### 5.2 Token Layers

基础层示例：

- `--sp-1`
- `--sp-2`
- `--sp-3`
- `--sp-4`
- `--sp-5`
- `--sp-6`

共享语义层示例：

- `--gap-stack-xs`
- `--gap-stack-sm`
- `--gap-stack-md`
- `--gap-stack-lg`
- `--gap-cluster-sm`
- `--gap-cluster-md`
- `--inset-control-inline`
- `--inset-control-block`
- `--inset-row-inline`
- `--inset-row-block`
- `--inset-panel`
- `--inset-dialog`
- `--inset-drawer`
- `--section-gap`
- `--form-group-gap`

域子规范层示例：

- `--terminal-panel-inset`
- `--terminal-toolbar-gap`
- `--session-card-gap`
- `--editor-pane-inset`
- `--editor-toolbar-inset`
- `--diff-section-gap`
- `--diff-thread-inset`

#### 5.3 Rules

- 组件不应直接把 `--sp-*` 当作最终设计语义层长期消费。
- 允许保留 `--sp-*` 作为基础网格，但运行态组件应尽量消费共享语义层。
- 2px、6px、10px、14px 这类局部离散值如果反复出现，应优先升级为语义 token，而不是继续复制。
- 代码型界面可以更紧凑，但必须显式使用自己的域子规范 token。

#### 5.4 Theme Strategy

间距 / 布局节奏属于 `theme-capable shared default`。

含义：

- 它纳入主题系统
- 但当前大多数主题默认共享同一套 spacing rhythm
- 如果后续某些主题明确追求更紧凑或更宽松的布局节奏，主题可以接管这一类 token

#### 5.5 Current Ownership

当前 `--sp-*` 已是全局真相源，但语义间距层尚未建立，因此仍不算完成态。

### 6. Category D: Surface / Overlay

#### 6.1 Definition

Surface / Overlay 规范负责定义：

- page / surface / panel / elevated / overlay / backdrop 的角色
- modal / drawer / sheet / popover / toast / workbench / local overlay 的层级与视觉规则
- terminal / editor / diff 的局部 overlay、状态板、peek 面板、review chrome
- 透明度、边框、背景混合、阴影、宽度上限、sticky chrome 分层

#### 6.2 Token Layers

基础层示例：

- `--bg-page`
- `--bg-surface`
- `--bg-panel`
- `--bg-elevated`
- `--shadow-*`
- `--z-*`

共享语义层示例：

- `--surface-page-bg`
- `--surface-panel-bg`
- `--surface-elevated-bg`
- `--surface-overlay-bg`
- `--surface-overlay-border`
- `--surface-overlay-shadow`
- `--surface-overlay-backdrop`
- `--surface-sticky-bg`
- `--overlay-width-sm`
- `--overlay-width-md`
- `--overlay-width-lg`
- `--overlay-backdrop-opacity`

域子规范层示例：

- `--terminal-local-overlay-bg`
- `--terminal-local-overlay-border`
- `--session-overlay-bg`
- `--editor-peek-bg`
- `--editor-peek-shadow`
- `--diff-review-bar-bg`
- `--diff-inline-thread-bg`

#### 6.3 Rules

- 普通 UI 的 global overlay 必须落在共享 overlay 语义层上。
- terminal、editor、diff 的 local overlay 不能脱离系统另起炉灶，而应消费共享语义层并只在需要处做子规范扩展。
- backdrop、elevated surface、panel chrome 的配方不能长期停留在页面级私有 CSS 中。
- overlay 的 z-index 语义必须集中治理，不允许 feature 自己发明数字层级。

#### 6.4 Theme Strategy

Surface / Overlay 属于 `actively themed`。

含义：

- 它们已经天然与主题颜色、阴影、对比度策略绑定
- 不同主题应允许覆盖背景、边框、阴影、backdrop 和局部 overlay 策略

#### 6.5 Current Ownership

当前该类规范已部分被主题接管：

- `bg-*`
- `bg-panel`
- `bg-elevated`
- `shadow-*`
- `scrollbar-*`

但它还没有达到完整状态，因为很多 overlay recipe、backdrop、局部 chrome 和透明混合配方仍散落在组件或 feature CSS 中。

### 7. Category E: Radius Roles

#### 7.1 Definition

圆角角色规范负责定义：

- control
- icon button
- tag / badge / chip
- pill / capsule
- panel / card / drawer / modal / sheet
- local overlay
- flush-edge / square-edge surface

#### 7.2 Token Layers

基础层示例：

- `--radius-sm`
- `--radius-md`
- `--radius-lg`
- `--radius-xl`
- `--radius-full`

共享语义层示例：

- `--radius-control`
- `--radius-control-sm`
- `--radius-control-lg`
- `--radius-chip`
- `--radius-tag`
- `--radius-pill`
- `--radius-panel`
- `--radius-overlay`
- `--radius-local-overlay`
- `--radius-flush`

域子规范层示例：

- `--editor-peek-radius`
- `--diff-thread-radius`
- `--terminal-local-overlay-radius`

#### 7.3 Rules

- 组件不得长期直接自由选择 `sm / md / lg / xl / full` 作为角色替代品。
- radius 的基础 token 保留为数值层，组件应优先消费语义半径层。
- 对代码型界面来说，允许在必要时使用 `flush` 或更克制的 radius，但必须显式命名，不允许局部随意写 `0` 或 `999px`。

#### 7.4 Theme Strategy

圆角角色属于 `theme-capable shared default`。

含义：

- 主题系统应能接管这类 token
- 但当前大多数主题先共享一套 radius 角色值
- 如果未来出现明确的“sharp / soft / retro / accessibility”风格主题，主题层可为 radius 提供差异值

#### 7.5 Current Ownership

当前只有基础半径 token 已存在，全局语义层与主题归属都还未完成。

### 8. Theme Ownership Matrix

#### 8.1 Category-Level Matrix

| Category | Current state | Target state | Theme mode |
| --- | --- | --- | --- |
| Size / Density | global token only, no shared semantic layer | theme system managed + semantic + domain sub-specs | theme-capable shared default |
| State Color / Interaction State | partially theme-backed, recipes scattered in components | fully theme-managed semantic recipes | actively themed |
| Spacing / Layout Rhythm | global spacing scale only, no semantic rhythm layer | theme system managed + semantic rhythm layer | theme-capable shared default |
| Surface / Overlay | partially theme-managed | fully theme-managed semantic surfaces | actively themed |
| Radius Roles | base values only | theme system managed semantic role layer | theme-capable shared default |

#### 8.2 What Is Already Theme-Owned

当前已经明确属于主题层的主要是：

- 颜色 token
- accent token
- semantic color token
- background token
- panel / elevated background token
- shadow token
- scrollbar tone token
- icon color token

#### 8.3 What Is Global Today But Must Become Theme-Capable

当前主要还是全局值，但后续必须进入主题系统 schema 的包括：

- control / row / toolbar / panel density
- spacing rhythm
- radius roles
- 部分 overlay width / inset / chrome density

#### 8.4 What Must Be Migrated Out of Component-Local Recipes

后续必须从组件局部配方迁出，不允许长期保留的包括：

- focus ring box-shadow recipe
- selected / active / hover tint recipe
- disabled fill / border recipe
- notice / tag / progress / diff / diagnostics 的状态配方
- overlay backdrop / glass / tint / local surface recipe

### 9. Code-Oriented Surface Sub-Specs

这 5 类规范在代码型界面的落地规则如下。

#### 9.1 Terminal

- 允许保留独立的 terminal 内容字体和字体大小偏好
- terminal chrome 仍必须接入统一的 density、state、surface、radius、spacing 规范
- 典型包括：
  - tab
  - toolbar
  - local overlay
  - reconnecting / running / failed 状态
  - terminal selector / session shell chrome

#### 9.2 Agent Session

- agent session 的消息、状态条、启动器、局部操作区应复用共享语义层
- 如确需更高密度，可通过 `session` 子规范定义，而不是直接偏离系统值

#### 9.3 Code Editor

- editor 允许独立内容字体和字体大小
- 但 editor 外围 chrome、peek、inline diagnostics、selection emphasis、breadcrumbs、toolbar 均属于本次 5 类规范范围
- Monaco palette 仍可独立存在，但它的 UI chrome 不能游离于主题系统之外

#### 9.4 Diff

- diff 允许拥有自己的 add / modify / delete 状态子规范
- diff thread、review bar、inline comment container、selection highlight 仍需统一纳入 state + surface + spacing + radius 体系

### 10. Migration Priorities

后续代码迁移建议按以下优先级推进：

1. 先补共享语义 token 层与命名约束
2. 再把散落在共享组件中的 recipe 收回到 token 层
3. 再迁 feature 层和代码型界面子规范
4. 最后补 guardrail，禁止新增裸写实现

优先顺序建议：

1. 状态色 / 交互态
2. 尺寸 / 密度
3. 间距 / 布局节奏
4. Surface / Overlay
5. 圆角角色

说明：

- 状态色 / 交互态分散度最高，且最影响主题一致性。
- 尺寸 / 密度是普通 UI 与代码型界面同时会持续漂移的高频维度。
- 间距和圆角的治理收益高，但可放在状态和密度之后。

### 11. Guardrails

迁移完成后应建立与 typography 类似的 guardrail。

建议最少包含：

- 禁止共享组件新增裸写状态色 recipe
- 禁止共享组件新增裸写 density / spacing / radius 角色值
- 禁止共享 overlay 新增自定义 z-index 数字
- 限制代码型界面中允许保留的局部例外范围

Guardrail 的粒度应与规范成熟度匹配：

- 先针对共享组件与全局样式层收紧
- 再逐步把 feature 层和代码型界面纳入

### 12. Acceptance Criteria

这份规范完成后的验收标准是：

- 5 类基础规范都拥有清晰的 scope、语义层和子规范边界
- 已明确哪些是 actively themed，哪些是 theme-capable shared default
- 已明确普通 UI 与代码型界面的统一关系，而不是把代码型界面留作例外区
- 已明确后续迁移应先做 token 结构，再做组件收口，最后补 guardrail
- 已明确 typography 继续独立治理，terminal / editor 的字体大小用户偏好不受本次规范覆盖

## Open Questions Intentionally Deferred

以下问题被有意留到实现与迁移阶段决定，不在本次规范中先拍死：

- 是否把现有基础尺寸 token 改名成新的中性尺度名
- 主题系统最终在代码层采用单一 `theme schema` 对象还是 `tokens.css + registry metadata` 混合模式
- 代码型界面的子规范是继续放在全局 `tokens.css` 还是拆分到独立子文件
- guardrail 是按类别拆多个测试，还是集中在一个 foundations guard suite 中

这些都属于实现细节，不影响本次规范的方向与边界。
