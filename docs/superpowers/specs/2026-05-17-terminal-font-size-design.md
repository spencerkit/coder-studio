# Terminal Font Size — Design

Date: 2026-05-17
Status: Draft
Owner: Codex

## Problem

当前产品中的 shell terminal 和 agent session terminal 都复用同一个 [`XtermHost`](../../../packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx)，但字号仍写死为 `11`。用户希望在设置页中自定义终端字号，并且该设置要同时作用于主终端和会话终端，而不是分别配置。

现有设置链路已经支持通过 `settings.get/settings.update` 读取和保存 `appearance.*` 键，终端相关偏好也已经有一层轻量前端状态 [`terminalPreferencesAtom`](../../../packages/web/src/features/terminal-panel/preferences.ts)。因此本次设计应沿用现有设置架构，在不引入会话级状态的前提下增加一个全局终端字号设置。

## Goals

- 提供一个全局终端字号设置入口。
- 同时作用于 shell terminal 和 agent session terminal。
- 设置刷新后持久保留，重启应用后仍然生效。
- 修改设置后，已打开的终端即时更新字号。
- 即时生效过程中不销毁终端实例，不清空滚动历史，不触发 replay 重建。

## Non-Goals

- 不支持每个 session 独立字号。
- 不实现终端内 `Ctrl/Cmd +/-` 临时缩放。
- 不调整终端 `lineHeight`、字重、字族或配色。
- 不重构全量 settings store。
- 不顺带重排设置页分区结构。

## User Decisions Captured

- 只做全局字号，不做会话级覆盖。
- 设置入口放在“设置”里。
- 首版使用数值输入，不使用滑杆，也不做 `Small / Default / Large` 档位。
- 取值范围为 `10-18`，默认值为 `11`。
- 修改后所有已打开终端都应即时生效。

## Approaches Considered

### Option A: 数值型全局字号（推荐）

新增 `appearance.terminalFontSize`，设置页用数字输入控件编辑，所有终端读取同一全局值。

优点：

- 最符合用户需求，精度足够。
- 与现有 `appearance.terminalRenderer` 和 `appearance.terminalCopyOnSelect` 模式一致。
- 实现范围小，不引入新交互系统。

缺点：

- 需要补充数值校验与非法值回退逻辑。

### Option B: 档位型字号

只提供 `Small / Default / Large` 三档，内部映射成固定数值。

优点：

- UI 更简单。
- 测试矩阵更小。

缺点：

- 灵活性不足，容易出现“还差一点”的体验。
- 与当前已有数值型设置控件风格不一致。

### Option C: 全局字号加快捷键缩放

在 Option A 基础上再支持终端内快捷缩放。

优点：

- 交互体验最好。

缺点：

- 会引入快捷键冲突、临时状态与持久化策略问题。
- 明显超出本次“设置里支持字号自定义”的范围。

## Final Choice

采用 Option A。

本次只增加一个全局数值设置，沿用现有的服务端 settings 持久化和前端终端偏好状态。这样可以以最小改动覆盖 shell terminal 与 agent session terminal，并保持行为一致。

## Final Design

### 1. 设置模型

新增设置键：

- `appearance.terminalFontSize: number`

默认值：

- `11`

允许范围：

- 最小值 `10`
- 最大值 `18`
- 仅接受整数

解析规则：

- 缺失值回退到默认值 `11`
- 非数字、非整数、越界值全部按默认值 `11` 处理

服务端 schema 也必须约束为同样的整数范围，避免脏数据进入 `user_settings`。

### 2. 前端状态同步模型

当前 [`terminalPreferencesAtom`](../../../packages/web/src/features/terminal-panel/preferences.ts) 已承载 `copyOnSelect`，本次继续扩展这一轻量状态，而不是引入新的全量 settings store。

建议结构：

- `copyOnSelect: boolean`
- `fontSize: number`

建议新增的常量和解析函数：

- `DEFAULT_TERMINAL_FONT_SIZE = 11`
- `MIN_TERMINAL_FONT_SIZE = 10`
- `MAX_TERMINAL_FONT_SIZE = 18`
- `resolveTerminalFontSizeSetting(settings): number`

加载时机保持与当前终端偏好一致：

- 应用级 settings 拉取后，将 `appearance.terminalFontSize` 写入 `terminalPreferencesAtom`
- 设置页本地修改后，先更新内存状态，再调用 `settings.update`
- 异步回读 settings 时，沿用当前 `appearanceSelectionVersionRef` 风格，避免用户刚改完字号就被旧值覆盖

### 3. 设置页交互

设置入口放在当前终端设置组内，与 terminal renderer 和 copy on select 同组展示。

注意：虽然存储键仍在 `appearance.*` 命名空间下，但首版不迁移设置页分区位置。这样改动范围最小，也更符合当前用户寻找终端相关设置的路径。

