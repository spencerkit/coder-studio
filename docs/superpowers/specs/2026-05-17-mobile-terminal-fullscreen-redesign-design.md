# 移动端终端全屏页重设计 · 设计文档

> **版本：** 1.0
> **日期：** 2026-05-17
> **状态：** Draft（待评审）
> **作者：** Codex

---

## 0. 文档说明

### 0.1 目标

重设计移动端终端全屏页，修复当前页面混入旧移动端大圆角 `sheet/card/pill` 语言的问题，让它重新回到与 PC 端终端/编辑器一致的工具化语气。

本轮重点不是新增终端能力，而是把当前页面从“移动端卡片式浮层页面”收敛为“专业工具画布页”。

### 0.2 范围

本轮只覆盖从移动端 workspace 中打开的终端全屏页。

包含：

- 顶部 chrome 与终端工具栏的视觉重组
- 终端主画布的容器与留白收敛
- 移动端终端输入辅助条的视觉降噪
- 底部状态带在终端页中的样式统一
- 相关测试与 UI preview 调整

不包含：

- 桌面端终端面板结构改动
- 终端输入协议、快捷键语义、上传/粘贴业务逻辑改写
- 主题 token 体系重构
- 新增主题 family、私有配色体系或硬编码的页面专属主题
- 文件页、详情页或其他移动端页面的同步重做

### 0.3 相关实现入口

当前页面由以下结构共同组成：

- `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`
  - 负责移动端终端全屏 sheet 的装配
