# Icon Theme System — Design

Date: 2026-05-12
Status: Draft
Owner: spencer

## Problem

当前项目已经完成多主题皮肤基础设施，主题通过 [`tokens.css`](../../../packages/web/src/styles/tokens.css) 和 `themeId` 驱动 UI、终端与 Monaco。

但 icon 仍然存在两个明显问题：

- 一部分 icon 继续自然继承 `currentColor`，这是合理的。
- 另一部分 icon 的颜色和容器样式散落在 [`components.css`](../../../packages/web/src/styles/components.css) 中，直接绑定 `--text-*`、`--accent-*`、`--color-*` 等 token。

这导致 icon 在主题系统里还不是一等能力，具体表现为：

- 文件树、git 状态、toast、空态、设置入口等 icon 的视觉语义分散在业务类里。
- 浅色主题容易残留“深色时代”的 icon 观感，例如颜色过闷、容器偏重、和文本层级关系不自然。
- 新增主题时，icon 往往只能机械复用文本色或 accent 色，难以形成真正有区分度的皮肤感。
- e2e-ui 虽然已经支持多主题截图，但 icon 差异还没有被系统性建模和验证。

本次设计需要把 icon 样式纳入现有主题系统，但要保持范围克制，避免把问题升级成整套 icon 组件体系重写。

## Goals

- 让 icon 颜色与轻量 surface 成为主题系统的一等能力。
- 保持大多数普通 icon 继续通过 `currentColor` 工作，不打破现有简单路径。
- 为“故意不等于文本色”的 icon 引入统一 token 分层，而不是继续在业务 CSS 中散落直连颜色。
- 让不同主题 family 在文件类型、git 状态、状态提示、空态 icon 等场景上具备稳定且可区分的视觉结果。
- 为浅色主题补齐更合理的 icon 与 icon 容器配色，减少违和的深色遗留感。
- 与现有 `themeId`、`tokens.css`、`base.css`、`components.css`、e2e-ui 架构保持一致。

## Non-Goals

- 不在本期引入用户自定义 icon 主题编辑器。
- 不在本期支持按主题切换不同 icon pack。
- 不在本期把 `outline / filled`、`stroke width`、圆角风格等 icon 形态差异纳入主题。
- 不在本期引入全局 `ThemedIcon` React 包装器或 icon registry。
- 不要求把所有 icon 都从 `currentColor` 改成主题 token。

## User Decisions Captured

- icon 应该纳入现有主题系统，而不是继续作为零散 CSS 例外存在。
- 第一阶段优先覆盖“语义层 + 业务层”两级 icon 主题化。
- 纯按钮 icon、纯文本附属 icon 等继续沿用 `currentColor`。
- 需要同时考虑带小底片或容器感的 icon 区块，而不只是 SVG 前景色。
- 方案应优先复用现有 token 架构，不先引入新的 React 抽象。

## Approaches Considered

### Option A: 只补 token，不增加任何复用层

做法：

- 只在 [`tokens.css`](../../../packages/web/src/styles/tokens.css) 中补充 `--icon-*` 和 `--icon-surface-*`
- 所有业务类各自直接消费 token

优点：

- 改造最小。
- 完全贴合现有主题机制。

缺点：

- 复用约束较弱。
- icon 语义仍然容易继续散落在业务 CSS 中。

### Option B: token-first，再加一层很薄的 utility 或 slot（推荐）

做法：

- 在 `tokens.css` 中定义 icon token 能力
- 在 [`base.css`](../../../packages/web/src/styles/base.css) 中增加少量通用 icon utility
- 在 `components.css` 中把现有业务类接入这层语义能力

优点：

- 仍然以 token 为中心，不改变现有架构。
- 比纯 token 方案更容易复用与约束。
- 不需要引入新的 JSX 包装层。

缺点：

- 比完全不抽象多一层样式约定。
- 需要对一批现有 icon 场景做一次迁移整理。

### Option C: 建立完整的 ThemedIcon 组件与 icon registry

做法：

- 所有 icon 统一改用包装组件
- 颜色、size、形态、pack 映射都通过组件层管理

优点：

- 中长期控制力最强。

缺点：

- 对当前项目过重。
- 当前问题主要是 CSS token 缺位，而不是 JSX API 缺位。
- 会把一个主题扩展问题升级成一次大规模组件迁移。

## Final Choice

采用 Option B。

最终策略为：

- icon 主题化以 token 为核心。
- 默认路径保持 `currentColor`。
- 只为“应该故意不同于文本色”的 icon 建立 icon token。
- 在 `base.css` 中增加一层很薄的 icon utility，帮助跨页面复用语义。
- 不引入 React 包装器，不把 icon 主题化升级为 icon 架构重写。

这样可以在不改变整体开发范式的前提下，让 icon 真正成为皮肤系统的一部分。

## Final Design

### 1. Token Layering

icon token 分为三层：

#### 1.1 Semantic icon tokens

用于通用 UI icon 语义，不绑定具体业务模块。