控件形态：

- 复用现有 `Input` 数字输入控件
- `type="number"`
- `inputMode="numeric"`
- `min={10}`
- `max={18}`
- `step={1}`

提交模型：

- 允许临时草稿值
- 在 `blur` 或按下回车时提交
- 非法值不保存，回退到上一个已保存值，并显示行内错误
- 保存失败时也回退到上一个稳定值，并显示错误

建议文案：

- 中文标题：`终端字号`
- 中文说明：`应用到所有终端和会话`
- 英文标题：`Terminal font size`
- 英文说明：`Applied to all terminals and sessions`

### 4. 终端接入点

唯一接入点仍为：

- [`packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`](../../../packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx)

理由：

- shell terminal 和 agent session terminal 已经共用该组件。
- 字号是终端宿主的渲染参数，不属于 server PTY、session manager 或 terminal panel 容器职责。
- 只要 `XtermHost` 读取同一份全局字号，所有终端表现天然一致。

### 5. 即时生效模型

`XtermHost` 初始化时不再硬编码 `fontSize: 11`，而是改为读取当前全局终端字号。

对于已挂载的终端实例，字号变化时不重建 `Terminal` 实例，而是直接更新运行时选项：

1. 监听 `terminalPreferences.fontSize`
2. 当值变化时执行：
   - `terminalRef.current.options.fontSize = nextFontSize`
   - `scheduleFit()`

该模型必须满足：

- 不销毁 `terminalRef.current`
- 不重新 `open()` 容器
- 不触发 terminal snapshot / replay 恢复链路
- 不影响现有 websocket 订阅与输入处理

这样可以保证：

- 已打开的主终端和会话终端即时变化
- 终端滚动历史保留
- 不出现闪屏式重建

### 6. 兼容与渲染边界

为降低回归风险，本次明确以下边界：

- `lineHeight` 保持当前默认值，不随字号一起变化，避免 TUI 框线字符出现断裂。
- 字号增大后导致可见列数和行数下降是预期行为，不做额外补偿。
- 尚未挂载完成的终端无需专门处理更新流程，创建时直接读取最新字号即可。
- 新开终端和已开终端必须表现一致，不能一个走默认值、一个走新值。
- `terminalRenderer`、`copyOnSelect`、上传遮罩、移动端输入条等现有行为不应因字号设置被改写。

### 7. 错误处理

前端：

- 允许输入过程中的临时非法草稿值。
- 提交时如果不是合法整数或不在范围内，恢复到上一个已保存值并显示行内错误。
- 若 `settings.update` 失败，恢复到上一个稳定值并显示错误。

服务端：

- `settings.update` 的 schema 应拒绝越界值、非整数值和非数字值。
- `settings.get` 返回历史脏数据时，Web 端解析层兜底回退到默认值 `11`。

该双层校验可以同时覆盖：

- 用户直接在 UI 中输入非法值
- 测试脚本、旧客户端或手工写库引入的异常值

## Architecture

```text
SettingsPage Input
  -> dispatch("settings.update", { appearance: { terminalFontSize } })
  -> user_settings["appearance.terminalFontSize"]

settings.get
  -> resolveTerminalFontSizeSetting(settings)
  -> terminalPreferencesAtom.fontSize

XtermHost mount
  -> new Terminal({ fontSize })

XtermHost runtime update
  -> terminal.options.fontSize = nextFontSize
  -> scheduleFit()
```

## Testing

### Server

- `settings.update` 接受 `10-18` 的整数值。
- `settings.update` 拒绝 `9`、`19`、小数、字符串和 `null`。
- `settings.get` 能返回已保存的 `appearance.terminalFontSize`。

### Web Settings

- 设置页在无存量值时显示默认字号 `11`。
- 设置页在有持久化值时显示该值。
- 输入非法值后显示错误，不调用保存，字段回退到上次有效值。
- 输入合法值后调用 `settings.update`，并更新本地 `terminalPreferencesAtom`。
- 异步 settings 回读不会覆盖用户刚手动修改的字号。

### Xterm Host

- 初始创建 `Terminal` 时使用解析后的全局字号。
- 字号更新时直接写入 `terminal.options.fontSize`。
- 字号更新后调用 `scheduleFit()`。
- 字号变化不会销毁现有终端实例，不会触发 replay 重建。

### Integration / E2E

- 在设置页修改字号后，shell terminal 与 session terminal 都能看到字号变化。
- 刷新页面或重开应用后，字号仍然保持。
- 新建终端时直接使用最新字号。

## Rollout Notes

- 该功能可以直接启用，不需要 feature flag。
- 若后续用户反馈还需要更快的临时缩放，再单独立项设计快捷键缩放，不在本次范围内。

## Open Questions

无。