- `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
  - 负责终端顶部工具栏、selector、会话操作与 xterm 内容区
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
  - 负责终端宿主与移动端输入辅助条装配
- `packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.tsx`
  - 负责移动端 Paste / Upload / Ctrl / Shift / 方向键等输入辅助控件
- `packages/web/src/styles/components.css`
  - 当前移动端终端页主要样式定义位置

本轮重点 class 区域：

- `.mobile-terminal-sheet`
- `.mobile-sheet--terminal`
- `.bottom-terminal--mobile-fullscreen`
- `.mobile-terminal-input-bar`

### 0.4 现状与问题

当前移动端终端页已经具备完整功能，但视觉归类是错位的。

现状特征：

- `.mobile-terminal-sheet` 仍保留明显页面 padding 与渐变壳层
- `.mobile-terminal-sheet .bottom-terminal` 使用较重的顶部大圆角容器
- `.bottom-terminal--mobile-fullscreen .terminal-selector-btn` 与 `.panel-toolbar-btn` 仍偏胶囊 / 圆丸控件
- `.mobile-terminal-input-bar` 中动作按钮和软键呈现为一排独立高存在感按钮

这导致三个问题：

1. 终端页看起来像“移动端浮层卡片页面”，不像 workspace 工具页
2. 顶部、正文、输入条、底部状态带之间都是各自成块，终端主舞台不够集中
3. 页面虽然沿用了现有主题 token，但映射到了错误的视觉语义上，因此与 PC 端 `pc-style-polish` 调性断开

---

## 1. 设计目标与非目标

### 1.1 设计目标

- 让移动端终端页重新对齐 PC 端终端/编辑器气质
- 保持终端内容区成为首要视觉焦点
- 在不破坏现有主题体系的前提下，降低移动端的大圆角、卡片感和浮层感
- 保留移动端终端的必要操作能力，但把控制区降为工具性存在
- 让页面在浅色 / 深色主题下都继续依赖现有 token 正常工作

### 1.2 非目标

- 不把终端页改造成原生 app 风格目录页
- 不把页面做成营销式或说明式布局
- 不为了“更硬朗”而牺牲触控可用性
- 不在本轮引入新的终端状态模型、快捷键布局配置或会话管理流程

---

## 2. 方案选择

### 2.1 候选方案

#### 方案 A：极致终端优先

最大限度压缩页面 chrome、会话信息与快捷键存在感，让终端输出区域尽可能接近满屏。

#### 方案 B：终端优先但更精致统一

保留终端优先，但增加一层轻量会话信息块和更完整的移动端结构层级。

### 2.2 最终选择

本轮采用 **方案 A：极致终端优先**。

选择原因：

- 用户已明确选择 `A`
- 当前问题核心不是信息不够，而是终端页被旧移动端卡片语言劫持
- 对齐 `pc-style-polish` 时，终端页最需要的是“专业工具页”语气，而不是补更多移动端产品装饰

---

## 3. 核心设计决策

### 3.1 视觉归类改正

本页后续归类为：

- `workspace / tool / canvas`

而不是：

- `mobile / sheet / card / pill`

这意味着本轮修的是 **主题 token 的映射方式**，不是重做主题本身。

### 3.2 主题约束

必须保留现有主题设定：

- 继续使用现有颜色 token、文字层级、状态色、边框语义与明暗模式
- 不新增页面私有主题
- 不用硬编码颜色绕开主题体系

允许调整的是：

- 终端页使用哪些现有 surface / border / text token
- 终端页各类 radius、padding、gap 的数值
- 终端页内部各组件的视觉归类

### 3.3 顶部只读作一层工具 chrome

终端页最终观感上只能有一层顶部工具带。

实现上即使仍复用 `MobileSheet` header 与 `TerminalPanel` toolbar 两段结构，也必须在视觉上合并成一个连续的薄工具带，避免出现“页头一层 + 终端卡片头一层”的双层堆叠感。

### 3.4 终端主画布优先于辅助控件

垂直空间优先级固定为：

1. 终端内容与输入光标
2. 输入辅助条
3. 顶部 chrome 的留白与说明性内容

键盘弹起时，应该优先压缩辅助条密度和顶部空白，而不是继续牺牲终端正文高度。

---

## 4. 页面信息组织

### 4.1 顶部工具栏

顶部工具栏只保留一级动作：

- 返回
- 页面标题 `Terminal`
- 1 到 2 个高频动作，如新建终端、关闭当前页

会话切换如果保留，必须收成轻量入口，不允许再演化为独立会话信息卡块。

### 4.2 会话切换入口

多终端场景下，terminal selector 继续保留，但降为工具入口而不是信息中心：

- 维持单行、可截断、mono 风格
- 与 toolbar 同层，不独立抬起
- 只在存在多个 terminal 时呈现

### 4.3 终端内容区

终端内容区是整个页面的主舞台。

要求：

- 不再套用明显“卡片壳 + 大圆角 + 浮起感”
- 不引入额外的内容头部，如 `Live session` 之类次级标签
- xterm 内容应尽可能直接接触页面主画布层

### 4.4 输入辅助条

输入辅助条保留现有功能：

- `Paste`
- `Upload`
- `Ctrl`
- `Shift`
- `Esc`
- `Tab`
- 方向键
- `Enter`

但视觉语义从“按钮陈列区”调整为“输入辅助工具条”：

- 操作按钮与软键应被看作同一条工具带中的不同分组
- 可横向滚动，但不应看起来像一排独立的厚重 pill
- `Ctrl` / `Shift` 状态仍用现有主题状态色表达，不改变交互语义

### 4.5 底部状态带

终端页底部状态信息继续保留，但只承担状态职责：

- branch
- session / 连接上下文
- sync / workspace 状态

它必须表现为编辑器式状态带，而不是另一块可点击大卡片。

---

## 5. 视觉规范

### 5.1 圆角策略

本页圆角必须整体下调，并向 PC 端工具控件语义对齐。

规则：

- 终端主壳层不再使用 `xl` 级大圆角，也不使用 full-pill
- 优先使用 PC 端已存在的小中圆角 token
- 工具按钮、selector、输入条软键统一收敛到小中圆角
- 页面中不应再出现“一个工具页里同时混有大卡片圆角和极小控件圆角”的断裂

一句话约束：

> 移动端终端页允许有轻圆角，但不允许再有旧样式的大软壳圆角。

### 5.2 分层方式

本页分层以：

- surface 对比
- 细边框
- 文本层级

为主，不依赖：

- 明显阴影
- 大面积渐变壳层
- 独立漂浮卡片

### 5.3 背景与表面

背景继续沿用当前主题体系中的 page / surface / terminal 语义，但需要做两点调整：

- 页面外层背景减少装饰性渐变存在感
- 终端内容层与 chrome 层之间主要靠轻微 surface 区分，而不是用一块圆角容器把终端包起来

### 5.4 顶部控件风格

顶部 selector、icon action、close/new 等控件应体现“轻工具控件”语气：

- 更薄
- 更紧凑
- 更低对比
- 不使用胶囊形态强化自己

### 5.5 输入辅助条风格

输入辅助条需要从“按钮列表”降噪为“连续工具条”：

- 组内 keycap 风格允许保留
- 但要降低边框厚感和 pill 感
- `Paste` / `Upload` 不应像两个独立 CTA
- 常用软键应更像键盘辅助列，而不是功能卡片

### 5.6 字体与内容焦点

视觉焦点顺序固定为：

1. monospace 终端内容
2. 工具栏中的当前上下文入口
3. 状态带与辅助控件

标题、说明和次级文案都应为辅助层，不能夺走终端内容的中心性。

---

## 6. 实现设计

### 6.1 DOM 与组件边界

本轮优先复用现有组件边界，不为了样式调整大改业务结构。

建议改动策略：

- `workspace-mobile-view.tsx`
  - 继续负责终端 sheet 的装配
  - 如有必要，只增加终端页专用 class 或 footer hook，不改导航状态机
- `terminal-panel.tsx`
  - 调整 `mobile-fullscreen` 模式下 toolbar 的层级与结构
  - 确保 selector 与 action 的位置关系符合单层工具栏语义
- `xterm-host.tsx`
  - 保持终端行为逻辑不变
  - 仅在确有必要时增加包裹结构或 class 以支撑新布局
- `mobile-terminal-input-bar.tsx`
  - 保持交互语义与键位映射不变
  - 允许做轻量结构调整，以支持更连续的工具条样式
- `components.css`
  - 作为本轮样式重做的主落点

### 6.2 顶部 chrome 合并策略

`MobileSheet` header 与 `TerminalPanel` toolbar 可以继续共存于实现层，但最终必须满足：

- 用户不会感知到两个互相叠加的头部模块
- 头部底边只有一层明确分隔
- selector 与 action 看起来属于页面主工具栏，而不是终端内容区里又长出一排按钮

### 6.3 终端主画布策略

`.mobile-terminal-sheet` 与 `.bottom-terminal--mobile-fullscreen` 的主要职责应变为：

- 提供满高布局
- 控制最小必要的 surface 分层
- 给 xterm 内容让出最大可用区域

不应再承担：

- 大卡片容器表达
- 装饰性背景表达
- 二级标题区表达

### 6.4 输入辅助条策略

`.mobile-terminal-input-bar` 需要保留现有逻辑测试可依赖的交互语义，但视觉上要完成以下变化：

- `actions` 与 `keys` 两组之间的断裂减弱
- 各按钮厚度降低
- 常见控件的形态从圆丸/胶囊收敛到更像工具键帽
- 保持触控可用的最小命中面积，不把控件缩成难点按的小标签

### 6.5 底部状态带策略

终端页当前通过 `WorkspaceStatusBar` 作为 footer 注入。

本轮不改状态栏业务内容，但需要让它在 `.mobile-sheet--terminal` 场景下与终端页一起读作一体化工具页底栏：

- 贴边
- 扁平
- 弱装饰
- 信息优先

---

## 7. 测试与预览

### 7.1 需要同步的测试

- `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
- `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- `packages/web/src/features/terminal-panel/mobile/mobile-terminal-input-bar.test.tsx`
- `packages/web/src/styles/components.theme.test.ts`

测试重点：

- `mobile-fullscreen` 模式下的 toolbar / selector / actions 结构仍然正确
- 移动端输入辅助条行为不回归
- 主题样式仍通过现有 token 输出，不引入破坏性覆盖

### 7.2 需要同步的预览

- `packages/web/src/ui-preview/scenes/showcase-scenes.tsx`
- `packages/web/src/ui-preview/scene-metadata.ts`
- `packages/web/src/ui-preview/catalog.test.tsx`

需要补齐或更新移动端终端全屏页的 preview 场景，确保后续能做视觉回归审查。

---

## 8. 验收标准

以下结果同时成立，才算本轮完成：

- 移动端终端全屏页整体读作一张工具画布，而不是一组堆叠卡片
- 顶部只表现为一层紧凑工具栏
- 终端正文成为首要视觉焦点
- 页面内不再出现旧移动端大圆角壳层与高存在感 pill 风格
- 现有主题切换与状态色语义保持正常
- Paste / Upload / Ctrl / Shift / 方向键等现有输入能力全部保留
- 键盘弹起时，终端内容高度优先于装饰性留白

---

## 9. 风险与约束

### 9.1 双头部错觉

如果 `MobileSheet` header 与 `TerminalPanel` toolbar 只做局部修饰、不做整体收敛，最终仍可能看起来像双层头部。

### 9.2 过度收紧导致触控退化

如果只追求“更像 PC”，容易把移动端控件压得过小。实现时必须保持基本触控命中面积。

### 9.3 主题体系被页面私有样式绕开

如果实现中引入大量硬编码颜色或临时视觉补丁，会把本轮从“主题映射修正”变成“页面私有主题”，这是明确禁止的。

---

## 10. 结论

本轮设计的本质不是重新发明移动端终端，而是把它从错误的移动端卡片语言里拉回到正确的 workspace 工具语言里。

实现完成后，这个页面应该给人的感觉是：

- 仍然是当前产品
- 仍然遵循当前主题
- 但终于和 PC 端终端属于同一套工具系统
