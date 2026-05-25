# Semantic Color System Big-Bang Design

Date: 2026-05-24
Status: Draft
Owner: Codex

## Problem

当前 `packages/web` 已经具备主题 token、glass/runtime appearance，以及一部分 workspace material token，但颜色系统仍然存在三类并行入口：

1. 主题基础色与 surface token，例如 `--bg-*`、`--text-*`、`--accent-*`、`--surface-*`
2. runtime appearance 输入，例如 `--app-surface-opacity`、`--app-surface-backdrop-filter`
3. 组件侧局部颜色实现，例如硬编码 `#hex`、`rgba(...)`、`color-mix(...)` 和直接写死的 `blur(...)`

这导致以下问题：

- 组件可以绕过体系直接选色，颜色规范无法真正收口。
- glass 和 surface opacity 虽然已经支持动态变化，但很多组件仍然在本地重复计算透明背景。
- 状态色、git、diff、badge、icon tone 等领域存在独立配色逻辑，无法保证语义一致。
- 多主题虽然存在，但组件使用的是“颜色实现细节”，而不是统一的语义接口。
- 测试目前能验证局部 token 使用，但不能强约束“组件侧不得定义颜色”。

用户希望建立一套新的颜色体系，满足以下要求：

- 保留现有多主题结构。
- 保留现有 glass / transparency runtime 输入。
- 定义几组固定基础前景色和背景色。
- 组件不能直接接触基础色盘。
- 组件只能使用统一的语义颜色 token。
- 状态色、图标色、git/diff 等领域色也必须收口到同一体系。

## Goals

- 在 `packages/web` 内建立一套新的分层颜色系统。
- 保留现有主题族：`mint`、`graphite`、`nord`、`hc`。
- 保留现有外观运行时输入：`glassEnabled`、`glassIntensity`、`surfaceOpacity`、背景 dim/blur。
- 把基础颜色限制在 token 定义层，组件只能消费语义 token。
- 把动态透明度和 glass blur 收敛到 token/material 层，不允许组件自己计算 alpha 或 blur。
- 把 `git / diff / badge / notice / pill / icon tone` 等领域颜色纳入统一语义体系。
- 最终合入结果不保留旧公开颜色接口作为长期兼容层。
- 增加自动化校验，阻止未来重新引入硬编码颜色或越权 token 使用。

## Non-Goals

- 本次不重新设计 `mint / graphite / nord / hc` 的视觉风格方向。
- 本次不更改 Monaco、xterm 等外部协议所需的配色数据结构。
- 本次不开放用户自定义任意颜色、任意 CSS 或脚本化主题。
- 本次不扩展到 server、CLI 或非 `packages/web` UI 栈。
- 本次不重新设计 spacing、radius、typography 等非颜色体系。
- 本次不改变现有 appearance personalization 的产品能力边界。

## User Decisions Captured

- 保留当前多主题结构，不降级为单主题。
- 组件层采用严格语义消费模式，不允许直接接触基础色盘。
- glass 与透明度属于体系一部分，透明度变化由 token/material 层承接，而不是组件局部计算。
- 透明度控制保持全局统一输入，而不是按区域拆分控制。
- 状态色、图标色、git/diff 等领域色必须收进同一套语义体系。
- 最终方案选择 big-bang rewrite，不保留旧公开颜色接口的长期兼容别名。

## Approaches Considered

### Option A: 在现有 token 上直接修补

继续沿用当前 `--bg-* / --accent-* / --state-* / --ws-*` 结构，仅做硬编码替换与规则加固。

优点：

- 改动最小。
- 迁移速度最快。

缺点：

- 现有 token 命名边界并不干净，基础色与语义色混杂。
- 很难彻底禁止组件直接依赖实现细节。
- 长期仍容易回到“局部补丁式配色”。

### Option B: 新建语义体系并保留兼容 alias

定义新体系，同时用旧变量作为过渡兼容层逐步替换。

优点：

- 风险较低。
- 渐进迁移更容易控制。

缺点：

- 迁移周期更长。
- 旧接口会在一段时间内继续存在，降低体系约束强度。
- 与用户要求的“统一用一套体系、不靠兼容层延续旧接口”不完全一致。

### Option C: Big-bang Rewrite（最终选择）