- `--icon-primary`
- `--icon-secondary`
- `--icon-muted`
- `--icon-accent`
- `--icon-success`
- `--icon-warning`
- `--icon-error`
- `--icon-info`

使用原则：

- 适用于设置入口、空态提示、通用状态提示、危险提示等 icon。
- 可以映射到现有 `--text-*`、`--accent-*`、`--color-*`，但消费方只认 `--icon-*`。

#### 1.2 Domain icon tokens

用于颜色本身承载业务分类语义的 icon。

- `--icon-file-folder`
- `--icon-file-code`
- `--icon-file-data`
- `--icon-file-doc`
- `--icon-file-media`
- `--icon-file-default`
- `--icon-git-staged`
- `--icon-git-modified`
- `--icon-git-deleted`
- `--icon-git-untracked`

使用原则：

- 适用于文件树、git 状态等“颜色即类别”的 icon。
- 允许不同主题 family 在这一层体现更明显的个性差异。

#### 1.3 Icon surface tokens

用于 icon 的轻量背景块、底片、badge 容器，不直接用于普通文本色。

- `--icon-surface-subtle`
- `--icon-surface-accent`
- `--icon-surface-success`
- `--icon-surface-warning`
- `--icon-surface-error`
- `--icon-surface-info`

使用原则：

- 适用于 welcome feature、empty state、toast、badge 等带小容器的 icon。
- 前景与背景都通过主题控制，避免浅色主题继续沿用过重容器感。

### 2. Naming Rules

命名规则固定如下：

- token 只表达语义，不表达组件名。
- 不新增 `--settings-nav-icon`、`--toast-warning-icon` 这类组件私有 token。
- 组件和业务类只能消费 semantic、domain、surface 三类 icon token。
- 如果某个 icon 没有独立视觉语义需求，应继续继承父级 `color`。

目标是让 theme author 看到 token 名称时，能理解“这个颜色表达什么”，而不是“这个颜色给哪个类用”。

### 3. CurrentColor Boundary

不是所有 icon 都应该主题化。

继续保留 `currentColor` 的场景：

- `IconButton` 内的普通 icon
- `Select` trigger / arrow / 输入框附属 icon
- `Spinner`
- 与标题、label、按钮文案共同表达一个前景层级的 icon
- 已经由父级 `color` 统一管理且没有独立视觉语义的 icon

判断原则：

- 如果 icon 在换主题时应该和旁边文字同进同退，就继续使用 `currentColor`。
- 如果 icon 在换主题时应该比文字更弱、更强、或承担独立状态语义，就切到 `--icon-*`。

### 4. Utility Layer

在 [`base.css`](../../../packages/web/src/styles/base.css) 中新增很薄的一层 utility。

#### 4.1 Tone utilities

- `.icon-tone-primary`
- `.icon-tone-secondary`
- `.icon-tone-muted`
- `.icon-tone-accent`
- `.icon-tone-success`
- `.icon-tone-warning`
- `.icon-tone-error`
- `.icon-tone-info`

#### 4.2 Surface utilities

- `.icon-surface-subtle`
- `.icon-surface-accent`
- `.icon-surface-success`
- `.icon-surface-warning`
- `.icon-surface-error`
- `.icon-surface-info`

#### 4.3 Optional structural utility

如确有复用价值，可增加一个轻量结构类：

- `.icon-chip`

职责仅限于：

- `inline-flex`
- 居中对齐
- 圆角
- 紧凑尺寸约束

不负责表达业务样式，也不替代组件本身的布局逻辑。

### 5. Scope of First-Phase Migration

第一阶段只迁移已经明显存在独立 icon 配色需求的场景。

#### 5.1 Semantic icon candidates

首批纳管：

- `.settings-mobile-item__icon`
- `.settings-nav-icon`
- `.config-empty-icon`
- `.bottom-terminal-empty-icon`
- `.welcome-feature-icon`
- `.terminal-panel-empty-icon`
- `.mobile-dock__icon`
- `.mobile-supervisor-badge__icon`

#### 5.2 Domain icon candidates

首批纳管：

- `.tree-icon.folder`
- `.tree-icon.code`
- `.tree-icon.data`
- `.tree-icon.doc`
- `.tree-icon.media`
- `.tree-icon.file`
- `.git-row-icon-staged`
- `.git-row-icon-modified`
- `.git-row-icon-deleted`
- `.git-row-icon-untracked`

#### 5.3 Status icon candidates

首批纳管：

- `.toast__icon`
- `.toast--success .toast__icon`
- `.toast--warning .toast__icon`
- `.toast--error .toast__icon`
- `.toast--info .toast__icon`
- 配置编辑器保存状态 icon
- confirm / warning / danger callout icon

#### 5.4 Surface candidates

首批纳管：

- welcome feature icon 容器
- empty state icon 容器
- toast icon 容器
- badge / chip 式 icon 容器

### 6. Explicit Out-of-Scope Cases

第一阶段明确不纳入：

