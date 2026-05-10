# Terminal Copy On Select — Design

Date: 2026-05-11
Status: Draft
Owner: spencer

## Problem

当前工作区里的终端区域已经支持选择文本，但没有“选中即复制”的桌面端体验。用户想要的行为是：在 shell terminal 和 agent session terminal 中，用鼠标完成选区后，文本自动进入系统剪贴板，不需要再额外按 `Ctrl/Cmd+C`。

仓库里现有终端和 session 都复用同一个 [`XtermHost`](../../../packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx)，因此这个能力应该在终端宿主层统一落地，而不是分别在 terminal panel 和 session card 上做两套逻辑。

## Goals

- 为桌面端终端提供可选的“选中自动复制”能力。
- 通过设置页全局开关控制，默认关闭。
- 设置同时作用于 shell terminal 和 agent session terminal。
- 复制成功静默处理，不打断用户。
- 复制失败时给出轻量错误反馈，复用现有 toast 系统。

## Non-Goals

- 不实现移动端长按选中或自动复制。
- 不改变现有终端触摸滚动与惯性滚动逻辑。
- 不增加新的通知面板或新的 toast 基础设施。
- 不提供复制成功 toast、悬浮提示或终端内联提示。
- 不实现 `document.execCommand("copy")` 等旧式剪贴板回退方案。

## User Decisions Captured

- 范围仅限桌面端。
- 设置入口放在设置页，通过开关控制。
- 开关默认值为关闭。
- 开启后，所有常见选区方式都应生效，包括拖拽选中、双击选词、三击选行。
- 复制成功静默。
- 复制失败时显示轻量 toast。

## Approaches Considered

### Option A: 只在设置页组件本地保存并下传开关

优点：

- 改动最少。

缺点：

- 终端页如果没进过设置页，可能拿不到最新设置值。
- 设置状态生命周期绑定到设置页，不适合全局行为。

### Option B: 新增全局终端偏好状态，在应用启动时加载一次（推荐）

优点：

- 终端无需依赖设置页是否被打开过。
- shell terminal 和 session terminal 可以直接共享同一份偏好。
- 与现有 `settings.get/settings.update` 模式兼容，范围小。

缺点：

- 需要补一层轻量 settings 同步逻辑。

### Option C: 先建立统一的全量 settings store，再接入该功能

优点：

- 架构最完整。

缺点：

- 明显超出本次范围。
- 为一个单独终端偏好引入不必要的重构成本。

## Final Choice

采用 Option B。

本次只增加一层轻量的终端偏好状态，并复用现有的服务端 settings 命令、设置页保存链路和全局 toast 能力。这样可以在不重构 settings 架构的前提下，保证行为在应用内一致且可预测。

## Final Design

### 1. 设置模型

新增设置键：

- `appearance.terminalCopyOnSelect: boolean`

默认值：

- `false`

放置位置：

- 设置页 `Appearance` 分组
- 与 terminal renderer 设置放在同一语义区块

文案方向：

- 中文：`选中自动复制`
- 中文说明：`在桌面端终端中，选中文本后自动复制到系统剪贴板`
- 英文：`Copy on select`
- 英文说明：`Automatically copy selected text to the system clipboard in desktop terminals`

### 2. 状态同步模型

该偏好不能只存在于设置页本地状态，因为终端页可能在用户从未打开过设置页的情况下先行渲染。

因此需要增加一层全局偏好状态，职责为：

- 保存当前 `terminalCopyOnSelect` 值
- 在应用启动后或连接可用后通过 `settings.get` 同步一次
- 在设置页切换时立即更新内存状态并调用 `settings.update`

推荐结构：

- 新增 `terminalPreferencesAtom`，至少包含：
  - `copyOnSelect: boolean`
- 新增一个轻量加载逻辑，放在应用级 provider 层，保证终端首次挂载时能读到最新值

该状态不需要替代现有所有 settings，只服务本次终端偏好。

### 3. 终端接入点

唯一接入点为：

- [`packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`](../../../packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx)

理由：

- terminal panel 和 session card 都复用它。
- 复制行为与具体容器无关，只与 xterm 实例、选区和桌面端指针事件有关。
- 不需要修改 server PTY、session 管理或终端数据链路。

### 4. 复制触发时机

不在 `onSelectionChange` 中直接写剪贴板。

原因：

- 拖拽选区过程中 `onSelectionChange` 会高频触发。
- 如果每次变化都 `writeText()`，会产生不必要的权限调用和系统剪贴板抖动。

推荐触发模型：

1. xterm 的 `onSelectionChange` 只负责读取并缓存当前选中文本。
2. 在桌面端终端容器上监听 `pointerup`（必要时兼容 `mouseup`）。
3. 当一次选区操作结束时，如果满足以下条件，则执行复制：
   - 当前 viewport 不是 mobile
   - `copyOnSelect` 开关已开启
   - xterm 当前存在选区
   - 当前缓存文本非空
4. 复制完成后保留选区，不强制清除。

这个模型天然支持：

- 鼠标拖拽选中
- 双击选词
- 三击选行

### 5. 剪贴板实现

v1 只使用标准异步剪贴板 API：

