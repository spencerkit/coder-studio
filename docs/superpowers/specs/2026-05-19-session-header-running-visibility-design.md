# Session Header Running 可见性增强设计

> **版本：** 1.0
> **日期：** 2026-05-19
> **状态：** Draft（等待评审）
> **作者：** Spencer + Codex

## 0. 目标

增强 agent `SessionCard` header 中 `running` 状态的可见性，让用户在不阅读文案的情况下也能更快识别“当前 session 仍在运行中”。

本次改动明确限定为视觉感知增强，不做信息架构调整：

- 不改变 `PanelHeader` contract
- 不新增状态文案
- 不改变 header 布局、按钮顺序或 badge 排列
- 不把 session header 做成高噪声通知条

目标感知是：

- 一眼更容易扫到 `running`
- 仍然保持 header 的克制感
- 不把 `running` 误做成告警态

## 1. 背景与现状

当前 `SessionCard` header 已具备运行状态信息：

- 一个状态点
- provider badge
- `Running` state badge

但现状问题是：

- `running` 的主提示主要依赖小圆点和文字标签
- 余光扫描时，“正在执行中”的感知不够强
- 当前视觉差更多是“有状态”而不是“活跃状态”

从现有实现看：

- `SessionCard` 通过共享 `PanelHeader` 渲染 header
- `running` 状态的主要视觉锚点是 `.session-dot-running`
- `Running` badge 已存在，但强调层级仍偏弱

因此本次不需要重新设计 header 结构，而是需要在现有结构上补一层轻量活跃态。

## 2. 方案比较

本轮评估过三类方向：

### 2.1 方案 A：轻量活跃态增强

做法：

- 状态点增加低频呼吸
- 状态点外增加极淡扩散环
- `Running` badge 增加轻描边和柔光

优点：

- 不改布局
- 成本低
- 风险小
- 和现有 header 风格最一致

缺点：

- 强化幅度有限，依赖节奏和透明度拿捏

### 2.2 方案 B：新增更明确的运行提示元素

做法：

- 增加 `LIVE` / `Executing` / 小图标等辅助标记

优点：

- 状态语义更直白

缺点：

- 会引入新信息噪声
- 容易影响现有 header 密度和对齐关系

### 2.3 方案 C：整行 header 活跃化

做法：

- header 背景做流光、渐变或更大面积状态强调

优点：

- 最容易一眼看出运行中

缺点：

- 侵入性太强
- 更容易破坏 panel header 的克制感
- 明暗主题都更难收敛

### 2.4 结论

采用 **方案 A：轻量活跃态增强**。

原因：

- 它满足“更明显”与“不过度打扰”之间的平衡
- 它不要求修改 header contract 或新增布局适配
- 它可以稳定复用到共享 `SessionCard` 的移动端场景

## 3. 最终设计

### 3.1 视觉行为

仅对 `running` 状态增加轻量活跃态：

1. 状态点持续低频呼吸动画
2. 状态点外侧增加极淡扩散环
3. `Running` badge 增加轻描边和柔光强调

视觉优先级定义：

- 第一视觉锚点：状态点
- 第二视觉锚点：`Running` badge
- 标题、provider badge、操作按钮维持现有层级

明确约束：

- 不允许跳动感、闪烁感、强节拍感
- 不允许让 badge 成为比状态点更强的视觉焦点
- 不允许出现高度变化、宽度跳动、布局位移

### 3.2 状态点动效

`running` 状态点采用低频呼吸动画：

- 周期：`1.6s` 到 `1.8s`
- 动效属性：仅允许小幅 `scale` 和 `opacity` 变化
- 振幅：控制在“余光可感知，但近看不烦躁”的级别

状态点外的扩散环：

- 与呼吸动画同节奏
- 只作为极弱的外围提示，不可做成独立闪环
- 扩散范围建议控制在点外约 `5px` 到 `7px`
- 透明度应明显低于状态点本体

整体效果应接近“活着 / 正在工作”，而不是“警报 / 通知”。

### 3.3 Running Badge 强调

`Running` badge 在保留当前尺寸、文案、位置的前提下增加静态与动态轻强调：

- 轻微描边
- 极淡柔光
- 与状态点节奏一致或近似一致的弱呼吸感

明确限制：

- 不改 badge 高度
- 不改 badge padding
- 不增加新图标
- 不增加新文字
- 不做明显亮灭切换

badge 的职责不是承担主要动效，而是帮助用户在看清文本区域时更快确认这是运行态。

## 4. 主题与可访问性约束

### 4.1 主题适配

这次改动必须在 `light` / `dark` 下都成立，不能只在单一主题里好看。

主题策略：

- 动效和高亮都从现有语义色推导
- 状态点扩散环跟随状态点当前色
- `Running` badge 的描边与柔光优先基于 badge 当前色或 `currentColor` 推导

`dark theme` 约束：

