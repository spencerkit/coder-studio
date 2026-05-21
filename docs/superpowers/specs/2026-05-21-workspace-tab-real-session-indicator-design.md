# 工作区标签真实会话指示器设计文档

> **版本：** 1.0
> **日期：** 2026-05-21
> **状态：** Draft（等待评审）
> **关联文件：**
> `packages/web/src/features/topbar/components/tab.tsx`
> `packages/web/src/features/topbar/index.tsx`
> `packages/web/src/atoms/sessions.ts`
> `packages/web/src/atoms/workspaces.ts`
> `packages/web/src/features/agent-panes/atoms/pane-layout.ts`
> `packages/web/src/features/agent-panes/actions/use-workspace-sessions.ts`
> `packages/web/src/styles/components.css`
> `packages/web/src/styles/tokens.css`
> **作者：** 技术共同设计 — Spencer + Codex

---

## 0. 文档说明

### 0.1 目的

优化 PC workspace 顶栏标签中的会话状态指示器：

- 去掉当前没有实际业务语义的假圆点指示器
- 在 workspace 名称后面增加真实会话缩略指示器
- 每个 pane / session 对应一个小实心方块
- 小方块的相对排布与真实 session pane 布局一致
- 使用主题相关颜色区分运行中、启动中、空闲和空位状态

本次设计只覆盖桌面端 workspace 顶栏标签，不扩展到移动端工作区抽屉、agent sheet 或其他导航入口。

### 0.2 背景

当前顶栏 `WorkspaceTab` 会渲染一个圆点：

- 该圆点直接依赖 `workspace.isActive`
- 它表达的是“当前 tab 是否激活”，不是“workspace 内 session 状态”
- 它和真实 pane 布局、真实 session 状态没有任何关联

与此同时，真实会话信息实际上分散在两类数据里：

- `paneLayout`：描述 workspace 内 pane split 结构与相对位置
- `sessionsAtom`：描述 session 的运行态，如 `starting / running / idle / ended`

用户期望的是一个真实的会话状态指示器，而不是一个与 session 无关的视觉占位。

### 0.3 设计目标

- 顶栏标签中的指示器必须映射真实 pane/session，而不是激活态占位
- 每个 pane 都要显示一个小方块，包括空 pane
- 小方块布局必须保持和真实 pane 布局一致的相对位置关系
- 颜色必须通过主题 token 驱动，不能写死固定色值
- 缩略图只承担状态概览，不承担点击、切换、悬浮说明等二级交互
- 当前激活 workspace 和非当前 workspace 都应尽可能显示真实状态

### 0.4 非目标

- **不**在本次设计中修改移动端 agent/session 入口
- **不**把缩略图做成可点击的 pane 导航
- **不**加入 tooltip、popover 或 hover 详情
- **不**加入 pulse、glow、ring 等动态特效
- **不**把小方块画成真实比例矩形 pane 预览
- **不**重构现有 session 主 hydration 流程

---

## 1. 方案比较

### 1.1 方案 A：保留单点指示器，仅改为真实状态点

移除假激活点后，仍只显示一个点，但这个点根据 workspace 内某个汇总状态切换颜色，例如“只要有 running 就显示运行色”。

优点：

- 改动最小
- 顶栏空间占用最小

缺点：

- 无法表达多 session
- 无法表达真实 pane 布局
- 与“每个 session 一个小方块”的目标不一致

### 1.2 方案 B：迷你 pane 比例图

把 workspace 的 pane layout 按真实 split 比例缩小成一张微型矩形图，每个 pane 直接画成对应的小矩形区域。

优点：

- 最接近真实布局
- 能表达 pane 面积比例

缺点：

- 视觉复杂度偏高
- 会出现细长矩形，不符合“小方块”的目标
- 在窄 tab 中容易变成噪点

### 1.3 方案 C：基于真实布局的方块缩略图（推荐）

按真实 pane split 结构计算每个 leaf 的相对位置，但每个 leaf 最终只在其区域中心渲染一个小实心方块。

优点：

- 同时满足“每个 pane 一个方块”和“位置与真实布局一致”
- 视觉稳定，不会因为 pane 比例极端而失真
- 适合顶栏这种高密度信息区