直接建立新的语义颜色体系，并在一次迁移中替换组件使用入口。最终合入结果不保留旧公开颜色接口。

优点：

- 能得到边界最清晰、最强约束的最终结果。
- 新体系可以从一开始就按“reference 私有、semantic 公开”组织。
- 最符合用户对“所有地方都只能用这套体系颜色”的要求。

缺点：

- 回归风险最高。
- 对 workspace/material、shared shell、state domains 的联动要求最高。
- 必须依赖严格的迁移顺序和自动化校验，不能只靠人工 review。

## Final Choice

采用 Option C。

需要额外明确一个执行约束：

- 最终合入到主分支的结果不保留旧公开颜色接口。
- 实现分支内允许存在极短暂的过渡映射或中间状态，以支持分步骤提交和验证。
- 但在 merge 前，所有旧公开颜色接口、组件侧原始颜色实现、组件侧 material math 都必须清零。

这使得 big-bang rewrite 在工程上可执行，同时保持最终边界足够硬。

## Design Principles

### 1. 组件只消费语义，不消费颜色实现细节

组件层只能引用语义 token，不能引用基础色盘，不能引用 runtime appearance 输入，也不能自行生成颜色。

### 2. 透明度变化是系统能力，不是组件能力

glass、surface opacity、blur 都属于 material 层能力。组件只消费最终 surface/material token。

### 3. 状态色属于颜色系统的一等公民

`success / warning / danger / info` 不再只是辅助色，而是统一语义体系的一部分。所有 badge、notice、git、diff、icon tone 都从该层派生。

### 4. 主题只负责 reference 层

不同主题之间只切换基础色值与协议级颜色。组件语义接口必须在所有主题下保持稳定。

### 5. 协议例外隔离

Monaco、xterm、浏览器协议兼容这类特殊场景可以保留颜色实现细节，但必须局限在协议适配层，不能泄漏到组件配色接口。

## Final Design

### 1. Token Layering

新的颜色系统分为四层。

#### 1.1 Reference Layer（私有基础色盘）

Reference layer 只允许定义在 [tokens.css](/home/spencer/workspace/coder-studio/packages/web/src/styles/tokens.css:1) 中，供 semantic/material/domain layers 派生使用。

建议采用固定阶梯形式，至少包含：

- 前景色阶梯
  - `--ref-fg-0`
  - `--ref-fg-1`
  - `--ref-fg-2`
  - `--ref-fg-3`
  - `--ref-fg-inverse`
- 背景色阶梯
  - `--ref-bg-0`
  - `--ref-bg-1`
  - `--ref-bg-2`
  - `--ref-bg-3`
  - `--ref-bg-4`
  - `--ref-bg-5`
  - `--ref-bg-6`
- 边框色阶梯
  - `--ref-border-0`
  - `--ref-border-1`
  - `--ref-border-2`
  - `--ref-border-focus`
  - `--ref-border-danger`
- 状态基色
  - `--ref-status-success`
  - `--ref-status-warning`
  - `--ref-status-danger`
  - `--ref-status-info`

职责：

- 提供每个主题下稳定的基础颜色素材。
- 承担最终 semantic/material/domain token 的唯一颜色输入。

非职责：

- 组件不得直接使用 `--ref-*`。

#### 1.2 Semantic Layer（唯一公开颜色接口）

Semantic layer 是组件唯一允许消费的通用颜色接口。

建议至少包含：

- 文本
  - `--text-primary`
  - `--text-secondary`
  - `--text-tertiary`
  - `--text-disabled`
  - `--text-inverse`
- Surface
  - `--surface-page`
  - `--surface-panel`
  - `--surface-elevated`
  - `--surface-input`
  - `--surface-muted`
  - `--surface-hover`
  - `--surface-active`
  - `--surface-disabled`
- Border
  - `--border-default`
  - `--border-subtle`
  - `--border-strong`
  - `--border-focus`
  - `--border-danger`
- Status
  - `--status-success-fg`
  - `--status-success-bg`
  - `--status-success-border`
  - `--status-success-icon`
  - `--status-warning-fg`
  - `--status-warning-bg`
  - `--status-warning-border`
  - `--status-warning-icon`
  - `--status-danger-fg`
  - `--status-danger-bg`
  - `--status-danger-border`
  - `--status-danger-icon`
  - `--status-info-fg`
  - `--status-info-bg`
  - `--status-info-border`
  - `--status-info-icon`

