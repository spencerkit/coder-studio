# PC 端样式精修 · 设计文档

> **版本：** 1.0
> **日期：** 2026-05-14
> **状态：** Draft（等待评审）
> **作者：** Spencer + Codex

---

## 0. 文档说明

### 0.1 目的

针对当前 `packages/web` 的 PC 端界面做一轮以“消除样式割裂、补全设计规范、提升主路径观感一致性”为目标的精修。

本轮不是重做视觉风格，也不是只修几个页面的表面问题，而是把以下三层同时收拢：

- 设计 token 与基础样式中的缺口
- 组件与页面 chrome 之间不一致的视觉语言
- `e2e-ui` 对桌面主场景的审图覆盖不足

### 0.2 背景

当前项目已经具备较好的前提：

- `packages/web/src/styles/tokens.css` 已建立基础设计 token，含多主题、间距、字号、圆角、阴影和状态色
- `packages/web/src/components/ui/` 已完成一轮组件库迁移，基础控件不再完全依赖裸 class 拼接
- `e2e-ui/` 已经能稳定产出 PC / Mobile、主题、语言矩阵截图
- `ui-preview` 已覆盖 welcome、settings、workspace、auth、command-palette、workspace-launch-modal 等主路径场景

但 PC 端仍存在以下问题：

- 主页面之间的层级语言不统一：入口页、设置页、workspace、浮层各自成风格片段
- light theme 的表面层级偏弱，很多区域只靠细边框区分，信息密度和留白节奏不稳定
- 部分基础样式和 token 存在断口，导致视觉规则并不完全可依赖
- `components.css` 体量过大，PC 主样式长期以追加方式维护，容易形成覆盖链和局部例外

### 0.3 设计目标

- 建立一套可持续的 PC 端视觉基线，而不是一次性修图
- 补齐 token / 基础语义层，让主题、状态、surface 层级有稳定真相源
- 统一 PC 主路径的桌面产品语言：
  - Welcome / Auth / Not Found
  - Settings
  - Workspace Desktop
  - 桌面浮层与弹窗
- 强化 `e2e-ui` 的桌面审图能力，使其能服务后续样式回归和 agent 分析

### 0.4 非目标

- 不改移动端主视觉方向
- 不重做主题体系，不新增新的主题 family
- 不在本期做大规模组件 API 重构
- 不把所有全局样式一次性拆完
- 不引入新的视觉测试基础设施

---

## 1. 现状诊断

### 1.1 规范层断口

当前样式系统不是完全闭环，至少存在以下客观问题：

- [packages/web/src/styles/base.css](/root/workspace/coder-studio/packages/web/src/styles/base.css:54) 中 `h2` 使用了不存在的 `var(--2xl)`
- [packages/web/src/styles/components.css](/root/workspace/coder-studio/packages/web/src/styles/components.css:296) 等位置引用了 `--accent-red`
- [packages/web/src/styles/components.css](/root/workspace/coder-studio/packages/web/src/styles/components.css:406) 等位置引用了 `--bg-panel`
- [packages/web/src/styles/components.css](/root/workspace/coder-studio/packages/web/src/styles/components.css:1903) 等位置引用了 `--text-muted`

这些问题说明：

- token 命名仍混有历史别名和未收敛语义
- 页面与组件并未严格共享同一套设计词汇
- 主题切换时局部样式可能退化为浏览器 fallback 或继承值

### 1.2 样式源过于集中

当前主样式通过 [packages/web/src/main.tsx](/root/workspace/coder-studio/packages/web/src/main.tsx:15) 与 [packages/web/src/ui-preview/main.tsx](/root/workspace/coder-studio/packages/web/src/ui-preview/main.tsx:8) 统一引入 `components.css`。

问题不在“全局引入”本身，而在于：

