# PC 端样式精修 Phase 3 · 设计文档

> **版本：** 1.0
> **日期：** 2026-05-15
> **状态：** Draft（待评审）
> **作者：** Codex

---

## 0. 文档说明

### 0.1 目标

在 phase 1 / phase 2 已完成桌面主壳、settings header、editor / diff review scenes 的基础上，再做一轮面向 PC 端的细部精修，重点处理仍然明显的样式割裂点，并把尚未闭环的桌面规范补完整。

本轮只做桌面端视觉与审图能力增强，不调整核心业务逻辑，不重做主题体系，也不改移动端主路径。

### 0.2 本轮范围

本轮聚焦四个互相关联但可以局部收敛的方向：

- `workspace` 左侧 `file tree`
- `workspace` 左侧 `git panel`
- desktop `command palette`
- 全局 desktop chrome 与 review scenes

这四项共同决定了用户在桌面主工作流里对“是否像一套产品”的第一感受，因此优先级高于继续扩展次要页面。

### 0.3 现有基础

当前代码已经具备可直接精修的前提：

- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
  - 结构已稳定，具备搜索、空态、树节点、创建/删除弹层，不需要先拆组件。
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
  - 已具备提交区、worktree 区、变更分组、history 区，问题主要是密度和视觉节奏，不是信息架构缺失。
- `packages/web/src/features/command-palette/components/command-palette.tsx`
  - desktop / mobile 已分流，desktop 现在更像基础弹层，还没有完全进入桌面产品语言。
- `packages/web/src/ui-preview/scenes/desktop-review-scenes.tsx`
  - 已有 topbar / sidebar / terminal / settings / editor / diff / overlay / statusbar review scene，可继续扩展审图矩阵。

换句话说，本轮适合做“收边”和“统一语言”，不适合做大规模重构。

---

## 1. 问题定义

### 1.1 File Tree 的割裂点

`file tree` 当前能用，但桌面感不够完整，主要表现为：

- 搜索区、树节点区、空态区的密度关系偏散
- 行高、缩进、hover、selected 态之间缺少统一节奏
- 文件/目录层级主要靠缩进和图标区分，缺少更稳定的 active / hover / muted 语义
- 与 phase 1 已经收紧过的 workspace shell 相比，panel 内部仍偏“局部组件样式”

### 1.2 Git Panel 的割裂点

`git panel` 是当前桌面端最复杂的侧边栏之一，但其视觉语言还不够统一：

- commit 区、worktree 区、changes 区、history 区像四块并排功能，而不是同一块 panel 内的连续层级
- section header、count、row action、status tone 的强弱关系不稳定
- 文件变化列表和 diff/editor chrome 的关系开始收敛，但 git panel 自身密度仍偏旧
- 空态、错误态、工作树状态与变更列表没有形成一致的“辅助信息层”

### 1.3 Command Palette 的割裂点

desktop `command palette` 现在具备功能完整性，但视觉上更接近基础 modal：

- overlay、header、search、hint、result list 的层级过于平均
- 宽度、输入区高度、结果项留白与快捷键标签缺少桌面产品的“工具面板感”
- 与 workspace 顶部 chrome、settings desktop header 相比，还没有形成同一套桌面工具语言

### 1.4 Desktop Chrome 仍有不一致

phase 1 / phase 2 已经补齐了不少 surface 语义，但以下问题还在：

- topbar / sidebar / main stage / statusbar / overlay 的圆角、边框、阴影强度还存在局部差异
- 某些容器仍然混用 `bg-surface`、`bg-panel`、`bg-elevated`，导致 light theme 下对比不够稳定
- 审图 coverage 已覆盖主要壳层，但对“高密度 panel 内部状态”的回归保护仍偏弱

---

## 2. 设计目标与非目标

### 2.1 设计目标

- 让 `file tree`、`git panel`、`command palette` 进入统一的 desktop panel 语言
- 补齐 panel 内部的间距、hover、selected、meta、empty state 规范
- 把全局 desktop chrome 中最明显的 surface / border / radius 裂缝收紧
- 为后续样式回归新增更有针对性的 desktop review scenes