缺点：

- 不表达实际 pane 面积
- 需要额外做一次布局中心点投影

### 1.4 最终选择

采用 **方案 C**。

原因：

- 它是唯一一个同时满足“真实布局映射”和“每个 session 一个小方块”的方案
- 它的信息密度高于单点状态，但明显克制于迷你比例图
- 对顶栏宽度和当前视觉语言最友好

---

## 2. 最终设计

### 2.1 顶栏标签结构

当前 `WorkspaceTab` 结构为：

- 假状态圆点
- workspace 名称
- unread badge

调整后变为：

- workspace 名称
- `WorkspaceSessionMiniMap`
- unread badge

其中：

- 旧的假圆点完全移除
- 名称仍然保留 `ellipsis`
- mini map 固定尺寸，不参与文本压缩
- unread badge 继续保留在最右侧

### 2.2 组件边界

建议拆成三层：

1. `WorkspaceTab`
   只负责组装 tab 展示，不直接处理 pane 解析逻辑

2. `WorkspaceSessionMiniMap`
   负责把标准化后的 pane 状态数据渲染为小方块缩略图

3. `workspace tab session selector / hook`
   负责从 workspace、paneLayout、sessions 三类源数据中组装 mini map 所需输入

这种拆分能把“渲染”和“数据拼装”分离，避免顶栏 tab 组件继续膨胀。

### 2.3 缩略图布局规则

mini map 的画布是一个固定尺寸的小容器，例如约 `18-22px` 宽、`10-12px` 高。

布局计算规则：

1. 从一个单位根矩形开始
2. 遇到 `split` 节点，按 `direction + ratio` 把当前区域切成子区域
3. 遇到 `leaf` 节点，产出一个 pane 描述：
   - `paneId`
   - `sessionId | null`
   - `bounds`
   - `centerX`
   - `centerY`
4. 渲染阶段不画 `bounds` 本身，只在中心点放置一个固定大小的实心小方块

结果是：

- 左右 split 会生成左右分布的方块
- 上下 split 会生成上下分布的方块
- 嵌套 split 会生成和真实 pane 结构一致的方块簇

### 2.4 为什么使用中心点投影

不直接把 leaf 画成迷你矩形，而只取中心点，有三个原因：

1. 用户明确要的是“小方块”，不是微型 pane 图
2. 中心点足以表达相对位置关系
3. 它避免极窄 pane 被压成几乎不可见的细条

因此本方案表达的是“布局关系”，不是“面积比例”。

### 2.5 状态集合与显示规则

缩略图中的每个 leaf 必须显示一个实心方块。

状态集合定义为：

- `running`
- `starting`
- `idle`
- `empty`

映射规则：

- `leaf` 无 `sessionId` -> `empty`
- `leaf` 有 `sessionId`，但 session 不存在 -> `empty`
- `leaf` 有 `sessionId`，且 session 为 `draft` -> `empty`
- `leaf` 有 `sessionId`，且 session 为 `ended` -> `empty`
- `leaf` 有 `sessionId`，且 session 为 `starting` -> `starting`
- `leaf` 有 `sessionId`，且 session 为 `running` -> `running`
- `leaf` 有 `sessionId`，且 session 为 `idle` -> `idle`

说明：

- `ended` 仍然是系统里的合法 session 状态
- 但对于顶栏真实 pane 缩略图来说，结束会话应该表现为“空位”，而不是独立颜色
- 这样才能和布局清洗后的真实 pane 语义保持一致

### 2.6 主题配色策略

颜色必须由主题 token 驱动，不允许在组件里写死颜色值。

建议新增以下语义 token：

- `--workspace-session-map-running`
- `--workspace-session-map-starting`
- `--workspace-session-map-idle`
- `--workspace-session-map-empty`

默认建议映射：

- `running` -> `var(--state-success-text)`
- `starting` -> `var(--state-warning-text)`
- `idle` -> 基于 `var(--text-tertiary)` 的中性色
- `empty` -> 比 `idle` 更沉一点的中性色

设计要求：

- 不同主题可以通过覆写这四个 token 调整最终观感
- light / dark / hc 主题都必须保持状态可分辨性
- 所有状态方块都使用实心填充，不使用空心描边

