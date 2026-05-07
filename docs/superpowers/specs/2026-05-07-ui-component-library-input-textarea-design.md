# UI 组件库 v1 · Input + Textarea Slice 设计

> **日期：** 2026-05-07
> **状态：** Draft
> **范围：** `Input`、`Textarea`、两个真实调用点迁移

---

## 1. 背景

`Button` 已经作为 Phase A 落地，`packages/web/src/components/ui/` 的骨架、public barrel、`MIGRATION.md`、`useViewport()` 迁移路径都已经打通。下一步继续按窄切片推进 Tier 0，优先处理：

- 复用频率高
- 视觉规则简单
- 已经有明确真实调用点
- 不依赖 Tier 1 / Tier 2 浮层基础设施

符合这组条件的是 `Input` 和 `Textarea`。

## 2. 目标

本轮只完成一个 parity-first slice：

- 在 `packages/web/src/components/ui/` 下新增 `Input` 与 `Textarea`
- 从 legacy `.input` / `.input.textarea` 抽出对应 CSS 到 CSS Modules
- 保留 legacy class 兼容层，保证新旧调用点可以并存
- 迁移两个真实调用点：
  - `packages/web/src/features/auth/index.tsx` 的密码输入框迁到 `Input`
  - `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx` 的目标描述框迁到 `Textarea`
- 更新 `README.md`、`MIGRATION.md`、public barrel

## 3. 非目标

这轮不做下面这些事情：

- 不批量迁移剩余 9 个 `.input` 调用点
- 不删除 `packages/web/src/styles/components.css` 里的 legacy `.input` / `.textarea` 块
- 不做 `Select`、`mobile-select-trigger`、`select.input` 等 form-shifting 工作
- 不给 `Input` 一次性塞满未来 API；真实调用没驱动到的能力先不锁死

## 4. API 范围

### 4.1 Input

本轮 `Input` 只提供当前 codebase 已经需要、且容易保证 parity 的能力：

- `size?: "sm" | "md" | "lg"`，默认 `md`
- `invalid?: boolean`
- 透传原生 `<input>` 属性：`type`、`value`、`onChange`、`placeholder`、`disabled`、`readOnly`、`autoFocus` 等
- `className?: string`

明确延期：

- `prefix`
- `suffix`
- `clearable`

理由：设计文档里这些扩展是长期目标，但当前调用点没有使用它们；先把最核心的受控输入和 visual parity 稳定下来。

### 4.2 Textarea

本轮 `Textarea` 提供：

- `size?: "md" | "lg"`，默认 `md`
- `invalid?: boolean`
- `autoResize?: boolean`
- 透传原生 `<textarea>` 属性：`rows`、`value`、`onChange`、`placeholder`、`disabled`、`readOnly`、`autoFocus`
- `className?: string`

`autoResize` 默认关闭，避免影响现有视觉高度；开启时只做最小实现，按内容同步 `style.height`。

## 5. 样式策略

继续沿用 `Button` 已验证的策略：

- 每个组件一个目录：`index.tsx`、`index.module.css`、`index.test.tsx`、`README.md`
- CSS Module 中同时保留本地类和 `:global()` legacy alias
- React 组件继续附加 legacy class（`input` / `textarea`），让 feature 专属样式如 `.auth-input.input` 继续命中

关键点：

- `Input` 的 base 样式来自现有 `.input`
- `Textarea` 的 base 样式来自现有 `textarea.input`，并兼容 legacy `.textarea`
- `invalid` 统一映射到 `aria-invalid="true"`，同时加组件私有 invalid 样式

## 6. 迁移目标

### 6.1 Auth 密码框

当前：

```tsx
<input className="input auth-input" type="password" ... />
```

迁移后：

```tsx
<Input className="auth-input" type="password" ... />
```

要求：

- 保持 placeholder、value、onChange、禁用逻辑不变
- `.auth-input.input` 这类 legacy 组合选择器仍需命中

### 6.2 Objective Dialog 文本框

当前：

```tsx
<textarea className="input textarea" rows={5} ... />
```

迁移后：

```tsx
<Textarea rows={5} ... />
```

要求：

- 保持 `rows={5}`、`autoFocus`、placeholder、受控输入行为不变
- 不改 evaluator select/mobile trigger 流程

## 7. 测试与验收

至少覆盖：

- `Input` 单测：
  - 默认渲染
  - `size` 选项
  - `invalid` / `aria-invalid`
  - legacy class 兼容
- `Textarea` 单测：
  - 默认渲染
  - `size` 选项
  - `autoResize`
  - legacy class 兼容
- 真实调用点测试：
  - `features/auth/index.test.tsx`
  - `features/supervisor/components/objective-dialog.test.tsx`

验收标准：

- 目标测试集通过
- `pnpm lint` 不引入新增 warning/error
- auth preview 输入框视觉不出现明显回归

## 8. 完成定义

以下条件同时满足才算本 slice 完成：

- `Input` 与 `Textarea` 已从 `src/components/ui/index.ts` 公开导出
- `README.md` 与 `MIGRATION.md` 已更新状态和 caller 数
- auth 与 objective dialog 两个真实调用点已经迁移
- 所有相关测试通过
- 变更位于独立 worktree / feature branch，可独立 review 与合并