- 纯按钮 icon
- 纯 hover / active 的瞬时交互前景色
- icon 尺寸 token
- `stroke width`、`filled / outline`、圆角风格等形态主题化
- 第三方 icon pack 替换

这样可以防止实现边界从“主题扩展”滑向“icon 系统重构”。

### 7. Theme Authoring Rules

每个主题都必须显式声明 icon token，而不是依赖默认推导。

规则如下：

- 每个 `[data-theme="..."]` block 都定义完整 icon token 集。
- semantic icon token 可以映射到现有文本或状态色，但必须显式写出。
- domain icon token 允许在不同 family 中体现更明显差异。
- surface token 必须对浅色主题单独校准，避免仅通过 opacity 复制深色方案。
- 高对比度主题的 icon token 优先保证辨识度与对比度，而不是追求常规主题的柔和层级。

### 8. CSS Integration Strategy

样式文件分工保持明确：

- [`tokens.css`](../../../packages/web/src/styles/tokens.css)
  - 提供 theme-level icon 能力
- [`base.css`](../../../packages/web/src/styles/base.css)
  - 提供少量复用型 icon utility
- [`components.css`](../../../packages/web/src/styles/components.css)
  - 把具体业务类接到 icon token / utility 上

不新增专门的 `icons.css`。

原因：

- 当前全局样式入口已经稳定。
- icon utility 的体量不足以值得单独建文件。
- 继续把通用 token 和通用 utility 维持在既有分层内，迁移成本最低。

### 9. Validation Strategy

验证分三层。

#### 9.1 Token and CSS tests

在现有样式测试基础上扩充：

- [`tokens-touch.test.ts`](../../../packages/web/src/styles/tokens-touch.test.ts)
- [`base.theme.test.ts`](../../../packages/web/src/styles/base.theme.test.ts)
- [`components.theme.test.ts`](../../../packages/web/src/styles/components.theme.test.ts)

重点断言：

- 所有内置主题都定义了完整的 icon token。
- icon utility 存在且语义稳定。
- 首批纳管类不再直接绑定裸 `--text-*`、`--accent-*`、`--color-*`，而是转向 `--icon-*`。

#### 9.2 e2e-ui scenes

补强或新增以下 scene：

- 文件树 scene：覆盖 folder / code / data / doc / media / file
- git 状态 scene：覆盖 staged / modified / deleted / untracked
- settings scene：覆盖导航与移动端入口 icon
- empty state scene：覆盖配置空态、终端空态、welcome feature
- toast scene：覆盖 success / warning / error / info

目标不是做像素基线，而是保证不同主题下 icon 视觉差异可稳定产出并可对比查看。

#### 9.3 Manual review checklist

人工 review 时重点检查：

- 浅色主题是否仍出现偏深、偏脏、过闷的 icon 颜色。
- icon 容器背景是否与所在 surface 协调。
- 文件树和 git 状态在不同 theme family 下是否既保持语义一致，又具备 family 差异。
- 高对比度主题下状态 icon 是否足够清晰。

### 10. Success Criteria

完成后应满足：

- icon 颜色和轻量 surface 成为主题系统的一等能力。
- 默认 `currentColor` 路径继续成立，没有把普通 icon 复杂化。
- 首批高价值业务 icon 不再散落直连文本色或 accent 色。
- mint / graphite / nord / hc 各 family 在 icon 上既保持语义一致，又能体现皮肤差异。
- 浅色主题的 icon 和 icon 容器不再显著带有深色皮肤遗留感。

## Architecture

```text
theme registry / tokens.css
        |
        v
icon token layers
  ├─ semantic
  ├─ domain
  └─ surface
        |
        v
base.css icon utilities
        |
        v
components.css feature mappings
        |
        v
runtime scenes + e2e-ui review
```

## Rollout Plan

推荐按以下顺序落地：

1. 在 `tokens.css` 中为全部主题补齐 icon token。
2. 在 `base.css` 中增加薄 utility。
3. 先迁移 domain icon：文件树与 git 状态。
4. 再迁移 semantic / status icon：settings、toast、empty state、badge。
5. 最后补 e2e-ui scene 与样式测试，形成视觉验证闭环。

## Risks and Mitigations

### Risk 1: icon token 过度碎片化

如果直接按组件名建 token，会快速退化为样式别名堆积。

Mitigation:

- 严格限制 token 只表达语义或业务域，不表达具体组件名。

### Risk 2: utility 过厚，反向演化成样式框架

如果 utility 层开始承载布局和业务表达，会让全局样式边界变糊。

Mitigation:

- utility 只提供颜色与轻量 surface 语义。
- 布局和场景结构仍由组件或业务类负责。

### Risk 3: 浅色主题仍然只是深色方案的机械翻转

如果 icon token 只是直接照搬 dark 的映射关系，浅色主题仍会缺乏独立视觉质量。

Mitigation:

- 明确要求对浅色 theme 的 icon 和 surface token 做单独校准。
- 通过 e2e-ui 与人工 review 把浅色主题作为重点检查对象。