- 避免霓虹感
- 可以允许稍大的扩散范围
- 但透明度必须更低

`light theme` 约束：

- 避免发灰、发脏、像糊开的阴影
- 更依赖细描边和浅底差异
- 外发光存在感要弱于 dark

如果同一套参数无法兼容两种主题，只允许做透明度级别或混色级别的主题微调，不引入两套完全不同的视觉语言。

### 4.2 Reduced Motion

在 `prefers-reduced-motion: reduce` 下：

- 关闭状态点呼吸动画
- 关闭扩散环动画
- 关闭 badge 呼吸动画
- 保留静态强调态

静态强调态仍需让 `running` 比 `idle` 更容易识别，但不能依赖运动本身。

## 5. 范围边界

### 5.1 纳入范围

本次只覆盖共享 `SessionCard` header 的 `running` 状态可见性增强，预计主要落点为：

- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- `packages/web/src/components/ui/status-dot/`
- `packages/web/src/styles/components.css`
- 相关组件 / 样式测试

### 5.2 明确不做

- 不改 `PanelHeader` contract
- 不给 `idle` / `ended` / `starting` 全部重做动效体系
- 不新增 `LIVE` / `Executing` / `In Progress` 一类文案
- 不把整条 header 改成明显的 running banner
- 不顺手扩散到 topbar、workspace tab、supervisor badge 等其它状态点系统

### 5.3 移动端范围

移动端 **会同步到 agent 主区域里的 `SessionCard` header**，因为该区域直接复用共享 `SessionCard` 实现。

但以下区域不在本次范围内：

- mobile topbar 状态点
- workspace tab / topbar tab 状态点
- supervisor badge / supervisor 状态系统

换句话说：

- **同步共享 session header**
- **不扩散到其它移动端状态点体系**

## 6. 实现建议

### 6.1 样式实现方式

优先在现有共享样式基础上增强：

- 复用现有 `StatusDot` pulse 能力或扩展其细节
- 保留现有 `.session-dot-running` DOM contract
- 在 `session-state-badge` 上只追加 `running` 相关强调规则

建议原则：

- 尽量通过共享变量、现有 tone、`currentColor` 与 `color-mix` 收敛
- 避免在 `SessionCard` 里增加复杂条件 DOM
- 优先改样式层，而不是追加新的视觉结构节点

### 6.2 DOM / Contract 稳定性

现有测试和调用方已经依赖这些类名和结构：

- `.session-dot`
- `.session-dot-running`
- `.session-state-badge`

因此实现必须保持：

- 现有 class 仍然存在
- 现有 header DOM 层级不被打散
- 不通过插入额外文案节点改变布局语义

## 7. 验收与测试边界

### 7.1 验收标准

完成后应满足：

- `running` 比当前版本更容易被余光扫到
- 用户不会把它误解为错误态或告警态
- `idle` / `ended` 不被误伤
- header 不发生抖动或尺寸变化
- `light` / `dark` 均成立
- reduced-motion 下仍保留可识别的静态强调

### 7.2 测试边界

至少覆盖以下层面：

1. 组件测试
   - 确认 `running` 仍保留现有 class / 语义
   - 确认没有破坏 `SessionCard` 现有 DOM contract

2. 样式测试
   - 确认新增了 `running` 动效规则
   - 确认存在 badge 强调规则
   - 确认存在 `prefers-reduced-motion` 降级规则

3. 主题边界测试
   - 至少确认 `light` / `dark` 下相关规则都有定义
   - 不把主题适配完全留给主观截图判断

可选：

- 如果已有轻量 visual/e2e 入口，可补一条 `running` 状态存在性的弱断言
- 不为本次需求扩大大规模视觉测试面

## 8. 风险与控制

主要风险有三个：

### 8.1 风险：动效太弱

结果是改了但用户感知不到。

控制方式：

- 让状态点而不是 badge 承担主要感知
- 保证动效节奏足够慢，但幅度不要低到不可见

### 8.2 风险：动效太吵

结果是 header 长时间驻留时造成视觉疲劳。

控制方式：

- 降低透明度
- 降低节拍感
- 不用高频脉冲
- 不做整行 header 动效

### 8.3 风险：主题不一致

结果是 dark 正常、light 发灰，或反之。

控制方式：

- 从语义色推导，不写死视觉终值
- 如果必须按主题微调，只微调透明度 / 混色强度，不改整体语言

## 9. 结论

本次设计采用“轻量活跃态增强”：

- 不动布局
- 不加文案
- 只增强 `running` 的视觉可见性

最终形式为：

- 低频呼吸状态点
- 极淡扩散环
- 轻强调的 `Running` badge

并明确要求：

- 兼容 `light` / `dark`
- 支持 `prefers-reduced-motion`
- 仅同步到共享 `SessionCard` 的移动端 header
- 不扩散到其它状态点系统
