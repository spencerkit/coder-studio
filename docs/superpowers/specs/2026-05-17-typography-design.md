# UI Typography Token Redesign — Design

Date: 2026-05-17
Status: Draft
Owner: Codex

## Problem

当前 Web UI 的排版体系存在两个结构性问题：

- [`packages/web/src/styles/tokens.css`](../../../packages/web/src/styles/tokens.css) 只提供一套基础字号 token，移动端只覆写了触控尺寸，没有覆写排版尺度。
- 运行态样式同时混用了基础 token 和大量裸写字号，导致标题、正文、标签、meta 信息之间的语义边界不稳定。

当前的典型症状包括：

- `body`、`button`、`input` 默认仍绑定 `13px` 级别正文。
- 局部标题、按钮、标签、辅助信息常落在同一组 `13px/14px` 尺度上，标题与正文拉不开层级。
- 普通 UI 中存在 `9px`、`10px`、`11px` 等离群值，密度和可读性不一致。
- 桌面与移动端只能共享同一套排版尺寸，无法通过 token 层分别控制。

因此，本次设计不是简单调整几个标题字号，而是重建一套可约束全局 UI 的排版 token 结构，让普通 UI 的字体使用回到语义驱动，而不是局部凑值。

## Goals

- 为普通 UI 建立一套统一的语义排版 token。
- 在 token 层支持 desktop / mobile 两套排版尺度。
- 让标题、正文、标签、meta、内联代码有稳定且互不混用的角色边界。
- 让 `body`、`button`、`input`、`textarea`、`select` 等基础元素默认绑定语义 token，而不是基础字号 token。
- 清理普通 UI 中的裸写字号和直接消费基础字号 token 的模式。
- 为后续批量迁移提供明确的优先级、禁止项和验收标准。

## Non-Goals

- 不调整 `terminal`、`agent session`、`code editor`、`diff` 的代码型排版体系。
- 不在本次设计中重做字体家族选择，继续沿用当前 sans / mono 字体栈。
- 不在本次设计中引入新的主题 family 或更改颜色系统。
- 不要求一次性重写全部组件实现；本次先明确规范和迁移路径。
- 不把组件尺寸变体 `sm/md/lg` 等同为排版语义层级。

## User Decisions Captured

- desktop 和 mobile 应分别拥有独立的排版尺度。
- 除 `terminal`、会话、代码编辑器和 diff 之外，其他普通界面都应统一使用这套 typography token。
- 运行态普通 UI 中现有裸写字号都应逐步迁移掉。
- 迁移完成后，普通组件不应再直接依赖 `--text-xs/sm/base/lg...` 这类基础字号 token。

## Approaches Considered

### Option A: 保留现有 `--text-*`，只整体调一轮数值

优点：

- 改动最小。
- 对现有组件命名兼容最好。

缺点：

- `--text-*` 同时承担“数值尺度”和“语义角色”两种职责，组件仍会继续自由混用。
- 后续新组件作者仍需要自己判断标题、正文、标签该用哪个 size，排版漂移会继续出现。

### Option B: 保留基础尺度 token，再新增一层语义排版 token（推荐）

优点：

- 组件统一消费语义 token，desktop / mobile 只在 token 映射层覆写。
- 后续整体放大或压缩字体时，只需要调整 token 映射，不必逐个组件手改。
- 能明确约束标题、正文、标签、meta、内联代码的使用边界。

缺点：

- 首次迁移需要同时处理 token 定义、基础样式和组件用法。
- 过渡期需要兼容旧 `--text-*` 体系，短期内会存在双层 token。

### Option C: 每个页面或组件族自行维护排版规则

优点：

- 局部适配空间最大。

缺点：

- 维护成本高。
- 很快会回到“每块界面看起来都合理，但合在一起不统一”的状态。

## Final Choice

采用 Option B。

保留基础尺度 token 作为纯数值层，再新增普通 UI 唯一允许消费的语义排版 token。desktop / mobile 的差异只在 token 层解决，组件层不再自行区分平台字号。