### 2.7 交互规则

mini map 不提供额外交互：

- 不可点击
- 不显示 tooltip
- 不显示悬浮信息
- 不响应 hover 态变化

其角色是“被动概览”，而不是第二套导航系统。

---

## 3. 数据模型与同步策略

### 3.1 当前 workspace

当前激活 workspace 的 pane 布局应优先读取内存态：

- `paneLayoutAtomFamily(workspaceId)`

原因：

- 用户可能刚做过 split、关闭 pane、替换 session
- 内存态比持久化到 `workspace.uiState.paneLayout` 的数据更接近眼前真实布局

### 3.2 非当前 workspace

非当前 workspace 没有必要为了顶栏展示强行挂载完整 agent pane 视图。

因此布局来源使用：

- `workspace.uiState.paneLayout`

如果该值不存在，则退化为单 leaf 空布局。

### 3.3 session 状态来源

所有 workspace 的 session 状态统一来自：

- `sessionsAtom`

顶栏 mini map 不直接依赖 `activeSessionAtom`，因为它需要显示所有 pane，而不是只显示一个活动 session。

### 3.4 为什么需要额外 hydration

现有 session hydration 主要发生在进入某个 workspace 之后。

这意味着：

- 当前 workspace 的 session 数据通常齐全
- 非当前 workspace 的 `workspace.uiState.paneLayout` 可能已经有结构
- 但 `sessionsAtom` 不一定已经包含该 workspace 的全部 session 快照

如果不做额外处理，就会出现：

- 布局有 pane
- 顶栏却只能把它们全部画成 `empty`

这会让“真实会话指示器”在非当前 workspace 上退化成“假空位指示器”。

### 3.5 顶栏补充同步

建议在 `TopBar` 层增加一个轻量同步逻辑：

1. 连接状态为可用后开始工作
2. 遍历当前 workspace 列表
3. 对尚未拿到 session 快照的 workspace 调用一次 `session.list(workspaceId)`
4. 结果写回 `sessionsAtom`
5. 后续继续依赖现有 websocket 的 `workspace.{id}.session.{sessionId}.state` 增量更新

设计约束：

- 这个同步只负责补齐顶栏展示数据
- 不接管当前 workspace 页面已有的 session hydration 主流程
- 失败时允许重试，但不阻塞顶栏渲染

### 3.6 数据流摘要

最终数据流如下：

1. `orderedWorkspacesAtom` 提供顶栏 workspace 列表
2. `WorkspaceTab` 根据 workspace id 构造 mini map 输入
3. 当前 workspace 从 `paneLayoutAtomFamily` 取运行时布局
4. 非当前 workspace 从 `workspace.uiState.paneLayout` 取持久化布局
5. `sessionsAtom` 提供 session 快照
6. selector/hook 把 leaf 标准化为 `running / starting / idle / empty`
7. `WorkspaceSessionMiniMap` 按中心点投影规则输出实心方块

---

## 4. 空数据、异常与一致性策略

### 4.1 无布局数据

如果 workspace 没有 `paneLayout`：

- 渲染一个单 leaf 的 `empty` 方块

目标是保证每个 tab 始终有稳定指示器，不因为无数据而出现结构跳变。

### 4.2 布局存在但 session 缺失

如果 leaf 引用了某个 `sessionId`，但 `sessionsAtom` 尚未有对应 session：

- 先按 `empty` 渲染
- 等后续 hydration 或 websocket 状态到达后再更新为真实状态

### 4.3 session.list 失败

如果非当前 workspace 的补充 `session.list` 请求失败：

- 不隐藏 mini map
- 不阻塞顶栏渲染
- 保留现有布局结构
- 相关 leaf 暂按 `empty` 处理
- 允许在后续连接恢复或 workspace 列表变化时重试

### 4.4 ended 与布局清洗的一致性

`ended` session 不应在 mini map 里表现为独立颜色块。

原因：

- 桌面端真实 pane 逻辑会把结束掉的 session 清洗为 draft/空位
- 顶栏应尽可能表达“pane 当前是否占用”，而不是保留历史结束痕迹

因此 mini map 与 pane 视图在这个语义上保持一致：`ended -> empty`。