### 2.2 非目标

- 不改变 `file tree`、`git panel`、`command palette` 的业务能力与交互流程
- 不重做 workspace 布局结构，不改 panel 宽高逻辑
- 不新增主题 family，也不改移动端样式方向
- 不在本轮拆分 `components.css`

---

## 3. 方案选择

### 3.1 方案 A：只做 CSS 收边

只改 `components.css` 和少量 theme 测试，不增 preview scenes。

优点：

- 实施快
- 风险低

缺点：

- 很难长期防止回归
- 对 `command palette`、`git panel` 这类复杂面板，只改样式容易遗漏状态覆盖面

### 3.2 方案 B：CSS 精修 + review scenes 补齐

在局部 CSS 精修基础上，补桌面审图场景和对应测试。

优点：

- 既解决当前观感问题，又补后续回归护栏
- 可以把“桌面端规范”从口头标准变成稳定产物

缺点：

- 改动面比纯 CSS 收边略大
- 需要同步维护 metadata / catalog / capture

### 3.3 方案 C：顺带做 panel 组件抽象

把三类 panel 的 header / body / empty state 再抽一层共享组件。

优点：

- 长期潜力更大

缺点：

- 本轮会从精修演变成结构重构
- 风险与验证成本明显上升

### 3.4 结论

本轮采用 **方案 B**。

原因：

- 当前最缺的是“桌面语言统一 + 审图护栏”，不是新的抽象层。
- `file tree` / `git panel` / `command palette` 的结构已经可用，局部精修收益高。
- 先通过 review scenes 把问题显性化，后续如果仍有重复结构，再决定是否抽象共享 panel chrome。

---

## 4. 详细设计

### 4.1 File Tree 精修

涉及文件：

- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- `packages/web/src/styles/components.css`

设计要点：

- 搜索区作为 panel 顶部固定起始面，强化与树内容区的分层关系
- 收紧 desktop 节点行高、左右 padding、图标列宽和层级缩进
- 明确区分 `hover`、`selected`、`muted meta`、`empty/loading` 的视觉语义
- 让空态、搜索无结果态和普通节点列表共享同一套 panel 内部留白基线

约束：

- 不改变现有树结构、搜索逻辑、create/delete 行为
- 不引入新的节点交互

### 4.2 Git Panel 精修

涉及文件：

- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
- `packages/web/src/styles/components.css`

设计要点：

- commit block 与 section block 统一成更明确的 desktop panel 节奏
- 调整 section header、count、action link、change row 的信息权重
- 收紧 status badge、row action、history row、worktree row 的密度
- 强化 active diff row 与普通 hover row 的区别，避免只靠轻微底色变化
- 让空态/错误态保留存在感，但退回辅助层，不抢 commit 与 change list 的注意力

约束：

- 不改 git action 行为，不动 `useGitPanelActions`
- 不增加新的 git 操作入口

### 4.3 Command Palette 精修

涉及文件：

- `packages/web/src/features/command-palette/components/command-palette.tsx`
- `packages/web/src/features/command-palette/components/command-palette.test.tsx`
- `packages/web/src/styles/components.css`
- `packages/web/src/styles/components.theme.test.ts`

设计要点：

- desktop palette 进一步向“桌面工具面板”靠拢，而不是通用弹窗
- 调整 overlay 氛围、palette 宽度、header 间距、search 区高度和结果项密度
- 强化结果项 active / hover / keyboard selection 的可辨识度
- 统一 shortcut chip、meta 文案、empty state 与 desktop shell 语气

约束：

- 不改变 keyboard navigation、command 过滤与 workspace launch 流程
- mobile sheet 只做必要兼容，不作为本轮重点

### 4.4 Desktop Chrome 收边

涉及文件：

- `packages/web/src/styles/components.css`
- `packages/web/src/styles/base.theme.test.ts`
- `packages/web/src/styles/components.theme.test.ts`

设计要点：

- 统一 topbar、sidebar panel、statusbar、overlay card 的 border / radius / shadow 语义
- 减少 desktop 容器在 `bg-surface`、`bg-panel`、`bg-elevated` 之间的随意漂移
- 仅在必要处补 desktop-specific token 或语义类，避免增加新的主题分叉

