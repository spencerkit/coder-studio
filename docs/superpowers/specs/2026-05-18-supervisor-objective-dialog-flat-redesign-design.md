# Supervisor Objective Dialog Flat Redesign

Date: 2026-05-18
Status: Draft
Owner: Codex

## Problem

当前 `Enable Supervisor / Edit Supervisor` 弹层虽然已经迁移到共享 `Modal`、`Input`、`Textarea`、`Select` primitive，但视觉上仍然比站内其他设置面板更重：

- 顶部的独立大卡片占据了过多垂直空间
- 表单字段使用 `lg` 输入尺寸，整体显得偏大、偏松
- `Textarea` 的 code-style 观感过强，更像技术说明块而不是设置表单
- 禁用态 warning callout 的视觉体积偏大，和“扁平设置面板”目标不一致

这导致该弹层与当前项目里更紧凑的面内设置表单不在同一设计系统层级。

## Goals

- 让 Supervisor 目标弹层更接近“面内平铺设置面板”的设计语言。
- 压缩顶部信息区，不再让说明块主导视觉层级。
- 将整体字号收紧一档，输入控件内容进一步收紧到约 `12px` 对应 token。
- 保持现有信息结构、字段顺序和行为，不改动 Supervisor 功能逻辑。

## Non-Goals

- 不改动 `ObjectiveDialog` 的业务提交流程、字段定义或命令 payload。
- 不重做共享 `Modal`、`Input`、`Textarea`、`Select` 全局 token。
- 不改变移动端 `MobileSupervisorSheet` 的交互模型。
- 不新增新的公开 UI primitive。

## User Decisions Captured

- 视觉方向需要对齐其他页面的“面内平铺设置面板”。
- 顶部可以保留说明，但不能像当前版本那样占据大量空间。
- 整体字号降一档。
- 输入框字号再降一档，目标约 `12px`。

## Approaches Considered

### Option A: 彻底移除顶部说明块

优点：

- 最紧凑
- 最接近普通设置表单

缺点：

- Supervisor 的语义提示明显减弱
- 首次启用时缺少轻量上下文说明

### Option B: 保留压缩后的扁平信息条（推荐）

优点：

- 仍然保留“这是什么 / 会发生什么”的上下文
- 不再形成独立视觉大卡片
- 更容易和表单内容形成连续的设置面板结构

缺点：

- 比完全移除说明区多一行上下文占位

### Option C: 保留现有大卡片，只做字号缩小

优点：

- 改动最小

缺点：

- 不能解决空间占用和视觉层级过重的问题
- 仍然与“扁平设置面板”方向不一致

## Final Choice

采用 Option B。

桌面端 `ObjectiveDialog` 仍保留 header，但正文顶部的 Supervisor 介绍区收敛为一条扁平信息条，不再使用独立大卡片。表单字段整体转向更紧凑的设置面板节奏，输入内容统一落到更小字号层级。

## Final Design

### 1. Dialog Structure

`ObjectiveDialog` 的结构保持：

- `DialogHeader`
- `ModalBody`
- `ModalFooter`

但 `ModalBody` 内部重排为：

1. 扁平信息条
2. 连续表单字段组
3. disable 模式下的轻量 warning 区和当前 objective 预览

不再在正文顶部使用独立的粗边框大卡片。

### 2. Header And Intro Treatment

`DialogHeader` 继续承担标题与关闭操作，不新增新的 header 体系。

正文顶部新增或保留一个更轻的 intro 区，特点为：

- 横向排列的小图标 + 文案
- 无单独厚重边框
- 使用轻量背景或弱分隔线，而不是“卡片里再包卡片”
- 标题使用比当前内容更克制的层级
- 说明控制在 1 到 2 行

enable / edit 模式下保留该 intro。
disable 模式不再展示 intro，直接进入 warning + objective 预览。

### 3. Typography

整体规则：

- label、helper、次级说明统一向 `label/meta` 层级收敛
- 输入内容统一收敛到 `12px` 左右的 token
- 不引入新的硬编码字号，优先使用现有 token

具体落点：

- intro 标题：`var(--type-body-size)` 或同级别更紧凑 token
- intro 说明：`var(--type-meta-size)`
- 表单 label：继续使用 `var(--type-label-size)`
- helper text：继续使用 `var(--type-meta-size)`
- 输入、下拉、时间选择器的可见文本：收敛到 `var(--type-label-size)`
- `Textarea` 仍可保留 mono family，但字号改为 `var(--type-code-inline-size)`，避免大号 code block 感

### 4. Form Density

enable / edit 模式下：

- 文本输入从 `lg` 改为更紧凑尺寸
- `Textarea` 去掉“大号表单”观感，最小高度保留足够可读性，但明显低于当前视觉重量
- 字段组间距从当前偏松的弹层节奏收紧到更接近设置页的连续堆叠
- footer 保持双按钮，不改变行为

这次调整的重点不是减少字段，而是压缩每个字段自身的体积与字段间冗余留白。

### 5. Disable State

disable 模式保留风险提示，但样式收敛为轻量 warning panel：

- 更薄的边框和更轻的背景
- 更小的内边距
- 不再依赖强烈的块状强调
- 标题与正文的字号均收紧

`objective-preview` 保留预格式化展示，但与新的 warning panel 和整体表单密度保持一致。

### 6. Files To Update

- `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`
- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- `packages/web/src/styles/components.css`
- 相关单元测试与样式契约测试

### 7. Testing

需要验证：

- 桌面端 `ObjectiveDialog` 仍正常渲染与提交
- enable / edit / disable 三种模式的结构和文案不回归
- 顶部 intro 从“大卡片”变为扁平信息条
- 输入类控件不再使用 `lg` 尺寸
- 样式测试更新为新的扁平化 contract，而不是旧的大卡片视觉假设

## Implementation Notes

- 优先通过现有组件 size 和 feature-local class 调整，不修改全局输入 token。
- 保持 `DialogHeader` 的 canonical anatomy，不绕开共享 modal header 结构。
- 若需要为 intro 区增加新 class，应限定在 `.supervisor-dialog` 范围内，避免污染其他 dialog。
