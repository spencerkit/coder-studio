# UI 组件库 v1 · Display Primitives Slice 设计

> **日期：** 2026-05-07
> **状态：** Draft
> **范围：** `Pill`、`Kbd`、`StatusDot`、`Spinner`，以及对应真实调用点迁移

---

## 1. 背景

`Button`、`Input`、`Textarea` 已经在前两轮落地，public barrel、CSS Module + legacy alias、worktree + subagent 的执行路径也已经验证可行。下一轮继续沿用同样的窄切片策略，优先处理：

- 视觉规则简单
- 调用点集中
- 不依赖 Tier 1 / Tier 2 浮层基础设施
- 能直接减少业务侧手写 className

本轮符合条件的组件是显示类原语：

- `Pill`
- `Kbd`
- `StatusDot`
- `Spinner`

## 2. 目标

本轮只完成一个 parity-first display slice：

- 在 `packages/web/src/components/ui/` 下新增 `Pill`、`Kbd`、`StatusDot`、`Spinner`
- 从 legacy `.settings-pill*`、`kbd` / `.shortcuts-key`、状态 dot pattern、`.animate-spin` 中抽出共享基础样式
- 保留 legacy class 兼容层，保证旧调用点和新组件并存
- 迁移真实业务调用点：
  - `packages/web/src/features/settings/components/settings-page.tsx` 的 appearance pills 迁到 `Pill`
  - `packages/web/src/features/settings/components/shortcuts-settings.tsx` 的快捷键展示迁到 `Kbd`
  - `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
  - `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
  - `packages/web/src/features/topbar/components/connection-status.tsx`
    的状态点迁到 `StatusDot`
  - `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
    的加载态 spinner 迁到 `Spinner`
- 更新 `README.md`、`MIGRATION.md`、public barrel

## 3. 非目标

这轮不做下面这些事情：

- 不处理 `Tag` / `Badge` 的业务语义分流
- 不迁移 `mobile-topbar__session-dot`、`workspace-tab-dot` 等移动或其它 feature 特化变体
- 不删除 `packages/web/src/styles/components.css` 里的 legacy `.settings-pill*`、`.session-dot*`、`.connection-status-dot*`、`.shortcuts-key`、`.animate-spin`
- 不重构 `Select` / `SegmentedControl` / `Tabs`

## 4. API 范围

### 4.1 Pill

本轮 `Pill` 只提供当前 codebase 已经需要的能力：

- `active?: boolean`
- `disabled?: boolean`
- `leadingIcon?: ReactNode`
- `className?: string`
- 透传原生 `<button>` 属性

明确延期：

- `asChild`
- `toggle group` 级别状态管理
- `aria-pressed` 之外的高级选择器封装

### 4.2 Kbd

本轮 `Kbd` 提供：

- `size?: "sm" | "md"`，默认 `md`
- `interactive?: boolean`
- `className?: string`
- 透传原生 `<kbd>` 属性

当前主要服务快捷键显示，不做多片组合封装。

### 4.3 StatusDot

本轮 `StatusDot` 提供：

- `tone?: "success" | "warning" | "error" | "info" | "neutral"`，默认 `neutral`
- `size?: "sm" | "md" | "lg"`，默认 `md`
- `pulse?: boolean`
- `className?: string`

当前只封装可复用的圆点视觉和动画，不承诺统一所有 feature 的组合文案/容器。

### 4.4 Spinner

本轮 `Spinner` 提供：

- `size?: "sm" | "md" | "lg"`，默认 `md`
- `label: string`，作为 a11y 文案必填
- `className?: string`

它只负责共享 spinner 视觉，不负责 button loading 场景外层布局。

## 5. 样式策略

继续沿用前两轮已经验证过的模式：

- 每个组件一个目录：`index.tsx`、`index.module.css`、`index.test.tsx`、`README.md`
- CSS Module 中保留本地类和必要的 `:global()` legacy alias
- React 组件继续附加 legacy class，让 feature 特化 CSS 继续命中

关键点：

- `Pill` 保留 `.settings-pill` / `.settings-pill-active` 兼容
- `Kbd` 保留 `kbd` 基础语义，并兼容 `.shortcuts-key`
- `StatusDot` 保留 `.session-dot*`、`.connection-status-dot*` 命中能力
- `Spinner` 保留 `.animate-spin`

## 6. 迁移目标

### 6.1 Settings appearance pills

当前：

```tsx
<button className={`settings-pill ${active ? "settings-pill-active" : ""}`}>...</button>
```

迁移后：

```tsx
<Pill active={active}>...</Pill>
```

要求：

- 保持现有点击逻辑
- 保持选中时的图标和文本布局
- 现有 `.settings-pill*` 选择器仍能命中

### 6.2 Shortcuts key display

当前：

```tsx
<kbd className="shortcuts-key">⌘+K</kbd>
```

迁移后：

```tsx
<Kbd className="shortcuts-key" interactive>⌘+K</Kbd>
```

要求：

- 保持点击进入 capture 模式
- 保持 feature 的 hover 样式和最小宽度

### 6.3 Session and connection status dots

当前：

```tsx
<span className={`session-dot ${getSessionDotClass(session.state)}`} />
<span className={`connection-status-dot connection-status-dot-${status}`} />
```

迁移后：

```tsx
<StatusDot ... />
```

要求：

- 保持 tone 和 pulse 语义
- 保持 feature 专属 className 挂点

### 6.4 Workspace launch loading indicator

当前：

```tsx
<Loader2 size={16} className="animate-spin" />
```

迁移后：

```tsx
<Spinner label="Loading directories" />
```

要求：

- 保持纯加载反馈行为
- 不改变父容器布局

## 7. 测试与验收

至少覆盖：

- `Pill` 单测：
  - 默认渲染
  - `active` / `disabled`
  - legacy class 兼容
- `Kbd` 单测：
  - 默认渲染
  - `interactive`
  - legacy class 兼容
- `StatusDot` 单测：
  - tone / size / pulse
  - legacy class 兼容
- `Spinner` 单测：
  - a11y label
  - size
  - legacy class 兼容
- 真实调用点测试：
  - `features/settings/components/settings-page.test.tsx`
  - `features/agent-panes/components/session-card.test.tsx`
  - `features/workspace/views/shared/workspace-launch-modal.test.tsx`

验收标准：

- 目标测试集通过
- `pnpm lint` 不引入新增 warning/error
- settings、session card、workspace launch 三个调用点无明显视觉回归

## 8. 完成定义

以下条件同时满足才算本 slice 完成：

- `Pill`、`Kbd`、`StatusDot`、`Spinner` 已从 `src/components/ui/index.ts` 公开导出
- `README.md` 与 `MIGRATION.md` 已更新状态和 caller 数
- 本轮选定的真实调用点已经迁移
- 所有相关测试通过
- 变更位于独立 worktree / feature branch，可独立 review 与合并