约束：

- 不改 token 体系的大方向
- 不重写 phase 1 / phase 2 已通过的结构规则

### 4.5 Review Scenes 补齐

涉及文件：

- `packages/web/src/ui-preview/scenes/desktop-review-scenes.tsx`
- `packages/web/src/ui-preview/scene-metadata.ts`
- `packages/web/src/ui-preview/scene-metadata.test.ts`
- `packages/web/src/ui-preview/catalog.test.tsx`

优先策略：

- 优先强化已有 scene，而不是为了命名整洁新造一组近义 id
- 只有当现有 scene 无法承载目标状态时，才新增 dedicated desktop review scene

本轮优先覆盖：

- 已有 `workspace-sidebar-files-review`
  - 聚焦搜索区、深层目录、selected row、empty/search state
- 已有 `workspace-sidebar-git-review`
  - 聚焦 commit block、worktree 区、changes/history 区、active diff row
- 已有 `command-palette`
  - 聚焦 desktop palette header、search、selected item、shortcut chips、empty state
- 如现有 scene 仍不足以承载高密度 workspace 状态，再新增 `workspace-split-density-review`

要求：

- scene 必须使用静态、可预测的 seed 数据
- capture selector 必须稳定，避免把外层无关区域带入截图
- catalog 测试需要验证关键 chrome 是否真实渲染，不只校验 scene id 存在

---

## 5. 验证策略

### 5.1 单元与主题测试

最小验证集合：

- `src/features/workspace/views/shared/file-tree-panel.test.tsx`
- `src/features/workspace/views/shared/git-panel.test.tsx`
- `src/features/command-palette/components/command-palette.test.tsx`
- `src/styles/base.theme.test.ts`
- `src/styles/components.theme.test.ts`
- `src/ui-preview/scene-metadata.test.ts`
- `src/ui-preview/catalog.test.tsx`

关注点：

- desktop 专属 class / chrome 是否存在
- 主题测试能否覆盖新增 desktop panel 规则
- review scenes 是否被正确注册并渲染关键节点

### 5.2 定向 desktop capture

需要补跑 desktop 定向 capture，至少覆盖：

- `workspace-sidebar-files-review`
- `workspace-sidebar-git-review`
- `command-palette`
- 新增的 desktop review scenes
- `workspace-topbar-review`
- `desktop-overlay-review`
- `desktop-statusbar-review`

验收标准：

- 本轮修改涉及的 desktop scene capture 全部通过
- 抽查至少 3 张关键截图，确认没有新的桌面端视觉裂缝

---

## 6. 实施顺序

建议按以下顺序执行：

1. `file tree`
2. `git panel`
3. `command palette`
4. desktop chrome 收边
5. review scenes 与回归验证

原因：

- `file tree` 和 `git panel` 直接决定 workspace 侧边栏是否统一，应先形成 panel 基线
- `command palette` 依赖同一套桌面工具语言，放在 panel 基线之后更容易收敛
- review scenes 放在最后补齐，可以直接覆盖最终落地视觉

---

## 7. 风险与控制

- 风险 1：`components.css` 里已有多段历史规则，新增收边可能被后段覆盖
  - 控制：同步补主题测试和 scene capture，不只靠肉眼
- 风险 2：`git panel` 和 `file tree` 状态多，容易只修默认态
  - 控制：scene seed 必须显式包含 selected / empty / history / search 等关键状态
- 风险 3：desktop palette 与 overlay 变动后，mobile sheet 意外受影响
  - 控制：保持 desktop / mobile selector 分流，并保留现有 mobile 测试

---

## 8. 结论

本轮不做结构重写，而是围绕 `file tree`、`git panel`、`command palette` 和 desktop chrome 做一次可验证、可回归的精修。

核心原则只有两个：

- 先把桌面端最常被看到的 panel 语言统一
- 每修一块，就把它纳入 `ui-preview` 和 desktop capture 的护栏

如果这份设计确认无误，下一步进入 implementation plan，并按 TDD 顺序逐块落地。