`terminal`、`agent session`、`code editor`、`diff` 继续维持独立的 monospace 排版体系，不并入这套普通 UI token。

## Final Design

### 1. Scope

本次 typography 规范适用范围：

- 所有普通 UI 页面和组件
- 顶栏、侧栏、设置页、sheet、modal、command palette、toast、welcome、auth、workspace 空状态等运行态界面

明确豁免范围：

- shell terminal
- agent session terminal
- code editor
- diff / review code surfaces

这些豁免区域可继续使用独立的 monospace token 与字号策略，不需要迁入普通 UI typography token。

### 2. Token Architecture

排版 token 分为两层。

第一层是基础尺度 token，只负责数值，不直接给业务组件消费。建议命名为中性尺度名，例如：

- `--font-size-100`
- `--font-size-200`
- `--font-size-300`
- `--font-size-400`
- `--font-size-500`
- `--font-size-600`
- `--font-size-700`

第二层是语义排版 token，普通 UI 只能消费这一层，例如：

- `--type-kicker-size`
- `--type-kicker-line-height`
- `--type-kicker-weight`
- `--type-kicker-letter-spacing`
- `--type-body-size`
- `--type-body-line-height`
- `--type-body-weight`
- `--type-section-title-size`
- `--type-page-title-size`
- `--type-code-inline-size`
- `--type-code-inline-family`

约束规则：

- 组件禁止直接使用基础字号 token。
- 组件禁止继续直接使用旧 `--text-xs/sm/base/lg...` 作为运行态普通 UI 字号来源。
- 过渡期可以保留旧 `--text-*` 作为兼容别名，但它们只用于 token 内部映射，不作为普通组件 API。

### 3. Desktop / Mobile Base Scale

基础尺度建议如下。

| Base token | Desktop | Mobile |
| --- | --- | --- |
| `--font-size-100` | 11px | 12px |
| `--font-size-200` | 12px | 13px |
| `--font-size-300` | 14px | 15px |
| `--font-size-400` | 16px | 17px |
| `--font-size-500` | 18px | 20px |
| `--font-size-600` | 24px | 28px |
| `--font-size-700` | 32px | 36px |

平台差异处理规则：

- `:root` 定义 desktop 默认值。
- 在现有移动端断点覆盖层中，为移动端覆写基础尺度 token。
- 组件层不感知当前使用的是 desktop 还是 mobile 数值。

### 4. Semantic Typography Scale

普通 UI 统一消费以下语义排版层。

| Semantic token | Desktop | Mobile | Weight | Typical usage |
| --- | --- | --- | --- | --- |
| `--type-kicker` | 11 / 1.2 | 12 / 1.2 | 600 | 眉题、区块前缀、小型状态标签 |
| `--type-label` | 12 / 1.35 | 13 / 1.35 | 500 | tab、字段标签、筛选项、chip |
| `--type-meta` | 12 / 1.45 | 13 / 1.45 | 400 | 辅助说明、次级信息、时间/状态补充 |
| `--type-body` | 14 / 1.5 | 15 / 1.55 | 400 | 正文、设置描述、列表说明 |
| `--type-body-strong` | 14 / 1.45 | 15 / 1.5 | 500 | 按钮文字、输入内容、列表主文案 |
| `--type-code-inline` | 12 / 1.4 | 13 / 1.4 | 500 | 普通 UI 中的路径、命令、快捷键、ID |
| `--type-app-title` | 16 / 1.25 | 17 / 1.25 | 600 | 顶栏标题、sheet 标题、面板头 |
| `--type-section-title` | 18 / 1.2 | 20 / 1.2 | 600 | 卡片标题、模块标题、弹窗标题 |
| `--type-page-title` | 24 / 1.1 | 28 / 1.1 | 600 | 页面主标题 |
| `--type-display` | 32 / 1.05 | 36 / 1.05 | 600 | hero、空状态主标题、品牌型标题 |

