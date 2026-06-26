# Mobile Agent Provider Monogram Design

Date: 2026-06-20
Status: Draft
Owner: codex

## Problem

移动端 `Select Agent` 页面里的 provider 图标样式现在不统一：

- `Claude` 和 `Codex` 使用语义图形图标
- `Gemini`、`Cursor`、`OpenCode` 使用两位大写字母 monogram

这会让同一列表里的视觉语言不一致。用户希望这个页面统一为：

- 所有 provider 都使用“前两个字母大写”作为 icon
- icon 颜色保持各自 provider 的主题色
- 只调整移动端页面，不改 PC 端现有表现

## Goals

- 统一移动端 `Select Agent` 页面中全部 provider 的 icon 形式。
- 所有 provider 使用两位大写字母 monogram。
- monogram 的颜色和背景保持 provider 主题色风格。
- 仅修改移动端入口，不影响桌面端或其他 Agent 入口。
- 保持现有列表文案、启动逻辑、禁用态、诊断入口不变。

## Non-Goals

- 不修改桌面端 draft launcher 或其他 PC 端 provider 选择 UI。
- 不引入新的 provider 图形图标。
- 不重做 provider 卡片布局、间距或交互逻辑。
- 不扩展全局 theme semantic 体系到所有 provider。

## Current Context

移动端 provider 选择页位于：

- [`packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`](../../../packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx)

当前逻辑分为两类：

- `claude` / `codex` 命中 `PROVIDER_ICON_SEMANTICS`，渲染 `ThemedIcon`
- 其他 provider 回退为 `.agent-provider-card-monogram` 文本样式

这意味着当前列表同时混用了“图形 icon”和“文字 monogram”两套表现。

移动端列表项公共结构来自：

- [`packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx`](../../../packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx)
- [`packages/web/src/styles/components.css`](../../../packages/web/src/styles/components.css)

其中 `.mobile-select-sheet__item-icon` 只负责图标容器排版，不区分 provider 身份。因此如果要给 provider monogram 加主题色，最稳妥的方式是在 `mobile-agent-sheet.tsx` 中输出带 provider 修饰类的专用节点，而不是改动整个移动端选择器的通用 icon 行为。

## User Decisions Captured

- 仅处理移动端页面。
- PC 端当前效果正常，不应改动。
- 所有 provider 统一使用前两个字母大写。
- icon 使用各自 provider 的主题色。

## Approaches Considered

### Option A: 仅在移动端统一为 provider monogram，并按 provider id 加主题色（推荐）

核心思路：

- 去掉移动端 `claude` / `codex` 的语义图形 icon 分支
- 所有 provider 都走统一的 monogram 渲染
- 在移动端 provider icon 节点上附加 `provider id` 修饰类，提供主题色

优点：

- 改动范围最小
- 完全符合用户要求
- 只影响移动端页面，不会波及 PC 端
- 不需要扩展全局 icon semantic

缺点：

- provider 主题色映射需要在移动端页或其配套样式中维护一份轻量定义

### Option B: 提取共享 provider monogram 组件，移动端和桌面端共用

优点：

- 后续复用性更强

缺点：

- 会触碰桌面端共享逻辑
- 即使桌面端 UI 最终不变，也会扩大这次改动范围
- 不符合“不要动 PC 端”的边界

### Option C: 扩展全局 icon semantic，让所有 provider 继续走 `ThemedIcon`

优点：

- 主题系统更完整

缺点：

- 需求目标是“统一为前两个字母大写”，不是增加更多图形 icon
- 需要修改 theme semantic 和 registry，范围偏大
- 对当前问题来说属于过度设计

## Final Choice

采用 Option A。

这次改动将把移动端 `Select Agent` 页面中的所有 provider icon 统一为两位大写 monogram，并通过 provider-specific 样式让颜色保持主题化。PC 端和其他入口不做任何行为或样式调整。

## Final UX

在移动端 `Select Agent` 页面中：

- `Claude` 显示 `CL`
- `Codex` 显示 `CO`
- `Gemini` 显示 `GE`
- `Cursor` 显示 `CU`
- `OpenCode` 显示 `OP`

icon 视觉规则：

- 使用一致的字母 icon 尺寸、圆角、字重和对齐方式
- 每个 provider 通过主题色区分前景色、背景色和必要的边框混色
- 列表中的文本、描述、meta、诊断按钮、点击行为保持现状