- [packages/web/src/styles/components.css](/root/workspace/coder-studio/packages/web/src/styles/components.css:1) 已超过 11k 行
- 设置页主块从 [597 行](/root/workspace/coder-studio/packages/web/src/styles/components.css:597) 开始
- workspace 主块从 [10366 行](/root/workspace/coder-studio/packages/web/src/styles/components.css:10366) 开始
- 多轮功能迭代后，同类样式经常依赖后续追加规则修正，而不是统一抽象

结果是：

- 页面看起来能用，但难形成稳定、可复用的桌面视觉规则
- light / dark 间的设计完成度不一致
- 后续继续修样式很容易再次产生局部例外

### 1.3 页面观感问题

通过现有 `e2e-ui/output` 桌面截图可归纳为四类问题：

#### A. Welcome / Auth / Not Found 入口页

- 信息结构清楚，但主次层级偏平
- 卡片、按钮、次链接和 feature 卡片像来自两套不同密度系统
- light theme 下入口页容易显得空、薄、缺少中心聚焦

#### B. Settings

- dark theme 可读性尚可，但 section 间的节奏不稳
- light theme 中，sidebar、content、control surface 之间的层级差太小
- 表单、toggle、section header、footer 没完全进入统一的桌面设置语言

#### C. Workspace Desktop

- 信息架构完整，但 topbar、left panel、main stage、bottom panel、status bar 的层次过近
- 主要依赖边框切分而不是 surface / density / accent 的协同
- 文件树、Git 面板、terminal empty、session launcher 彼此风格关系还不够紧

#### D. Overlay / Modal

- 命令面板、启动工作区弹窗、worktree manager 已有基本样式
- 但浮层的视觉语言还偏“通用组件壳”，未完全继承 desktop shell 的产品气质

---

## 2. 关键设计决策

| # | 决策 | 取舍理由 |
|---|---|---|
| D1 | 先补规范层，再修主页面观感 | 只修页面表面会被底层 token / 历史样式继续反噬 |
| D2 | 本轮聚焦 PC 主路径，不同时铺开移动端 | 控制改动面，确保桌面观感先形成稳定基线 |
| D3 | 不重做主题体系，只补齐语义 token 与 surface 层级 | 现有主题 family 已足够，问题在语义收敛而非主题数量 |
| D4 | 对 `components.css` 做分区收拢，而不是一次性彻底拆分 | 兼顾风险与收益，先降低局部维护复杂度 |
| D5 | `e2e-ui` 增加 PC 审图场景作为精修配套资产 | 后续样式精修必须有可复查、可横向比对的产物 |
| D6 | 精修优先顺序固定为：入口页 → Settings → Workspace → Overlay | 这是用户感知最强、也是视觉语言最基础的路径 |

---

## 3. 设计方案

### 3.1 规范补齐层

本层目标是把“设计规范不完整”的问题补平，让页面精修建立在稳定底座上。

#### 3.1.1 token 收敛

补齐并统一以下语义层：

- text:
  - `--text-primary`
  - `--text-secondary`
  - `--text-tertiary`
  - `--text-muted`
- surface:
  - `--bg-page`
  - `--bg-surface`
  - `--bg-sidebar`
  - `--bg-input`
  - `--bg-panel`
  - `--bg-elevated`
- accent / semantic:
  - `--accent-blue`
  - `--accent-green`
  - `--accent-amber`
  - `--accent-pink`
  - `--accent-red`
  - `--color-success`
  - `--color-warning`
  - `--color-error`
  - `--color-info`

其中：

- 如果已有语义可直接复用，应以别名方式向后兼容
- 如果历史变量名与新语义重复，应统一对外推荐名，并逐步清理旧引用

#### 3.1.2 基础排版修正

修复基础层明显错误与不完整处：

- `h2` 字号变量引用错误
- 页面级 heading、kicker、section title 的字号与字重映射不够明确
- mono 信息层在 settings / workspace / modal 中的使用没有统一语气

需要建立 PC 端文案层级约束：

