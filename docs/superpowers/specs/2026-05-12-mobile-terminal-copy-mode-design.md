# Mobile Terminal Copy Mode — Design

Date: 2026-05-12
Status: Draft
Owner: spencer

## Problem

移动端 terminal 当前以触摸滚动和软键输入为主，无法像普通网页文本那样通过长按进入原生选区，因此用户不能方便地复制终端输出。

仓库现状决定了这不是一个“打开浏览器默认选区”就能解决的问题：

- 移动端 terminal 由 [`XtermHost`](../../../packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx) 承载。
- 该组件在移动端显式接管了 `touchstart/touchmove/touchend/touchcancel`，用于终端滚动与惯性滚动。
- 当前的 terminal 交互目标是“可滚动、可输入”，不是“原生可选中文本”。

用户希望增加一个移动端可用的复制路径，优先满足“长按后选中当前看到的终端输出并复制”。

## Goals

- 为移动端 terminal 增加长按进入复制模式的能力。
- 复制模式中允许使用浏览器原生文本选区，支持多行选中。
- v1 仅覆盖当前可见 viewport 的终端内容。
- 复制模式退出后恢复到原本的 live terminal 交互。
- 不改变桌面端现有 copy-on-select 行为。

## Non-Goals

- 不在 live xterm 上直接实现移动端原生长按选区。
- 不支持跨出当前 viewport 的历史 scrollback 选中。
- 不实现自定义选区手柄、放大镜或自定义复制菜单。
- 不新增服务端专用“移动端复制快照”接口。
- 不改变现有移动端软键条的键位语义。

## User Decisions Captured

- 采用“长按进入 overlay 复制模式”而不是直接改 xterm 原生选区。
- v1 的 overlay 内容来源于前端当前可见 DOM，而不是服务端快照。
- v1 支持多行选中。
- v1 范围只覆盖当前可见 viewport。

## Approaches Considered

### Option A: 直接使用当前前端可见 DOM 生成复制 overlay（推荐）

优点：

- 所见即所得，复制内容与用户此刻看到的终端一致。
- 不依赖现有服务端 snapshot 格式转换。
- 不需要新增协议或服务端接口。
- 与公开可验证的同类 workaround 一致，风险更低。

缺点：

- v1 只能稳定覆盖当前 viewport。
- 需要处理 xterm DOM 的空格、行宽、样式拷贝与定位。

### Option B: 复用服务端 `terminal.snapshot` 生成 overlay

优点：

- 理论上可以脱离前端渲染层，未来更容易扩展到更大范围。

缺点：

- 当前 `terminal.snapshot` 是 headless xterm 的序列化 ANSI/VT 数据，不是可直接选中的文本结构。
- 服务端现有 `renderSnapshotToText()` 只适合摘要用途，会丢失可视布局信息。
- 为 v1 引入服务端转换逻辑，复杂度不划算。

### Option C: 直接在 live xterm 上实现移动端原生选区

优点：

- 交互最接近桌面或原生文本组件。

缺点：

- 与 xterm.js 当前移动端支持现状冲突明显。
- 会直接撞上现有 touch scroll、焦点、软键盘与渲染层限制。
- 超出本次范围。

## Final Choice

采用 Option A。

v1 把复制能力定义为一个独立的“复制模式”：用户长按 terminal 输出区域后，前端读取当前可见 viewport 的 xterm DOM，生成一个位于 terminal 上层的可选中文本 overlay。用户在 overlay 上使用浏览器原生选区完成复制，退出后再回到 live terminal。

## Interaction Model

### 1. 默认状态

在未进入复制模式时，移动端 terminal 保持当前行为：

- 单指纵向拖动：滚动 terminal。
- 点击 terminal：聚焦输入。
- 软键条正常可用。
- 不暴露原生文本选区。

### 2. 进入复制模式

用户在 terminal 输出区域单指长按约 450-500ms 后触发复制模式。

长按识别条件：

- 仅单指触摸有效。
- 触点位移超过小阈值（建议 5-8px）则取消长按。
- 明显纵向滚动手势优先判定为滚动，不进入复制模式。
- 若触点位于当前输入行附近，则不进入复制模式，保留输入/粘贴优先级。

进入复制模式时：

- 触发轻微震动（如果浏览器支持 `navigator.vibrate`）。
- 冻结一份“当前可见 viewport”的文本快照。
- 在 terminal 上方显示全覆盖 overlay。
- overlay 内文本可使用浏览器原生选区。
- live terminal 继续存在于底层，但不响应触摸交互。

### 3. 复制模式中的交互

复制模式内的用户心智是“正在复制这一屏文本”，而不是“仍在操作 live terminal”。

具体行为：

- 用户可原生长按/拖动选择多行文本。
- overlay 自身允许滚动，但滚动范围仅限当前快照容器，不会拉取更多历史 terminal 内容。
- 底部软键条建议隐藏或禁用，避免误触发送输入。
- terminal 输出即使后台继续到达，也不会实时更新 overlay。

### 4. 退出复制模式

主退出方式：

- 点击显式的“完成”按钮。

辅助退出方式：