职责：

- 作为普通组件的唯一公开颜色 API。
- 统一文本、surface、border、status 的语义定义。

#### 1.3 Material Layer（透明与 glass 输出层）

Material layer 接收 runtime appearance 输入，并产出组件可消费的最终材质 token。

运行时输入保持现有形态：

- `data-appearance-glass`
- `--app-surface-opacity`
- `--app-surface-backdrop-filter`

但这些输入只允许在 token/material 定义层使用，不允许组件直接引用。

建议至少产出：

- 通用 material
  - `--material-panel`
  - `--material-elevated`
  - `--material-overlay`
  - `--material-local-overlay`
  - `--material-backdrop-filter`
- workspace shell surfaces
  - `--workspace-sidebar-surface`
  - `--workspace-activitybar-surface`
  - `--workspace-statusbar-surface`
  - `--workspace-session-surface`
  - `--workspace-session-active-surface`
  - `--workspace-session-header-surface`
  - `--workspace-terminal-shell-surface`
  - `--workspace-terminal-toolbar-surface`
  - `--workspace-terminal-tabs-surface`
  - `--workspace-editor-shell-surface`
  - `--workspace-editor-toolbar-surface`

职责：

- 统一承接 glass on/off、surface opacity、blur 的变化。
- 统一输出 workspace 和 global shells 最终使用的材质颜色。

非职责：

- 组件不得在本地用 `color-mix(...)` 或 alpha 计算 material。

#### 1.4 Domain-Derived Layer（领域派生语义）

这层负责把通用状态与 semantic 色映射为具体业务领域颜色，供特定组件消费。

至少包括：

- Git
  - `--git-status-added-fg/bg/border`
  - `--git-status-modified-fg/bg/border`
  - `--git-status-deleted-fg/bg/border`
  - `--git-status-untracked-fg/bg/border`
  - `--git-status-renamed-fg/bg/border`
- Diff
  - `--diff-added-fg/bg/border`
  - `--diff-modified-fg/bg/border`
  - `--diff-deleted-fg/bg/border`
- Icon tones
  - `--icon-primary`
  - `--icon-secondary`
  - `--icon-muted`
  - `--icon-success`
  - `--icon-warning`
  - `--icon-danger`
  - `--icon-info`
  - 文件类型 tone 与 git tone

职责：

- 防止业务领域组件各自挑色。
- 保持 git/diff/badge/icon 等系统内部语义一致。

### 2. Theme Responsibilities

主题切换仍保留在现有 theme system 中，但职责边界改为：

- `tokens.css` 中按 `data-theme` 为 `--ref-*` 赋值。
- semantic/material/domain-derived tokens 从 `--ref-*` 派生。
- [theme/registry.ts](/home/spencer/workspace/coder-studio/packages/web/src/theme/registry.ts:1) 继续负责：
  - terminal theme
  - Monaco theme
  - icon theme registry

这些协议级颜色不是组件配色入口，不参与组件颜色消费约束。

### 3. Appearance Runtime Integration

现有 appearance personalization 与 document application 链路保留：

- [personalization.ts](/home/spencer/workspace/coder-studio/packages/web/src/appearance/personalization.ts:1)
- [document.ts](/home/spencer/workspace/coder-studio/packages/web/src/appearance/document.ts:17)
- [settings-page.tsx](/home/spencer/workspace/coder-studio/packages/web/src/features/settings/components/settings-page.tsx:2238)

保留原因：

- `surfaceOpacity` 已经是用户可配置能力。
- `glassIntensity` 已经是用户可配置能力。
- high-contrast 主题已经具备 glass disable 逻辑。

新体系只改变一件事：

- runtime appearance 只负责写输入变量。
- 最终 surface/material 颜色全部由 token 层解析。

组件不再直接使用：

- `--app-surface-opacity`
- `--app-surface-backdrop-filter`
- `data-appearance-glass` 的局部判断

### 4. Allowed Definition Boundaries

只有以下文件或区域允许定义颜色实现细节：