- 页面标题
- 页面 kicker
- section 标题
- 元信息文字
- 辅助 hint
- 状态标签 / meta

#### 3.1.3 桌面布局 token

补出一组只服务于 PC 的布局 token，避免页面持续内联 magic number：

- `--desktop-topbar-height`
- `--desktop-statusbar-height`
- `--desktop-sidebar-header-height`
- `--desktop-panel-padding`
- `--desktop-panel-gap`
- `--desktop-content-max-width`
- `--desktop-modal-max-width-*`

### 3.2 页面精修层

#### 3.2.1 Welcome / Auth / Not Found

目标：

- 建立统一的“入口页语言”
- 增强中心聚焦与主次层级
- 让 light / dark 都有稳定的视觉完成度

具体方向：

- Welcome 卡片、Auth 卡片、Not Found 卡片共享同一组入口页容器规则
- 主 CTA、次操作、信息卡片采用统一的间距与表面层级
- feature 区块减少“独立组件拼装感”，更像同一信息版式系统
- 入口页在 light theme 下增加更稳定的 surface 对比，而不是平铺浅底

#### 3.2.2 Settings

目标：

- 让 Settings 成为规范最完整的桌面内容页
- 统一 sidebar、content、field group、footer 的视觉秩序
- 提升 light theme 的层级辨识度

具体方向：

- 强化 sidebar 与 content 的表面对比，但避免过重分割
- section 标题、描述、表单行、状态信息统一密度节奏
- Appearance、Shortcuts、Providers、General 四个 section 在结构上统一，不再像四套局部样式
- footer autosave / version 信息弱化为真正的辅助层，不与正文抢注意力

#### 3.2.3 Workspace Desktop

目标：

- 让 workspace shell 的桌面气质更完整
- 建立清晰的 chrome 层次：topbar / sidebar / stage / bottom panel / status bar
- 提升文件树、git panel、session launcher、terminal empty 之间的一致性

具体方向：

- topbar 从“条状容器”提升为稳定的应用 chrome
- sidebar header、tabs、toolbar action、搜索框、tree item 统一密度与交互语气
- selected / hover / active 不再只靠边线和轻底色区分
- bottom panel 和 status bar 需要与主内容区形成更清楚的职责边界

#### 3.2.4 Overlay / Modal

目标：

- 让命令面板、启动工作区、worktree manager 等浮层继承 desktop shell 的语言
- 降低“通用弹窗壳”的感觉

具体方向：

- 统一 overlay、card、header、body、footer 的桌面浮层结构
- 命令面板强化 search / result / shortcut / active item 的层级
- 启动工作区弹窗强化路径导航、目录列表、主操作区的分区关系
- 桌面弹窗的尺寸、边框、阴影、surface elevation 使用统一规范

### 3.3 `e2e-ui` 补强层

当前 `ui-preview` 已覆盖主页面和部分 showcase 场景，见 [packages/web/src/ui-preview/scene-metadata.ts](/root/workspace/coder-studio/packages/web/src/ui-preview/scene-metadata.ts:37)。

本轮需新增一组专门服务 PC 审图的 scene：

- `workspace-topbar-review`
- `workspace-sidebar-files-review`
- `workspace-sidebar-git-review`
- `workspace-terminal-empty-review`
- `settings-density-review`
- `settings-light-theme-review`
- `desktop-overlay-review`
- `desktop-statusbar-review`

这些 scene 的目标不是替代真实页面，而是：

- 把桌面 chrome 里最容易割裂的部分做成稳定对照资产
- 缩短每次样式调整后的人工核对成本
- 为 agent 提供更可比的视觉输入

---

## 4. 实施阶段

### 4.1 Phase A：规范补齐

范围：

- `tokens.css`
- `base.css`
- 组件层对未定义 token 的引用

产出：

- token 断口补齐
- 基础排版修正
- PC 布局语义 token 建立

完成标准：