- 当没有激活选区时，点击 overlay 空白区域退出。

v1 不依赖“复制成功自动退出”作为核心流程，因为浏览器复制菜单与系统选区的完成信号并不总是稳定可观察。若浏览器确实触发了 `copy` 事件，可作为增强项做延迟自动退出，但不是必需条件。

## Overlay Content Source

### Why Not Server Snapshot

当前服务端 `terminal.snapshot` 实现来自 headless xterm 的 `SerializeAddon.serialize()`，返回的是可重建终端状态的序列化数据，不是用于浏览器原生选区的文本结构。

参考：

- [`packages/server/src/terminal/terminal-snapshot-buffer.ts`](../../../packages/server/src/terminal/terminal-snapshot-buffer.ts)
- [`packages/server/src/commands/terminal.ts`](../../../packages/server/src/commands/terminal.ts)

当前服务端把 snapshot 渲染成纯文本的能力也仅用于摘要：

- [`packages/server/src/terminal/snapshot-render.ts`](../../../packages/server/src/terminal/snapshot-render.ts)

该实现会 strip ANSI 并按换行切分，无法保留 overlay 所需的可视布局、空格占位和逐行宽度一致性，因此不适合作为 v1 的复制源。

### DOM-Based Snapshot

v1 以当前前端 xterm 可见 DOM 作为唯一数据源。

推荐来源：

- `terminal.element` 下当前可见的 `.xterm-rows`

生成步骤：

1. 读取当前 `.xterm-rows` 的可见内容。
2. clone 当前行结构。
3. 将原始 span 的 computed style 拷贝到 clone，避免脱离 `.xterm` 容器后颜色丢失。
4. 将普通空格替换为 `NBSP`，保证原生选区时空白可见且可点中。
5. 按当前 terminal `cols` 为每一行补齐尾部空白，避免短行选区断裂。
6. 按当前 viewport 中 `.xterm-rows` 的实际偏移量，把 clone 后的内容对齐到 overlay。

结果是：overlay 展示的是“用户眼前这一屏的静态文本版”，不是一份重新解释的服务端文本。

## Viewport Scope

v1 的复制范围严格限定为“进入复制模式那一刻，terminal 当前可见 viewport 中的内容”。

这意味着：

- 支持多行拖选。
- 支持从当前可见区域上半部分选到下半部分。
- 不支持继续向上滚到更早的 scrollback 后扩展当前选区。

若用户想复制更早输出，操作方式是：

1. 先退出复制模式。
2. 在 live terminal 中滚到目标位置。
3. 再次长按进入复制模式。

## UI Surface

### Overlay Shell

overlay 覆盖在 `.xterm-host` 之上，建议包含：

- 一个顶部轻量工具条。
- 一个主文本区。

工具条内容：

- 左侧标题：`复制模式`
- 右侧主操作：`完成`

可选的辅助提示文案：

- `拖动选择文本`

### Visual Rules

- overlay 背景延续 terminal 深色底，但比 live terminal 稍亮或稍实，以明确“当前是冻结层”。
- overlay 不需要复杂动画，最多做一个轻微淡入。
- 文本区使用与 terminal 一致的字体、字号和行高，避免视觉跳变。

## Input, Scroll, And State Coordination

进入复制模式后：

- 终端输入事件不应再透传给 PTY。
- 终端 touch scroll 逻辑暂停。
- 软键条交互暂停或隐藏。

退出复制模式后：

- 恢复原有 touch scroll。
- 恢复输入与软键条。
- 丢弃 overlay 快照。
- live terminal 继续显示最新内容；复制模式期间积累的输出在退出后自然可见。

本次不要求暂停服务端输出流，也不要求阻塞 terminal 底层渲染。复制模式只阻断用户交互层，不改变现有输出链路。

## Error Handling

若在进入复制模式时无法读取 `.xterm-rows` 或生成 overlay 内容失败：

- 不进入复制模式。
- 保持现有 terminal 交互不变。
- 给出轻量 toast：
  - 中文标题：`无法进入复制模式`
  - 中文正文：`请重试，或先滚动终端后再长按`
  - 英文标题：`Couldn't enter copy mode`
  - 英文正文：`Try again, or scroll the terminal and long press again`

复制模式本身不需要“复制成功 toast”。成功应保持静默。

## Testing

- `XtermHost` 长按识别：
  - 单指长按进入复制模式。
  - 位移超过阈值后取消长按。
  - 纵向滚动手势不进入复制模式。
  - 输入行附近长按不进入复制模式。
- overlay 内容：
  - 基于当前可见 viewport 生成。
  - 支持多行文本。
  - 行尾空白补齐后可连续选中。
  - 样式拷贝后颜色与基础排版保持稳定。
- 状态切换：
  - 进入复制模式后暂停软键条交互。
  - 退出后恢复 live terminal。
  - 复制模式期间新输出不会刷新 overlay。
- 异常路径：
  - DOM 取样失败时显示 toast，且不破坏 terminal 可用性。

## Rollout

- 一次合入，无设置开关。
- 范围仅限移动端 viewport。
- 桌面端逻辑不受影响。

## Open Questions

无。