- [tokens.css](/home/spencer/workspace/coder-studio/packages/web/src/styles/tokens.css:1)
  - reference layer
  - semantic mappings
  - material formulas
  - domain-derived mappings
- [theme/registry.ts](/home/spencer/workspace/coder-studio/packages/web/src/theme/registry.ts:1)
  - Monaco/xterm/icon protocol colors
- [document.ts](/home/spencer/workspace/coder-studio/packages/web/src/appearance/document.ts:17)
  - runtime appearance inputs only

其他组件样式与 UI 文件均不得定义颜色实现细节。

### 5. Consumer Rules

以下文件或区域只能消费 semantic/material/domain-derived tokens：

- [base.css](/home/spencer/workspace/coder-studio/packages/web/src/styles/base.css:1)
- [components.css](/home/spencer/workspace/coder-studio/packages/web/src/styles/components.css:1)
- `packages/web/src/components/ui/**/*.module.css`
- `packages/web/src/features/**/*.css`
- `packages/web/src/**/*.tsx` 内的 inline style

这些位置禁止：

- `#hex`
- `rgb()` / `rgba()`
- `hsl()` / `hsla()`
- `oklch()`
- `color-mix()`
- 直接使用 `--ref-*`
- 直接使用 `--app-surface-opacity`
- 直接使用 `--app-surface-backdrop-filter`
- 局部写死 `blur(...)`

允许保留的非颜色关键字：

- `transparent`
- `currentColor`
- `inherit`
- `none`

### 6. Big-Bang Scope of Replacement

本次替换不是“替换掉少量硬编码”，而是“替换整个组件侧公开颜色接口”。

最终合入结果中，不应继续存在作为组件接口使用的旧公开颜色体系，例如：

- `--bg-*`
- `--accent-*`
- `--color-*`
- 旧的 `--ws-*` 简写 material surfaces

如果某个现有 token 名称本身已经符合新语义边界，例如 `--text-primary`，可以保留其名称，但必须重新纳入新 semantic layer 定义，而不是作为历史体系的例外。

## Migration Strategy

### Phase 1: Rebuild the token system

在 [tokens.css](/home/spencer/workspace/coder-studio/packages/web/src/styles/tokens.css:1) 中重建新层级：

- reference layer
- semantic layer
- material layer
- domain-derived layer

先让所有主题完成 `--ref-*` 映射，再由这些 reference tokens 推出 semantic/material/domain tokens。

### Phase 2: Centralize material outputs

保留 runtime appearance 输入链路，但把最终面色与 blur 输出全部集中到 token 层。

目标：

- [base.css](/home/spencer/workspace/coder-studio/packages/web/src/styles/base.css:1) 不再直接引用 `--app-surface-opacity`
- [components.css](/home/spencer/workspace/coder-studio/packages/web/src/styles/components.css:1) 不再直接引用 `--app-surface-opacity`
- [components.css](/home/spencer/workspace/coder-studio/packages/web/src/styles/components.css:1) 不再直接引用 `--app-surface-backdrop-filter`
- glass enabled/disabled/high-contrast 都通过 material tokens 统一反映

### Phase 3: Replace shared shells first

优先迁移回归风险最高、影响面最大的共享 shell：

- app loading shell
- settings shell
- modal / drawer / sheet / local overlay
- workspace shell
- terminal shell
- editor shell

原因：

- 这些区域最容易直接写 transparency math
- 这些区域与 glass/material 强相关
- 如果不先迁这层，后续组件迁移会持续依赖旧 surface 接口

### Phase 4: Replace workspace material consumers

把最近新增或正在演进的 workspace material surface 一次性切换到新 material/workspace semantic tokens。

包括：

- sidebar
- activity bar
- status bar
- session cards
- session headers
- terminal toolbar / tabs / shells
- editor toolbar / shells

重点目标：

- 清理当前 `components.css` 中仍然残留的 component-local material formulas
- 清理直接写死的 blur 值

### Phase 5: Replace state/domain consumers

统一替换所有状态与领域色使用方：

- git status chips / rows / badges
- diff lines / panes
- notice / toast / badge / pill / tag
- file and git icon tones
- empty states / notices / warning banners

目标：

- 组件不再自己决定“warning 到底该用哪个黄”
- renamed/untracked 等当前无统一语义来源的颜色必须有明确 domain-derived token

