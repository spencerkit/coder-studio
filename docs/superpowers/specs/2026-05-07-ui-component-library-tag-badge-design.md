# UI 组件库 v1 · Tag + Badge Slice 设计

> **日期：** 2026-05-07
> **状态：** Draft
> **范围：** `Tag`、`Badge`，以及一组真实标签/计数调用点迁移

---

## 1. 背景

`Button`、`Input`、`Textarea`、`Pill`、`Kbd`、`StatusDot`、`Spinner` 已经在前几轮按 parity-first 路线落地。下一轮继续保持小切片，只处理：

- 视觉规则稳定
- 调用点集中
- 不依赖 Tier 1 / Tier 2 浮层基础设施
- 能继续减少业务侧手写标签类名

当前 codebase 里与“badge”相关的 UI 实际分成两类：

- 文本标签：主要来自 `.badge .badge-*`
- 计数徽标：主要来自 topbar 的 `unreadCount` 小圆角数字徽标

因此本轮把这两类拆成两个共享组件：

- `Tag`：文本标签原语
- `Badge`：计数徽标原语

## 2. 目标

本轮只完成一个 parity-first labels slice：

- 在 `packages/web/src/components/ui/` 下新增 `Tag` 与 `Badge`
- `Tag` 以现有 `.badge .badge-*` 为基础，同时允许 feature 通过 `className` 保留现有微调样式
- `Badge` 以 topbar unread count 视觉为基础，支持数值截断显示
- 迁移真实调用点：
  - `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
    - provider tag
    - session state tag
  - `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
    - `DRAFT` tag
  - `packages/web/src/features/workspace/views/shared/branch-quick-pick.tsx`
    - remote tag
  - `packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx`
    - item badge/tag
  - `packages/web/src/features/topbar/components/tab.tsx`
    - unread count badge
- 更新 `README.md`、`MIGRATION.md`、public barrel

## 3. 非目标

这轮不做下面这些事情：

- 不处理 `git-row-status-*`
- 不处理 `supervisor-state-tag`
- 不处理 `mobile-supervisor-badge`
- 不处理 `agent-badge`
- 不删除 `packages/web/src/styles/components.css` 里的 legacy `.badge*`、`branch-quick-pick-badge`、`mobile-select-sheet__item-badge`、`topbar-unread`

## 4. API 范围

### 4.1 Tag

本轮 `Tag` 只提供当前 codebase 已经明确需要的能力：

- `color?: "blue" | "green" | "amber" | "pink" | "purple" | "neutral"`，默认 `neutral`
- `size?: "sm" | "md"`，默认 `md`
- `caps?: boolean`，默认 `true`
- `className?: string`
- 透传原生 `<span>` 属性

本轮明确延期：

- `removable`
- `onRemove`
- 图标前后缀

理由：当前真实调用点都不需要可删除标签，先把视觉 parity 和语义命名稳定下来。

### 4.2 Badge

当前代码里真正成熟的共享需求是“计数徽标”，不是另一套通用文本标签。因此本轮 `Badge` 只提供：

- `count: number`
- `max?: number`，默认 `99`
- `className?: string`
- 透传原生 `<span>` 属性

显示规则：

- `count <= 0` 时返回 `null`
- `count > max` 时显示 `${max}+`

这意味着更早设计表格中“`Badge` = dot | count”的表述对当前代码来说过宽，并且与 `StatusDot` 有重叠；本轮只落真实需要的 count badge。

## 5. 样式策略

继续沿用前几轮已经验证过的模式：

- 每个组件一个目录：`index.tsx`、`index.module.css`、`index.test.tsx`、`README.md`
- CSS Module 中保留本地类和必要的 `:global()` legacy alias
- React 组件继续附加兼容类，保证旧 feature 微调样式还能命中

关键点：

- `Tag` 保留 `.badge` 与 `.badge-*` 兼容
- `Tag` 的 `caps={false}` 用于 `Remote`、selector item badge 这类不应自动大写的调用点
- `Badge` 采用 topbar unread 的视觉基线，不要求保留单独 legacy class

## 6. 迁移目标

### 6.1 SessionCard / DraftLauncher

当前：

```tsx
<span className="badge badge-blue session-provider-badge">{providerLabel}</span>
<span className={`session-state-badge ${getSessionBadgeClass(session.state)}`}>{label}</span>
<span className="session-state-badge badge badge-gray">DRAFT</span>
```

迁移后：

```tsx
<Tag color="blue" className="session-provider-badge">{providerLabel}</Tag>
<Tag color={...} className="session-state-badge">{label}</Tag>
<Tag color="neutral" className="session-state-badge">DRAFT</Tag>
```

要求：

- 保持现有 feature 特化 class 命中
- 保持大小、圆角、大小写行为不回归

### 6.2 BranchQuickPick / MobileSelectSheet

当前：

```tsx
<span className="branch-quick-pick-badge">Remote</span>
<span className="mobile-select-sheet__item-badge">{item.badge}</span>
```

迁移后：

```tsx
<Tag color="neutral" caps={false} className="branch-quick-pick-badge">Remote</Tag>
<Tag color="neutral" caps={false} className="mobile-select-sheet__item-badge">{item.badge}</Tag>
```

要求：

- 保持 Title Case 文案，不应被自动转成全大写
- 保持 feature 自己的布局/圆角/配色微调

### 6.3 WorkspaceTab unread count

当前：

```tsx
<span className="topbar-unread">{workspace.unreadCount > 9 ? "9+" : workspace.unreadCount}</span>
```

迁移后：

```tsx
<Badge count={workspace.unreadCount} max={9} />
```

要求：

- `0` 时不渲染
- `10` 显示 `9+`
- 不改变 tab 的点击和关闭行为

## 7. 测试与验收

至少覆盖：

- `Tag` 单测：
  - 默认渲染
  - `color`
  - `size`
  - `caps={false}`
  - legacy class 兼容
- `Badge` 单测：
  - 正常计数
  - `count <= 0` 不渲染
  - `max` 截断
- 真实调用点测试：
  - `features/agent-panes/components/session-card.test.tsx`
  - `features/workspace/views/shared/branch-quick-pick.test.tsx`
  - `features/mobile-select/components/mobile-select-sheet.test.tsx`
  - `features/topbar/components/tab.test.tsx`

验收标准：

- 目标测试集通过
- `biome check` 不引入新增问题
- session card、branch quick pick、mobile select、topbar tab 无明显视觉回归

## 8. 完成定义

以下条件同时满足才算本 slice 完成：

- `Tag` 与 `Badge` 已从 `src/components/ui/index.ts` 公开导出
- `README.md` 与 `MIGRATION.md` 已更新状态和 caller 数
- 上述真实调用点已经迁移
- 所有相关测试通过
- 变更位于独立 worktree / feature branch，可独立 review 与合并
