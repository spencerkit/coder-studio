# UI 组件库 v1 · Input / Textarea Adoption Slice 设计

> **日期：** 2026-05-07
> **状态：** Draft
> **范围：** 继续迁移剩余 legacy `.input` / `textarea` 调用点

---

## 1. 背景

上一轮已经完成：

- `Input`
- `Textarea`
- auth 密码框迁移
- supervisor objective textarea 迁移

现在组件本身已经可用，下一步要把剩余仍在使用 legacy `.input` / 原生 `<textarea>` 的真实业务调用点继续收掉。

## 2. 目标

本轮继续推进 adoption，不新增新的公共组件能力。只做现有 `Input` / `Textarea` 的落地迁移：

- `settings` 侧：
  - `provider-settings.tsx`
  - `shortcuts-settings.tsx`
  - `settings-page.tsx`
- `workspace` 侧：
  - `file-tree-panel.tsx`
  - `git-status-bar.tsx`
  - `git-panel.tsx`

## 3. 非目标

本轮明确不做：

- `select.input`
- `mobile-select-trigger`
- 文件树搜索框、命令面板搜索框、branch quick pick 搜索框
- `mobile-select-sheet` 搜索框
- 新一轮 API 扩展（`prefix` / `suffix` / `clearable` 等）

这些都不是当前 `Input` / `Textarea` parity 迁移的目标，后续应由 `Select`、搜索输入、命令面板等更合适的组件处理。

## 4. 迁移清单

### 4.1 Settings

- `provider-settings.tsx`
  - `<textarea className="input settings-provider-args-input" ... />`
  - 迁到 `<Textarea className="settings-provider-args-input" ... />`
- `shortcuts-settings.tsx`
  - `<input className="input shortcuts-capture" ... />`
  - 迁到 `<Input className="shortcuts-capture" ... />`
- `settings-page.tsx`
  - `<input className="input settings-input-compact" type="number" ... />`
  - 迁到 `<Input className="settings-input-compact" type="number" ... />`

### 4.2 Workspace

- `file-tree-panel.tsx`
  - 新建文件 / 新建目录 modal 里的 `<input className="input" ... />`
  - 迁到 `<Input ... />`
- `git-status-bar.tsx`
  - 认证 modal 里的用户名 / 密码输入框
  - 迁到 `<Input ... />`
- `git-panel.tsx`
  - commit message `<textarea className="git-commit-input" ... />`
  - 迁到 `<Textarea className="git-commit-input" ... />`

## 5. 样式边界

- 继续依赖 `Input` / `Textarea` 自带的 legacy 兼容类
- 保留 feature 专属 className：
  - `settings-provider-args-input`
  - `shortcuts-capture`
  - `settings-input-compact`
  - `git-commit-input`
- 不删除 `components.css` 里的 legacy 样式块

## 6. 测试目标

至少覆盖：

- `provider-settings.test.tsx`
- `settings-page.test.tsx`
- `file-tree-panel.test.tsx`
- `git-status-bar.test.tsx`
- `git-panel.test.tsx`

如果 `shortcuts-settings` 没有独立测试，至少在现有 settings 测试里覆盖迁移后的元素仍可渲染。

## 7. 完成定义

以下条件全部满足才算本 slice 完成：

- 上述 6 个调用点全部改用 `Input` / `Textarea`
- 没有引入新的 raw `className="input"` / raw `<textarea>` parity 回退
- 目标测试集通过
- `pnpm lint` 仍只有既有 warning
- `MIGRATION.md` 更新到新的真实剩余计数