- `navigator.clipboard.writeText(selectedText)`

失败时不做旧式回退：

- 不用 `document.execCommand("copy")`
- 不做隐藏 textarea hack

原因：

- 当前产品运行环境是现代桌面浏览器。
- 降级方案会显著增加复杂度和维护成本。
- 失败时 toast 已足够提示用户改用手动复制。

### 6. 成功与失败反馈

成功：

- 完全静默

失败：

- 复用现有全局 toast
- tone: `error`
- 文案建议：
  - 中文标题：`自动复制失败`
  - 中文正文：`请使用 Ctrl/Cmd+C 手动复制`
  - 英文标题：`Copy on select failed`
  - 英文正文：`Use Ctrl/Cmd+C to copy manually`

失败 toast 需要节流，避免在不支持剪贴板权限的环境下用户连续拖选时刷屏。

推荐规则：

- 同一终端实例在短时间窗口内只提示一次，例如 3 秒

### 7. 桌面端限定

该功能只在桌面端启用。

具体规则：

- `useViewport()` 返回 `mobile` 时，不注册复制触发逻辑
- 不改变现有移动端 `touchstart/touchmove/touchend` 滚动代码
- 不尝试实现移动端长按选中

### 8. 现有 toast 能力复用

无需新增组件。

直接复用：

- [`packages/web/src/features/notifications/atoms.ts`](../../../packages/web/src/features/notifications/atoms.ts) 里的 `pushToastAtom`
- [`packages/web/src/features/notifications/toast-container.tsx`](../../../packages/web/src/features/notifications/toast-container.tsx)

## Architecture

```text
settings.update / settings.get
        |
        v
application-level terminal preferences state
        |
        v
XtermHost
  |- xterm.onSelectionChange() -> cache selected text
  |- container.pointerup() -> if enabled + hasSelection -> clipboard.writeText()
  |- clipboard failure -> pushToast(error)
```

## Implementation Notes

### Server

修改：

- [`packages/server/src/commands/settings.ts`](../../../packages/server/src/commands/settings.ts)

工作内容：

- 扩展 `appearance` schema，加入 `terminalCopyOnSelect?: boolean`
- 继续复用现有 flatten/unflatten 逻辑，不需要新增命令

### Web Settings

修改：

- [`packages/web/src/features/settings/components/settings-page.tsx`](../../../packages/web/src/features/settings/components/settings-page.tsx)
- [`packages/web/src/locales/zh.json`](../../../packages/web/src/locales/zh.json)
- [`packages/web/src/locales/en.json`](../../../packages/web/src/locales/en.json)

工作内容：

- 加载 `appearance.terminalCopyOnSelect`
- 切换开关时更新本地状态
- 调用 `settings.update`
- 同步更新全局终端偏好状态
- 在 `Appearance` 区块渲染新的 `Switch`

### Global Preference State

建议新增：

- `packages/web/src/features/terminal-panel/preferences.ts` 或同等职责文件

职责：

- 暴露 `terminalPreferencesAtom`
- 提供默认值 `copyOnSelect: false`
- 提供应用级初始化入口，避免行为依赖设置页挂载

应用级初始化建议放在：

- [`packages/web/src/app/providers.tsx`](../../../packages/web/src/app/providers.tsx)

### XtermHost

修改：

- [`packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`](../../../packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx)

工作内容：

- 读取全局 `copyOnSelect` 偏好
- 桌面端注册 xterm selection change 回调
- 在容器上注册 `pointerup` 复制触发
- 使用 `hasSelection()` / `getSelection()` 判断与读取文本
- 调用 `navigator.clipboard.writeText()`
- 失败时推送节流 error toast

不修改：

- PTY 输入输出协议
- WebSocket 终端链路
- session card / terminal panel 的结构层

## Testing

### Server tests

修改：

- `packages/server/src/commands/settings.test.ts`

覆盖：

- `settings.update` 能持久化 `appearance.terminalCopyOnSelect`
- `settings.get` 能返回该键

### Settings page tests

修改：

- `packages/web/src/features/settings/components/settings-page.test.tsx`

覆盖：

- 加载设置时能读取 `appearance.terminalCopyOnSelect`
- 切换开关时发送正确的 `settings.update`
- stale settings load 不覆盖用户刚切换的本地值

### XtermHost tests

修改：

- `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`

覆盖：

- 桌面端且开关开启时，选区结束会调用 `navigator.clipboard.writeText`
- 开关关闭时不会复制
- 移动端不会复制
- 复制失败时推送 error toast
- 失败 toast 在节流窗口内不会重复堆积

## Risks

- 浏览器剪贴板 API 需要安全上下文与权限支持，部分桌面环境可能失败。
- xterm 选区变化与 DOM 指针抬起的时序需要测试确认，避免在双击选词时漏触发。
- 如果未来引入统一 settings store，本次轻量偏好层需要迁移，但迁移成本可控。

## Rollout

- 一次性合入，无 feature flag
- 默认关闭，因此不会影响现有用户剪贴板习惯
- 用户显式开启后才生效

## Open Questions

- 是否需要在后续版本增加“复制成功”的更轻局部反馈。
- 是否需要在未来扩展到移动端长按选中能力。