附加规则：

- 普通 UI 默认正文不再使用 `13px`，而是 desktop `14px`、mobile `15px`。
- 普通 UI 不再使用 `9px` 或 `10px` 作为正文、按钮、标签等常规文本。
- 标题至少比正文高一个语义层级，禁止出现“正文和标题同级甚至更大”的结构。

### 5. Base Element Mapping

基础元素应统一绑定语义 token，而不是直接绑定基础字号。

建议映射：

- `body` -> `--type-body`
- `button` -> `--type-body-strong`
- `input` / `textarea` / `select` -> `--type-body-strong`
- 默认 `p` -> `--type-body`
- 默认 `code` / `kbd` / `samp` -> `--type-code-inline`
- `h1` / `h2` / `h3` / `h4` / `h5` / `h6` 不再按固定旧 `--text-*` 线性映射，而是按实际运行态语义重新绑定

推荐基础标题绑定：

- `h1` -> `--type-page-title`
- `h2` -> `--type-section-title`
- `h3` -> `--type-app-title`
- `h4` -> `--type-body-strong`
- `h5` -> `--type-label`
- `h6` -> `--type-meta`

如果具体界面不适合直接使用默认标题映射，组件可覆写为更准确的语义 token，但不能回退为裸写字号。

### 6. Role Mapping for Existing UI

以下映射用于指导当前项目中的常见界面角色收敛。

#### Page-level

- welcome、auth、workspace 空状态的大标题 -> `--type-page-title`
- 展示型 hero 标题 -> `--type-display`
- 页面顶部 kicker、区块眉题 -> `--type-kicker`
- 页面简介、空态说明正文 -> `--type-body`

#### Panel-level

- modal、sheet、popover 主标题 -> `--type-section-title`
- topbar 当前区域标题、panel header -> `--type-app-title`
- 设置页或列表中的小分组名，如果只是导航分段，不应继续伪装为标题，应降级为 `--type-kicker` 或 `--type-label`

#### Form and interaction

- 按钮文字 -> `--type-body-strong`
- 输入内容 -> `--type-body-strong`
- 字段 label -> `--type-label`
- placeholder、help text、description -> `--type-meta`

#### Lists and cards

- 行标题、列表主文案 -> `--type-body-strong`
- 卡片或模块标题 -> `--type-app-title` 或 `--type-section-title`
- 路径、时间、状态补充、二级说明 -> `--type-meta`

#### Inline code and shortcuts

- 普通 UI 中出现的路径、命令、快捷键、ID -> `--type-code-inline`

### 7. False Title Demotion Rules

当前项目中相当一部分“标题”实际上不属于标题语义，而只是高权重正文、标签或状态文案。本次迁移必须主动做降级判断。

以下文本不应再使用标题层级：

- 只是分组名的文字
- 只是状态字的文字
- 只是按钮或列表主文案的文字
- 只是说明型副文案，但因为历史原因被写成 `600 + 13px/14px`

判断规则：

- 如果它并不承担页面、模块或面板的结构分层职责，它就不是标题。
- 如果它和相邻正文处于同一信息层级，它应使用 `--type-body-strong`、`--type-label` 或 `--type-meta`。
- 标题数量必须克制，不能通过“到处加粗加大”来解决视觉强调。

### 8. Authoring Rules

普通 UI 的作者规范如下：

- 组件只能消费 `--type-*` 语义 token。
- 组件变体 `sm/md/lg` 优先调整容器高度、padding、图标尺寸，不优先切换排版语义层级。
- 如现有语义 token 不足，应先新增 token，再写样式。
- 所有 typography 相关属性应尽量成组来自 token，而不是只 token 化字号、其余属性继续裸写。

推荐做法：

- `font-size`、`line-height`、`font-weight`、`letter-spacing` 尽量一起以语义角色定义。
- `code-inline` 一类语义同时定义 `font-family` 和 size，避免组件各自拼装。

### 9. Forbidden Patterns