- 不再存在未定义 token 被直接引用
- 基础 heading / text 层级映射明确
- 页面精修不再依赖“临时补变量”

### 4.2 Phase B：入口页与 Settings

范围：

- Welcome
- Auth
- Not Found
- Settings 全 section

产出：

- 统一入口页语言
- Settings 桌面页结构收敛
- light theme 分层明显改善

完成标准：

- `welcome`、`auth-preview`、`not-found`、`settings-*` 在桌面截图里不再呈现明显风格跳变

### 4.3 Phase C：Workspace Desktop

范围：

- desktop shell
- topbar
- left panel
- file tree / git panel
- terminal empty / session launcher
- status bar

产出：

- 桌面 workspace chrome 完整统一
- 常见 hover / selected / active 状态更稳定

完成标准：

- `workspace-desktop` 与新增 review scenes 在 light / dark 下都具有清晰层级

### 4.4 Phase D：Overlay 与审图补强

范围：

- command palette
- workspace launch modal
- worktree manager
- `e2e-ui` 新增桌面审图场景

产出：

- 桌面浮层语言统一
- 审图体系补齐

完成标准：

- 新旧桌面浮层风格收口
- `e2e-ui` 可作为后续 PC 样式回归基线

---

## 5. 验收标准

### 5.1 视觉验收

- Welcome / Auth / Not Found 共享统一入口页语法
- Settings 在 light / dark 下均具备清晰 surface 层级
- Workspace Desktop 的 chrome 层次明显优于当前版本
- Overlay 与主壳语言一致，不再显得脱节

### 5.2 规范验收

- 样式系统中不存在继续依赖未定义 token 的规则
- 基础排版和页面级标题层级可复用，不再靠页面私有修正
- 新增 PC 布局 token 被主页面实际采用

### 5.3 工程验收

- `e2e-ui` 新增桌面审图场景可稳定产出截图
- 不引入新的样式“补丁式堆叠”区域
- 改动后样式规则的归属更清晰，至少按入口页 / settings / workspace / overlay 四组收拢

---

## 6. 风险与约束

### 6.1 风险

- 如果只做页面表面微调而不补 token，后续主题回归仍会不稳定
- 如果在 `components.css` 末尾继续叠加修补规则，长期复杂度不会下降
- workspace 精修牵涉区域较多，必须依赖审图场景辅助核对

### 6.2 约束

- 本轮不改移动端主视觉，因此 PC 提取出的新规范要避免误伤移动端
- 本轮不做大规模组件 API 迁移，优先通过 token、样式归组和页面层修整完成目标
- 必须以现有主题 family 为基础，不新增视觉方向

---

## 7. 推荐实施顺序

推荐严格按以下顺序推进：

1. 修 token / base 层断口
2. 修入口页
3. 修 Settings
4. 修 Workspace Desktop
5. 修 Overlay
6. 补 `e2e-ui` 桌面审图场景

原因：

- 前两步能最快建立统一语言
- Settings 是最容易做成规范样板的内容页
- Workspace 是复杂度最高、但最需要稳定基线的桌面核心场景
- Overlay 最适合在主壳语言成型后统一收口

---

## 8. 实施前提

在开始具体改造前，需要接受以下前提：

- 这是一次“规范 + 页面”并行的精修，而不是单纯视觉润色
- 允许对 `tokens.css`、`base.css`、`components.css` 和主页面样式块做有组织的结构性调整
- `e2e-ui` 会作为本轮精修的主要验收辅助工具之一

---

## 9. 结论

本轮 PC 精修的重点不是“把几个页面做得更好看”，而是建立一套能持续支撑桌面端演进的视觉规则。

最合适的策略是：

- 先补规范层断口
- 再按入口页、Settings、Workspace、Overlay 的顺序精修主路径
- 最后用 `e2e-ui` 把桌面审图场景补齐，形成后续回归基线

这样做的结果不是一次性的样式整理，而是一套更稳定的 PC 端设计基础设施。