---

## 5. 样式与可视规则

### 5.1 排版优先级

在 tab 空间受限时，布局优先级如下：

1. 保留 mini map 的完整尺寸
2. 保留 unread badge
3. 压缩 workspace 名称并触发文本省略

原因是 mini map 和 badge 都属于高密度状态信息，压缩名称的成本最低。

### 5.2 mini map 视觉规则

建议样式约束：

- mini map 固定宽高
- 小方块固定边长
- 所有方块都为实心
- 不额外加描边、阴影或动画
- mini map 与名称之间保持轻微间距

视觉目标：

- 一眼可扫读
- 不与 tab 激活背景竞争注意力
- 不产生“图标按钮”的误解

### 5.3 active / inactive tab 关系

tab 的主视觉层级仍然依赖现有机制：

- active tab：背景、文字色、close 按钮显隐
- inactive tab：较弱的背景与文字强调

mini map 不承担“这个 workspace 当前是否被选中”的职责，只承担“该 workspace 内 pane/session 当前状态”的职责。

---

## 6. 测试策略

### 6.1 组件与选择器测试

至少覆盖以下场景：

- 不再渲染旧假圆点
- 单 leaf 布局渲染单个方块
- `running / starting / idle / empty` 四种状态映射正确
- `ended` 被映射为 `empty`
- session 缺失时先显示 `empty`

### 6.2 布局投影测试

至少覆盖以下布局：

- 单 pane
- 水平二分
- 垂直二分
- 左右嵌套上下 split
- 含空 pane 的嵌套 split

验证点：

- 方块数量正确
- 左右/上下相对位置正确
- 空 pane 不丢失

### 6.3 数据来源测试

至少验证：

- 当前 workspace 优先使用 `paneLayoutAtomFamily(workspaceId)`
- 非当前 workspace 使用 `workspace.uiState.paneLayout`
- `TopBar` 补 hydration 后，非当前 workspace 能从保守 `empty` 更新到真实状态

### 6.4 主题回归测试

至少覆盖：

- 一个 dark theme
- 一个 light theme
- 一个 high-contrast theme

验证点：

- 四类状态颜色都可辨识
- `idle` 与 `empty` 不混淆
- active tab 背景下 mini map 仍可读

---

## 7. 风险与折中

### 7.1 主要风险：非当前 workspace 的 session 数据不完整

这是本方案最大的实现风险。

如果只读取现有 `sessionsAtom` 而不补 hydration，则非当前 workspace 很容易全部显示为空位，违背“真实会话指示器”的目标。

因此顶栏层的轻量补同步是推荐方案中的必要组成部分，而不是可有可无的优化项。

### 7.2 次要风险：顶栏空间紧张

workspace 名较长、tab 较多时，顶栏会更拥挤。

折中方式：

- mini map 尺寸固定且尽量小
- 名称优先截断
- mini map 不加 tooltip 和交互

### 7.3 布局一致性的折中

当前 workspace 与非当前 workspace 使用不同层级的数据源：

- 当前 workspace：运行时 atom
- 非当前 workspace：持久化 `uiState`

这意味着非当前 workspace 的布局可能短时间内落后于运行时真实状态。

该折中是可接受的，因为：

- 顶栏目标是概览，不是精确 pane 编辑器
- 为非当前 workspace 挂载完整运行时布局成本明显过高
- 当前 workspace 仍然保持最高一致性

---

## 8. 最终结论

本次改造采用“基于真实 pane 布局的方块缩略图”替换现有假圆点。

核心结论如下：

- 顶栏标签中的旧激活点移除
- 在 workspace 名称后渲染 `WorkspaceSessionMiniMap`
- 每个 leaf/pane 都显示一个实心小方块
- 方块位置由真实 pane split 结构投影得到
- 状态分为 `running / starting / idle / empty`
- 配色走主题 token，不写死颜色
- 不提供 tooltip、点击和动画
- 当前 workspace 读运行时布局，非当前 workspace 读持久化布局
- 顶栏层补一次轻量 `session.list` hydration，以保证所有 tab 都尽可能显示真实状态

这套方案在信息真实性、布局表达能力、顶栏可读性和实现复杂度之间取得了最合适的平衡。