### Phase 6: Replace module CSS and TSX inline colors

迁移所有 `components/ui/**/*.module.css` 与 `features/**` 内联样式。

目标：

- 不留下“全局样式收口了，但局部模块还在自己写色”的尾巴

### Phase 7: Remove old public color interfaces

最终删除或停止暴露旧公开颜色接口，并确保组件侧引用全部切换完成。

这一步完成后，仓库不应再依赖历史颜色 API。

## Validation and Enforcement

这次迁移必须引入硬性校验，不能只靠人工 code review。

### 1. Consumer-side raw color guard

对 production UI 样式与组件文件做扫描：

- 禁止 `#hex`
- 禁止 `rgb/rgba`
- 禁止 `hsl/hsla`
- 禁止 `oklch`
- 禁止 `color-mix`

白名单仅限：

- `tokens.css`
- `theme/registry.ts`
- 协议级例外文件

### 2. Reference token guard

除 `tokens.css` 外，禁止任何文件直接使用 `--ref-*`。

### 3. Runtime appearance input guard

除 `tokens.css`、`document.ts` 和协议级确有必要的极少数适配层外，禁止引用：

- `--app-surface-opacity`
- `--app-surface-backdrop-filter`

### 4. Legacy interface guard

在迁移完成后，增加检查确保旧公开颜色接口不再被组件消费。

### 5. Theme and appearance regression coverage

至少验证以下矩阵：

- `mint-dark`
- `mint-light`
- `graphite-dark`
- `graphite-light`
- `nord-dark`
- `nord-light`
- `hc-dark`
- `hc-light`

以及以下外观状态：

- glass off
- glass on
- surface opacity 低值
- surface opacity 高值
- high-contrast 主题下 glass 自动绕过

### 6. Shared stylesheet tests

扩展现有主题测试：

- [base.theme.test.ts](/home/spencer/workspace/coder-studio/packages/web/src/styles/base.theme.test.ts:1)
- [components.theme.test.ts](/home/spencer/workspace/coder-studio/packages/web/src/styles/components.theme.test.ts:1)

并新增 guard 级测试，验证：

- 组件侧无原始颜色
- 组件侧无越权 token
- 组件侧无 material math

## Risks and Mitigations

### Risk 1: Workspace material regressions

原因：

- workspace/material 最近仍在演进
- surface、blur、background-image pass-through 高耦合

缓解：

- 先迁共享 shell，再迁 workspace consumers
- 保留 workspace preview coverage
- 强制验证 glass on/off 和 high-contrast

### Risk 2: Big-bang rename churn

原因：

- token 改名会带来大范围替换

缓解：

- reference/semantic/material/domain layering 先落定，再做消费替换
- 迁移顺序固定，不允许一边设计一边随处替换
- 合并前统一执行全仓扫描

### Risk 3: Protocol layers accidentally pulled into UI rules

原因：

- Monaco/xterm 的色值需求和 UI semantic API 不同

缓解：

- 在 spec 中明确协议例外边界
- `theme/registry.ts` 继续作为协议配色容器，不把它当组件颜色入口

### Risk 4: Temporary transition code leaking into mainline

原因：

- big-bang 过程中实现分支可能出现短暂过渡映射

缓解：

- 明确要求最终 merge 结果清零
- 用 legacy interface guard 阻止遗留接口残存

## Acceptance Criteria

迁移完成后，以下条件必须全部成立：

- 所有 production UI 组件只消费 semantic/material/domain-derived tokens。
- 组件侧不存在原始颜色值和颜色公式。
- glass 与 surface opacity 的变化只在 token/material 层计算。
- 所有主题都可以通过同一套组件语义接口渲染。
- `git / diff / badge / notice / icon tone` 都有统一语义来源。
- 高对比主题仍然能绕过 glass 行为。
- 最终合入树中不存在旧公开颜色接口的组件消费。

## Open Questions

无。

本次设计已经确认以下关键选择：

- 多主题保留
- glass/runtime appearance 保留
- 基础前景/背景色盘只作为私有 reference 层
- 组件只允许消费语义 token
- 状态色与领域色纳入统一体系
- 最终合入结果采用 big-bang rewrite，不保留旧公开颜色接口
