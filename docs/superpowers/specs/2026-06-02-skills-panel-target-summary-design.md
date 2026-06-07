# Skills Panel Target Summary Design

Date: 2026-06-02
Status: Draft
Owner: spencer

## Problem

当前 `Skills` 面板已经支持：

- 已安装 skill 排序在前
- 顶层分组折叠
- 每个 skill 展示完整 target 列表并执行挂载操作

但现有已安装 skill 卡片仍然过高。每个卡片默认直接展开所有 target，导致以下问题：

- 当一个 skill 对应多个 agent target 时，卡片高度迅速膨胀
- 用户很难快速扫描“哪些 skill 已挂到哪些 agent”
- 挂载状态、健康状态、路径和操作同时暴露，信息层级过重
- 视觉密度和文件面板的 row 风格不一致

这不是一个单纯的间距问题。核心问题是：当前卡片默认把“摘要信息”和“诊断/操作信息”混在同一层展示，导致面板把垂直空间消耗在低频细节上。

## Goals

- 显著压缩已安装 skill 卡片的默认高度。
- 让用户在不展开的情况下，快速看清每个 skill 在各 agent 上的挂载概况。
- 保留三种用户可理解的大状态：`未配置 / 未挂载 / 已挂载`。
- 通过颜色和 tooltip 传达状态，不把所有异常细节都堆在默认视图里。
- 展开后仍能查看详细 target 信息并执行挂载、卸载、修复或配置操作。
- 样式和交互密度向文件面板对齐，而不是继续使用大块卡片式 target 列表。

## Non-Goals

- 这次不重做整个 `Skills` 面板布局。
- 不改变 skill 安装、卸载、挂载、修复的后端行为。
- 不引入新的挂载状态枚举；只在前端把现有状态归并成更易读的摘要语义。
- 不把 target 详细操作迁移到别的页面；仍保留在当前 skill 卡片展开态内。

## Current Context

当前实现位于：