普通 UI 中禁止以下模式：

- 裸写 `font-size`
- 裸写 `line-height`
- 裸写 `font-weight`
- 裸写 `letter-spacing`
- 组件直接消费基础字号 token
- 组件继续直接消费旧 `--text-xs/sm/base/lg...` 作为最终运行态字号
- 使用 `9px`、`10px` 作为普通 UI 正文、按钮、标签、说明文本
- 让正文、标签、说明文本伪装成标题
- 让组件尺寸变体替代语义层级

允许的例外：

- 豁免范围中的 terminal、editor、diff、session code surfaces
- 需要独立字距的 `kicker` 或 `display` 等语义角色，但应通过 token，而不是组件局部临时写死

### 10. Migration Priority

建议按以下顺序迁移。

#### Batch 1: Base and shared UI primitives

- [`packages/web/src/styles/base.css`](../../../packages/web/src/styles/base.css)
- `button`
- `input`
- `textarea`
- `tabs`
- `tag`
- `badge`
- `pill`
- `tooltip`
- `notice`
- `modal`
- `empty-state`

目标：

- 先把基础元素和通用控件从旧 `--text-*` 与裸写字号上摘下来。

#### Batch 2: App chrome and navigation

- topbar
- settings
- workspace shell
- popover
- sheet
- toast
- command palette

目标：

- 让主壳层和工具面板先形成统一语言。

#### Batch 3: Presentation pages

- welcome
- auth
- workspace empty states
- mobile empty views

目标：

- 用新的 page / display 层级修复最明显的标题与正文错位。

#### Batch 4: Residual cleanup

- 搜索框
- 状态条
- provider 列表
- 各类 meta 文案
- 各类残留 `13px/11px/10px` 离群点

目标：

- 清理组件级、页面级散落的假标题和特例字号。

### 11. Testing and Acceptance Criteria

验收标准：

- 除豁免范围外，运行态普通 UI 中不再存在裸写字号。
- 普通 UI 组件不再直接消费基础字号 token。
- desktop / mobile 的字体差异只通过 token 映射完成，而不是组件分别写两套字号。
- 标题、正文、标签、meta、内联代码角色边界清晰，不再混用。

建议测试覆盖：

#### Stylesheet-level

- `tokens.css` 定义 desktop / mobile 两套基础尺度 token。
- 语义排版 token 全量存在，并映射到基础尺度 token。

#### Base/theme tests

- `body`、`button`、`input`、`textarea`、`select` 都绑定语义 token。
- 关键组件不再直接依赖旧 `--text-*` 作为最终字号来源。

#### Guardrails

- 补充检测，确保普通 UI 样式文件中不再新增裸写字号。
- 允许对豁免目录做白名单处理，避免误伤 terminal / editor / diff。

## Architecture

```text
Desktop / Mobile base scale tokens
  -> semantic typography tokens
  -> base elements and shared UI primitives
  -> feature-level components

Exempt code surfaces
  -> independent terminal/editor/diff typography tokens
```

## Open Questions Resolved

- desktop 和 mobile 是否共用一套排版尺度
  - 不共用。通过 token 层分别覆写。
- terminal、session、editor、diff 是否迁入统一 UI typography
  - 不迁入。继续使用独立排版体系。
- 是否允许普通组件继续直接用旧 `--text-*`
  - 不允许。过渡期仅可作为 token 内部兼容别名。

## Risks

- 首次迁移会触及较多基础组件，短期内可能带来视觉回归。
- 如果没有同步加入测试护栏，后续仍可能重新出现裸写字号。
- 若把所有当前“标题”一律放大，而不先做假标题降级，会把问题从层级混乱转成标题泛滥。

## Rollout Recommendation

- 先完成 token 和 base element 改造，再推进共享组件。
- 每批迁移都应伴随 theme / stylesheet 测试更新。
- 每完成一批，优先 review welcome、settings、workspace shell、empty state 这几类最能暴露层级问题的界面。