## Implementation Design

### Rendering

`mobile-agent-sheet.tsx` 中的 provider icon 渲染将改为单一路径：

- 删除 `PROVIDER_ICON_SEMANTICS`
- 新增 provider monogram 计算函数
- 新增 provider icon class 计算函数
- 对所有 provider 输出统一的 monogram 节点

建议渲染结构：

```tsx
<span
  aria-hidden="true"
  className={`mobile-agent-provider-icon mobile-agent-provider-icon--${provider.id}`}
>
  <span className="mobile-agent-provider-icon__label">CL</span>
</span>
```

这个结构只在移动端 agent sheet 中使用，不进入通用 `MobileSelectSheet`。

### Monogram Rules

monogram 文案取 provider label 的前两个可见字符并转大写。对当前已知 provider，结果应为：

- `Claude` -> `CL`
- `Codex` -> `CO`
- `Gemini` -> `GE`
- `Cursor` -> `CU`
- `OpenCode` -> `OP`

这里应基于当前显示 label 生成，而不是对 provider id 写死文案映射；这样后续 provider 扩展仍可自动回退为“两位字母”。

### Styling

在 [`packages/web/src/styles/components.css`](../../../packages/web/src/styles/components.css) 中增加仅供移动端页面使用的专用类：

- `.mobile-agent-provider-icon`
- `.mobile-agent-provider-icon__label`
- `.mobile-agent-provider-icon--claude`
- `.mobile-agent-provider-icon--codex`
- `.mobile-agent-provider-icon--gemini`
- `.mobile-agent-provider-icon--cursor`
- `.mobile-agent-provider-icon--opencode`

基础样式负责：

- 固定宽高
- 居中
- 圆角
- monospace / semibold 视觉
- 字号与现有移动端行高匹配

provider 修饰类负责：

- `color`
- `background`
- 需要时的 `border`

这些颜色不应通过修改 `.mobile-select-sheet__item-icon` 全局规则实现，以免影响其他移动端选择器。

### Data Flow

现有 provider 列表、runtime state、busy 状态、诊断入口都保持不变。改动只发生在 `providerSections` 中的 `icon` 生成逻辑。

不会改变：

- `useProviderLauncher` 返回的数据
- `launch(id)` 调用
- `guideMessage` 文案
- `busy` / `disabled` 判定

### Error Handling

这个变更没有新增异步流程。主要需要保证：

- provider label 为空时仍能回退到 provider id
- monogram 生成函数不会输出空字符串

回退策略：

- 先取 `badge`
- 再取 `displayName`
- 再取 `id`
- 取值后裁剪前两个字符并转大写

## Testing

需要更新和补充的验证重点：

### Unit / Component Tests

更新：

- [`packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx`](../../../packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx)

覆盖点：

- `Claude` 和 `Codex` 不再渲染 `data-icon-semantic="agent.provider.*"`
- 所有 provider 都渲染两位大写字母
- `Gemini` 点击仍然触发 `launch("gemini")`
- provider 缺失 runtime state 时仍然跳过，不影响渲染稳定性

如样式测试已覆盖移动端 command 列表 icon 表现，可按需补充：

- 仅验证新类存在，不对具体颜色值做过度脆弱断言

### Manual Verification

手工检查移动端 `Select Agent` 页面：

- 所有 provider icon 形式一致
- `Claude` / `Codex` 颜色仍有清晰区分
- `Gemini` / `Cursor` / `OpenCode` 颜色符合主题化预期
- 长文案、禁用态、诊断按钮未发生布局回归

## Risks

- provider 主题色如果直接硬编码在样式中，后续新增 provider 需要补对应修饰类。
- 不同 theme 下如果某个 provider 色对比度不足，可能需要轻调背景混色比例。
- 基于显示 label 截取前两个字符时，若未来某个 provider 使用非拉丁前缀，monogram 规则可能需要单独定义。

## Acceptance Criteria

- 移动端 `Select Agent` 页中所有 provider 都显示两位大写字母 icon。
- 每个 provider 的 icon 都有各自主题色，而不是统一颜色。
- `Claude` 和 `Codex` 不再显示图形 icon。
- 仅移动端页面发生变化，PC 端 UI 不变。
- 现有 provider 启动和诊断行为保持不变。