- [`packages/web/src/features/workspace/views/shared/skills-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/skills-panel.tsx)
- [`packages/web/src/styles/components.css`](../../../packages/web/src/styles/components.css)

当前每个已安装 skill 卡片会：

- 渲染 skill 名称、slug、版本、描述和卸载按钮
- 在卡片下方直接渲染完整 `.skills-panel__targets`
- 为每个 target 展示：
  - agent 名称
  - health tag
  - mount relation tag
  - target path
  - mount/unmount/repair 按钮

现有 target 数据模型已经提供足够信息完成新的摘要层：

- `AgentSkillTargetEntry.displayName`
- `AgentSkillTargetEntry.skillDir`
- `AgentSkillTargetEntry.lastHealthState`
- `AgentSkillTargetEntry.lastHealthError`
- `SkillMountRelation.enabled`
- `SkillMountRelation.status`
- `SkillMountRelation.targetPath`
- `SkillMountRelation.lastError`

## User Decisions Captured

- 每个 skill 卡片默认收起 target 详情。
- 收起态显示 agent 缩写，而不是完整 target 行。
- 用颜色区分 `未配置 / 未挂载 / 已挂载`。
- 鼠标悬浮时用 tooltip 展示具体原因。
- 展开后再显示详细 target 行和执行挂载操作。
- `未配置` 作为独立状态保留，不合并进 `未挂载`。

## Approaches Considered

### Option A: 缩写状态胶囊行 + 展开看详情（推荐）

收起态只显示一行 agent 缩写胶囊，每个胶囊用颜色表达大状态，tooltip 解释原因；展开后显示完整 target 详情和操作。

优点：

- 压缩高度最明显
- 仍能一眼看到每个 agent 的状态分布
- 展开态和收起态之间的心智映射最稳定

缺点：

- 用户需要理解缩写含义
- 需要新增一层摘要状态和 tooltip 文案逻辑

### Option B: 状态计数摘要 + 少量 target 标记

收起态显示 `已挂载 2 · 未挂载 1 · 未配置 1`，再附少量 agent 标记。

优点：

- 总体状态统计最清楚

缺点：

- 不能一眼看清是哪些 agent 异常
- 仍然需要展开才能建立 target 对应关系

### Option C: 纯彩色点阵摘要

收起态只展示一排彩色点或方块，每个点代表一个 agent。

优点：

- 最省空间

缺点：

- 语义过弱
- 不利于和展开态建立连续关系
- 对低频用户不够自解释

## Final Choice

采用 Option A。

每个已安装 skill 卡片增加自己的 target 展开状态。默认只显示一条摘要行，摘要行用 agent 缩写胶囊展示所有 target 的大状态；点击摘要行后，在当前卡片内部展开明细行和操作区。

## Interaction Design

### 1. Skill Card Structure

每个已安装 skill 卡片保留现有信息层：

- 标题
- slug / 版本
- 描述
- 卸载按钮

在描述区下方新增一个 `target summary row`：

- 左侧是 agent 缩写胶囊组
- 右侧是展开/收起箭头
- 点击摘要行空白区域或箭头可展开/收起当前卡片

默认情况下不渲染完整 target 详情区，只显示摘要行。

### 2. Per-Skill Expansion

展开状态是按 skill 卡片独立维护的，不影响其他 skill。

- 默认：全部收起
- 展开后：只在当前 skill 卡片内部显示 target 详情
- 收起后：恢复为单行摘要

这样可以避免一个 skill 的详情把整段列表全部推开，也符合文件面板“按项查看细节”的交互节奏。

### 3. Collapsed Summary Row

摘要行展示所有 target 对应的 agent 缩写，例如：

- `CC` for `Claude Code`
- `CX` for `Codex`
- `GM` for `Gemini CLI`

内置 provider 使用稳定映射，避免缩写在不同会话中变化。非内置或自定义 provider 使用 `displayName` 自动生成 1-2 个大写字母简称。

摘要行本身使用接近 `workspace-sidebar-row` 的交互风格：

- 紧凑高度
- 轻 hover 背景
- 整行可点击
- 不使用厚重卡片分割

### 4. Expanded Detail Rows

展开后，摘要行下方显示一层内嵌明细区域，而不是恢复成大块 target 列表卡片。

每个 target 明细行结构：

- 第一行左侧：agent 全名
- 第一行右侧：操作按钮
- 名称旁边：大状态标签
- 第二行：target 目录路径或异常原因

布局目标是向文件面板的 row 密度靠拢：

- 行分隔轻量化
- 弱化每个 target 的独立卡片感
- 在桌面端保持左右布局
- 在窄屏下回落为纵向堆叠

### 5. Action Rules

展开态中的操作规则：

- `已挂载`
  - 显示 `卸载挂载`
  - 若 mount relation 存在异常状态，则额外显示 `修复`
- `未挂载`
  - 显示 `挂载`
- `未配置`
  - 不显示禁用的 `挂载`
  - 显示 `配置目录`
  - 点击后打开现有 `Agent Targets` drawer

这样可以把 `未配置` 从“不可点击的失败按钮”改成“正确的下一步动作”。

## State Model

### Visible States in Summary Layer

收起态只暴露三种颜色语义：

- 绿色：`已挂载`
- 琥珀色：`未挂载`
- 粉红色：`未配置`

收起态不再直接暴露 `stale / missing_target / missing_source / failed` 这些细粒度异常颜色，避免摘要层重新变复杂。

### Mapping Rules

目标状态归类规则：

- `未配置`
  - `target.skillDir` 为空
  - 或 `target.lastHealthState === "unconfigured"`
- `已挂载`
  - 存在启用中的 relation
  - 且 `relation.status === "mounted"`
- `未挂载`
  - 其余全部情况，包括：
    - 没有 relation
    - relation 未启用
    - `stale`
    - `missing_target`
    - `missing_source`
    - `failed`

这个规则保证摘要层永远稳定在三态，不把诊断状态数量扩展到用户难以快速扫描的程度。

## Tooltip Design

每个缩写胶囊支持 hover tooltip。tooltip 结构固定为三行：

1. agent 全名
2. 大状态：`未配置 / 未挂载 / 已挂载`
3. 具体原因

具体原因文案规则：

- `未配置`
  - 默认：`未配置 skill 目录`
- `未挂载`
  - 无 relation：`尚未挂载到此 Agent`
  - `stale`：`挂载已漂移，需要修复`
  - `missing_target`：`目标目录缺失`
  - `missing_source`：`Skill 源目录缺失`
  - `failed`：`最近一次挂载失败`
- `已挂载`
  - `已挂载到 <targetPath>`

若存在 `relation.lastError` 或 `target.lastHealthError`，优先用真实错误摘要覆盖第 3 行原因文案。

路径较长时在视觉上允许截断，但 tooltip 中展示完整值。

## Visual Language

### Summary Tokens

摘要胶囊需要同时满足“紧凑”和“可扫描”：

- 尺寸明显小于展开态按钮和 tag
- 文本为 1-2 个大写字母
- 使用轻量背景和边框，而不是大体积 badge

颜色语义：

- `已挂载`：绿色系
- `未挂载`：琥珀系
- `未配置`：粉红系

### Row Styling

整体样式对齐文件面板，而不是继续沿用厚重的子卡片：

- skill 卡片本身仍然保持现有容器
- target 层由“多行卡片组”改为“摘要行 + 轻量内嵌明细”
- hover、focus 和行间距向 `workspace-sidebar-row` 靠拢

### Click Behavior

- hover 摘要行：整行高亮
- hover 缩写胶囊：显示 tooltip
- 点击摘要行空白区域：展开/收起
- 点击胶囊本身：仅显示 tooltip，不触发展开

这样可以避免用户在查看状态原因时误触发展开。

## Implementation Notes

前端需要新增一层针对 target 的派生视图模型，至少包含：

- 缩写
- 三态摘要状态
- tooltip 文案
- 展开态按钮类型
- 是否需要修复

建议把这层派生逻辑集中在 `skills-panel.tsx` 附近的纯函数中，而不是把状态分支散落在 JSX 内部。

内置 provider 的稳定缩写映射表本次先放在 `skills-panel.tsx` 附近的本地纯函数内，而不是提取到共享工具文件。原因是这套缩写目前只服务当前面板的摘要层，先保持局部收敛，等第二个消费方出现后再提取共享工具。

样式上建议：

- 保留 `.skills-panel__list-item`
- 用新的 summary row class 替代当前默认展示的 `.skills-panel__targets`
- 让展开态 target 行更接近现有 sidebar row 节奏

`配置目录` 动作需要直接打开现有 `Agent Targets` drawer，并自动聚焦到当前 provider 对应项。这样用户从 `未配置` 状态进入配置流时，不需要再在 drawer 里额外查找目标 agent。

## Testing

需要新增或更新组件测试，覆盖以下行为：

- 已安装 skill 默认渲染为收起态摘要行
- target 胶囊按 `已挂载 / 未挂载 / 未配置` 三态着色
- hover 胶囊时能看到正确 tooltip 文案
- 点击摘要行可展开/收起当前 skill
- 展开后可看到详细 target 行和正确操作按钮
- `未配置` target 显示 `配置目录` 而不是禁用挂载按钮
- 异常 relation 在收起态归并为 `未挂载`，但展开态仍能看到具体原因或修复按钮

## Risks

- 缩写如果自动生成不稳定，用户会失去识别连续性。
- 如果 tooltip 文案直接复用底层错误字符串，可能出现过长或不可读的问题。
- 如果摘要行点击区和胶囊 hover 区没有处理好，容易出现 tooltip 和展开操作冲突。
