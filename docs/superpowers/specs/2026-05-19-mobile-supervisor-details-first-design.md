# 移动端 Supervisor 详情优先改造 · 设计文档

> **版本：** 1.0
> **日期：** 2026-05-19
> **状态：** Draft（待评审）
> **作者：** Codex

---

## 0. 文档说明

### 0.1 目标

收敛移动端 `Supervisor` 的层级结构，把当前“root 层卡片 + detail 层编辑/详情”的两段式流程改成“入口即详情 / 入口即编辑”的直接流程。

本轮重点不是新增 `Supervisor` 能力，而是去掉移动端多余的一跳，让入口行为更贴近用户预期：

- 已启用时，直接查看当前 `Supervisor` 详情
- 未启用时，直接进入目标编辑
- 移动端不再提供 `禁用 Supervisor` 按钮

### 0.2 范围

包含：

- 移动端 `Supervisor` sheet 的入口状态改造
- 移动端 `Supervisor` 已启用态的默认首屏改为详情视图
- 移动端 `Supervisor` 未启用态的默认首屏改为启用/编辑视图
- 移动端 `Supervisor` root 层状态卡片与操作按钮移除
- 相关单测、样式断言、UI preview 调整

不包含：

- 桌面端 `Supervisor` 卡片与详情弹窗改动
- `Supervisor` 服务端状态、命令、数据模型改动
- 新增移动端禁用入口的替代流程
- `ObjectiveDialogContent` 与 `SupervisorDetailsContent` 的业务字段扩展

### 0.3 相关实现入口

本轮主要涉及以下文件：

- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`
- `packages/web/src/styles/components.css`
- `packages/web/src/styles/components.theme.test.ts`
- `packages/web/src/ui-preview/scenes/showcase-scenes.tsx`

可能复用但不应产生行为漂移的现有组件：

- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- `packages/web/src/features/supervisor/views/shared/supervisor-details-content.tsx`

### 0.4 当前问题

当前移动端 `Supervisor` 在已启用场景下有额外的一层 root 页面：

- 先展示一张状态卡片
- 底部再展示 `Supervisor 详情` 与 `禁用` 两个按钮
- 用户点 `Supervisor 详情` 后，才进入真正需要看的详情内容

这个结构有三个问题：

1. 已启用场景多了一跳，打开入口后没有直接进入用户真正想看的信息层。
2. root 层信息与详情层高度重复，卡片价值低，增加了移动端操作负担。
3. `禁用` 与 `详情` 同级摆放，视觉上像主操作，但用户这次明确不需要移动端禁用入口。

未启用场景虽然已经是直接展示启用表单，但组件内部仍混有 root/detail 双层状态逻辑，导致移动端 `Supervisor` 的结构比实际需要更复杂。

---

## 1. 设计目标与非目标

### 1.1 设计目标

- 让移动端 `Supervisor` 入口行为直接、可预测
- 移除仅用于中转的 root 层
- 保持已启用态的详情查看和编辑能力
- 保持未启用态的快速启用能力
- 在最小改动范围内复用现有详情与编辑内容组件

### 1.2 非目标

- 不在本轮补充“移动端如何禁用 Supervisor”的新替代方案
- 不重写 `SupervisorDetailsContent` 的信息架构
- 不修改桌面端 `Supervisor` 的操作层级
- 不借本轮做 `Supervisor` 视觉风格重设计

---

## 2. 方案选择

### 2.1 候选方案

#### 方案 A：直接复用现有 detail/edit 容器，删除 root 分支

保留现有移动端 sheet、详情内容、编辑内容，只把初始进入逻辑改成：

- 有 `supervisor` 时直接进入 `details`
- 无 `supervisor` 时直接进入 `enable`

并删除 root 层卡片与 `禁用` 按钮。

#### 方案 B：保留统一容器，但重写成显式“初始模式路由”

通过新的 `initialView` 或等价状态来显式控制：

- `details`
- `edit`
- `enable`

仍复用内容组件，但重构状态管理表达。

#### 方案 C：拆成两个独立移动端 sheet

已启用态使用“详情 sheet”，未启用态使用“启用 sheet”，分别维护。

### 2.2 最终选择

本轮采用 **方案 A：直接复用现有 detail/edit 容器，删除 root 分支**。

原因：

- 最符合“直接改成详情弹框”的目标
- 写路径最短，风险最低
- 可以最大限度复用现有 `ObjectiveDialogContent` 和 `SupervisorDetailsContent`
- 只改移动端入口层级，不触碰 `Supervisor` 业务命令

---

## 3. 核心设计决策

### 3.1 移动端入口不再存在 root 层

`MobileSupervisorSheet` 打开后，直接解析当前 session 是否存在 `supervisor`：

- 存在：直接渲染详情视图
- 不存在：直接渲染启用表单

不再展示中间状态卡片页，也不再展示 `Supervisor 详情` / `禁用` 按钮组。

### 3.2 已启用态默认首屏为详情

当当前 session 已启用 `Supervisor` 时，移动端 `Supervisor` 入口首屏应为：

- 标题：`Supervisor Details`
- 主体：`SupervisorDetailsContent`
- 动作：保留现有 `Edit Supervisor` 入口

详情页是该移动端入口的默认页，而不是二级页。

### 3.3 未启用态默认首屏为启用编辑

当当前 session 未启用 `Supervisor` 时，移动端 `Supervisor` 入口首屏应为：

- 标题：`Enable Supervisor`
- 主体：`ObjectiveDialogContent`
- 底部：`Cancel / Enable`

这部分延续现有能力，但去掉与 root 层耦合的状态回退逻辑。

### 3.4 移动端不再提供禁用按钮

本轮移动端 `Supervisor` 中移除 `禁用 Supervisor` 入口：

- root 层按钮移除
- 详情页不新增危险操作按钮
- 编辑页不出现 `disable` 模式

这意味着移动端本轮只保留：

- 查看详情
- 编辑目标
- 启用目标

### 3.5 仅保留“详情 <-> 编辑”回退，不保留“root <-> detail”回退

移动端后续只存在以下导航关系：

- 已启用默认在 `details`
- 从 `details` 点 `Edit Supervisor` 进入 `edit`
- 从 `edit` 点返回，回到 `details`

未启用时：

- 默认在 `enable`
- `Cancel` 或关闭 sheet 直接退出
- 不存在返回到 root 的中间页

### 3.6 顶部返回语义收敛

移动端 `Sheet` 顶部返回按钮只在“从详情进入编辑”的场景出现。

具体规则：

- 已启用详情首屏：不显示返回，只显示关闭
- 已启用编辑态：显示返回，返回到详情
- 未启用启用态：不显示返回，只显示关闭

这样可以避免出现“返回到一个已经被产品删除的 root 层”。

---

## 4. 页面与状态流

### 4.1 已启用场景

入口：

- 用户点击移动端 `Supervisor` badge 或等价入口

默认展示：

- `SupervisorDetailsContent`

可进入：

- `Edit Supervisor`

编辑完成后：

- 成功确认后关闭 sheet
- 若用户通过顶部返回离开编辑，则回到详情页

### 4.2 未启用场景

入口：

- 用户点击移动端 `Supervisor` badge 或等价入口

默认展示：

- `ObjectiveDialogContent(enable)`

确认后：

- 继续沿用当前启用命令与成功关闭行为

取消后：

- 直接关闭 sheet

### 4.3 不再支持的移动端中转状态

以下状态在本轮后移除：

- 已启用场景下的 root 卡片展示页
- root 页中的 `Supervisor 详情` 按钮
- root 页中的 `禁用` 按钮
- 从 detail/edit 回退到 root 的导航关系

---

## 5. 实现设计

### 5.1 组件结构

`MobileSupervisorSheet` 应从“三段渲染分支”收敛为“两种首屏模式 + 一个编辑子态”：

- `details`：已启用场景的默认首屏
- `enable/edit`：编辑类表单视图

建议做法：

- 移除 `mobile-supervisor-sheet--root` 分支
- 移除 `mobile-supervisor-sheet__root`
- 移除 `mobile-supervisor-sheet__actions`
- 把 `detailMode` 或等价状态改成只表达实际需要存在的视图

### 5.2 状态来源

保持现有状态来源不变：

- `useObjectiveDialogState`
- `useSupervisorDetails`
- `supervisorDialogAtom`

但移动端容器的本地状态应只表达：

- 当前是否在 `details`
- 当前是否在 `edit/enable`

不再表达一个仅用于中转的 root 态。

### 5.3 详情与编辑的协作

`SupervisorDetailsContent` 继续通过 `onEdit` 打开编辑态。

编辑态仍复用 `ObjectiveDialogContent`，保留：

- objective 编辑
- evaluator provider 选择
- evaluator model 编辑
- max supervision count 编辑
- scheduled at 编辑

但移动端本轮不应再通过 `disable` 模式复用该表单。

### 5.4 关闭与返回

关闭规则：

- 任一首屏态点击关闭都直接关闭整个 sheet
- 已启用编辑态点击返回，回到详情
- 未启用启用态点击取消，关闭 sheet

这部分需要确保 `close()`、`closeDetails()`、`onClose()` 的调用顺序仍能清理 atom 状态，但不会在关闭时重新打开被移除的 root 层。

### 5.5 样式与 UI Preview

样式层需要同步清理已失效选择器与断言：

- `.mobile-supervisor-sheet--root`
- `.mobile-supervisor-sheet__root`
- `.mobile-supervisor-sheet__actions`

如果 UI preview 仍展示移动端 `Supervisor` root 层，应改成新的详情优先或启用优先场景。

---

## 6. 错误处理

本轮不新增新的业务错误分支，继续沿用现有行为：

- 启用失败：停留在编辑页，由现有命令/提示机制反馈
- 编辑确认失败：停留在编辑页，由现有命令/提示机制反馈
- 详情数据为空或尚未同步：依赖当前 `supervisor` 状态判定，不新增专用空态

需要避免的错误是导航错误：

- 不应出现返回按钮将用户带回已删除的 root 层
- 不应出现关闭 sheet 后再次残留 `details/edit` 状态导致二次打开行为异常

---

## 7. 测试策略

### 7.1 组件测试

需要更新 `mobile-supervisor-sheet.test.tsx`，覆盖以下行为：

- 已启用时首屏直接展示 `Supervisor Details`
- 已启用时不再渲染 root 操作按钮区
- 已启用时可以从详情进入编辑，再返回详情
- 未启用时首屏直接展示启用表单
- 未启用时取消直接关闭，不回退到任何 root 层
- 移动端不再渲染 `Disable` 按钮

### 7.2 样式测试

需要更新 `components.theme.test.ts`：

- 移除对 root 层 class 的存在性断言
- 保留对 detail/footer 兼容性样式断言

### 7.3 回归重点

重点回归：

- 移动端 `Supervisor` badge 打开后的默认页面是否正确
- `Edit Supervisor` 返回链路是否正确
- 未启用场景的启用命令参数是否未回归
- 桌面端 `Supervisor` 卡片和详情弹窗是否未受影响

---

## 8. 风险与缓解

### 8.1 状态残留风险

移动端当前实现同时使用本地 `detailMode` 和全局 dialog/details 状态，删掉 root 层后如果清理不完整，可能出现：

- 关闭后再次打开落在错误子态
- 编辑返回时没有回到详情

缓解方式：

- 明确首屏态来源
- 在 `onClose`、`Cancel`、`Back` 三条路径上分别写测试

### 8.2 共享组件行为耦合风险

`ObjectiveDialogContent` 和 `SupervisorDetailsContent` 同时被桌面端与移动端复用，改动移动端容器时不能把桌面端语义一并改坏。

缓解方式：

- 把改动限制在 `mobile-supervisor-sheet.tsx` 容器层
- 共享组件只在必要时做无行为漂移的适配

---

## 9. 最终决策摘要

本轮将移动端 `Supervisor` 从“root 卡片页 + detail 页”的双层结构，收敛成“直接详情 / 直接编辑”的单入口结构。

最终行为固定为：

- 已启用：直接打开详情
- 未启用：直接打开编辑
- 移动端不再提供禁用按钮

实现上以最小改动复用现有详情与编辑组件，只移除移动端 root 层与对应导航关系。
