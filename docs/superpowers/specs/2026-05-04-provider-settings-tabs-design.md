# Provider 设置页二级导航改造 · 设计文档

> **版本：** 1.0
> **日期：** 2026-05-04
> **状态：** Draft（等待评审）
> **关联文档：**
> `docs/PRD.zh-CN.md` §13
> `docs/PRD.md` §13
> **作者：** 技术共同设计 — Spencer + Codex

---

## 0. 文档说明

### 0.1 目的

重构 `Settings > Providers` 页的信息架构，把当前“基础配置 + 配置文件编辑”纵向平铺的结构，调整为更符合任务分层的二级导航结构：

- 桌面端：`Provider` 切换下新增 `基础配置 | 配置文件` 二级导航
- 移动端：默认进入 `基础配置`，`配置文件编辑` 作为次级入口单独进入

目标是降低设置页的认知负担，同时保留高级用户对配置文件的直接编辑能力。

### 0.2 背景

当前 `Providers` 页的结构是：

1. 第一层 `Claude | Codex` provider tab
2. provider 内容区内依次平铺：
   - 启动命令参数
   - Command Preview
   - Config Editor

这一结构存在两个问题：

1. `启动参数/命令预览` 和 `配置文件编辑` 属于两种不同任务，被迫混在同一滚动流中
2. `ConfigEditor` 的视觉重量和交互复杂度明显高于普通设置项，容易压过真正高频的基础配置

结果是：

- 桌面端页面层级不够清晰
- 移动端小屏上内容体量偏重
- 用户在“表单配置”与“代码编辑”两种心智之间频繁切换

### 0.3 设计目标

- 保留现有 `Settings` 一级导航结构，不新增新的 settings 一级分类
- 保留 `Claude | Codex` 作为 provider 一级切换
- 将 `基础配置` 与 `配置文件编辑` 明确拆分为两个次级视图
- 桌面端切换路径短，适合高频操作
- 移动端信息密度受控，不把大编辑器直接堆进主视图
- 避免切换子视图时丢失未保存的配置文件编辑内容
- 尽量复用现有 `SettingsPage`、`ConfigEditor` 和样式体系，控制改动范围

### 0.4 非目标

- **不**重做 `SettingsPage` 的一级结构或路由体系
- **不**新增真正的独立浏览器路由，如 `/settings/providers/:provider/config`
- **不**扩展 provider 新字段或新增新的 provider 能力配置
- **不**在本次改动中统一重写所有过期的 phase2 e2e 用例，只修正与 provider 结构直接相关的部分
- **不**把 provider 子视图状态持久化为长期用户偏好

---

## 1. 方案比较

### 1.1 方案 A：桌面端/移动端统一使用二级 Tab

在 `Claude | Codex` 下方统一再加一层 `基础配置 | 配置文件` tab，桌面端和移动端完全一致。

优点：

- 结构统一，理解成本低
- 组件实现直接
- 桌面端和移动端状态模型相同

缺点：

- 移动端层级偏多，小屏下横向导航拥挤
- `ConfigEditor` 在移动端仍然会直接占据主内容区
- 看起来更像“桌面布局缩小”，而不是针对小屏重新组织

### 1.2 方案 B：桌面端二级 Tab，移动端次级入口（推荐）

桌面端在 `Claude | Codex` 下方新增 `基础配置 | 配置文件` 二级导航；移动端进入 provider 后默认展示 `基础配置`，`配置文件编辑` 通过单独次级入口进入。

优点：

- 桌面端保持高效率，切换直接
- 移动端信息密度可控，不把大编辑器直接暴露在主视图
- 更贴合当前 settings 移动端“列表进入详情”的交互模式
- `ConfigEditor` 在移动端能获得更完整的独立空间

缺点：

- 桌面端与移动端交互不完全一致
- 需要额外一层 provider 内部本地导航状态

### 1.3 方案 C：配置文件编辑拆成独立 settings 子页

把 `ConfigEditor` 提升为更重的独立详情页或内部子路由，而不是 provider 内二级导航。

优点：

- 信息架构最清晰
- 配置文件编辑空间最大
- 后续扩展高级配置更容易

缺点：

- 对本次需求来说偏重
- 需要更强的页面状态管理和返回逻辑
- 改动范围与测试成本最高

### 1.4 最终选择

采用 **方案 B**。

理由：

- 需求核心是“把两类任务拆开”，不是“重做 settings 路由”
- 桌面端需要高效切换，移动端需要收敛层级
- 方案 B 能在最小改动范围内同时满足两类终端的使用方式

---

## 2. 最终设计

### 2.1 总体信息架构

`Settings` 一级结构保持不变：

- General
- Providers
- Appearance
- Shortcuts

`Providers` 页内部结构调整为两层：

1. 第一层：provider 切换
   - `Claude`
   - `Codex`
2. 第二层：provider 内部视图
   - `基础配置`
   - `配置文件`

但第二层呈现方式按终端区分：

- 桌面端：直接展示为二级 tab
- 移动端：默认显示 `基础配置`，`配置文件编辑` 通过次级入口进入

### 2.2 桌面端交互

桌面端 `Providers` 视图结构为：

1. `Claude | Codex` provider tab
2. `基础配置 | 配置文件` 二级 tab
3. 对应的内容区

行为规则：

- 首次进入 `Providers` 时，默认选中第一个 provider
- 二级视图默认落在 `基础配置`
- 当用户切换 provider 时，保留当前二级视图意图
  - 如果当前在 `配置文件`，切换到另一个 provider 后，仍然停留在 `配置文件`
  - 如果当前在 `基础配置`，切换后继续停留在 `基础配置`

桌面端内容分工：

- `基础配置`
  - 启动命令参数
  - Command Preview
  - 必要说明文案
- `配置文件`
  - Config Editor
  - 与配置文件相关的上下文说明

### 2.3 移动端交互

移动端沿用现有 settings 的“根列表 -> 详情页”思路，但 provider 内再细分一层内部视图状态。

行为规则：

- 用户从 settings root 进入 `Providers`
- 进入后先看到 provider 切换和 `基础配置`
- 主视图内提供一个次级入口，例如“打开配置文件编辑”
- 点击后进入 provider 的 `配置文件编辑` 子视图
- 子视图顶部返回只回到当前 provider 的 `基础配置`
- 如果用户在移动端 `配置文件编辑` 子视图中切换 provider，强制回到该 provider 的 `基础配置`

这样做的原因是：

- 小屏下不叠加横向二级 tab，减少拥挤
- 避免在不同 provider 的编辑器之间横跳，降低迷失感
- 让配置文件编辑成为明确的“深入操作”

### 2.4 视觉和层级原则

本次改动不改变 settings 的整体视觉语言，继续遵循当前产品风格：

- 深色工具型界面
- 细边框、低对比表面、明确状态色
- IBM Plex Sans + JetBrains Mono
- 短时长、克制的交互反馈

具体约束：

- provider 第一层 tab 继续复用现有 `.settings-provider-tab` 风格
- provider 第二层导航不复用 `settings-pill` 的语义样式
- 第二层导航应更接近“页内导航”，避免与 `Appearance` 中的单选 pill 混淆
- `配置文件` 视图中减少无效留白，让 `ConfigEditor` 更快进入主要可视区

---

## 3. 组件设计

### 3.1 组件拆分

建议把当前写在 `settings-page.tsx` 内的 `ProviderSettings` 拆分出来，形成清晰的 provider 设置模块。

推荐结构：

- `ProviderSettings`
  - `ProviderSwitcher`
  - `ProviderSubnav`（仅桌面端）
  - `ProviderBaseSettingsPanel`
  - `ProviderConfigFilePanel`

职责划分：

- `ProviderSwitcher`
  - 渲染 `Claude | Codex`
  - 维护当前 provider 选择
- `ProviderSubnav`
  - 渲染桌面端 `基础配置 | 配置文件`
  - 不承载业务逻辑，只负责视图切换
- `ProviderBaseSettingsPanel`
  - 管理启动参数输入与 preview 展示
- `ProviderConfigFilePanel`
  - 渲染配置文件标题说明与 `ConfigEditor`

### 3.2 SettingsPage 保持轻量

`SettingsPage` 继续负责：

- 一级 section 切换
- 移动端 root/detail 导航
- settings 顶层公共 banner 和 footer

`ProviderSettings` 内部负责 provider 相关的全部次级交互，不把 provider 特有的状态继续扩散回 `SettingsPage`。

---

## 4. 状态模型

### 4.1 已有状态

当前实现已经包含：

- 顶层 `Settings` 导航状态
- 当前 provider 选择
- `additionalArgsById`
- `commandPreview`

### 4.2 新增状态

本次新增两个轻量 UI 状态即可：

- 桌面端 `providerDetailView: 'base' | 'config'`
- 移动端 `providerMobileView: 'base' | 'config'`

设计原则：

- 这是页面内导航状态，不是长期用户偏好
- 初始值均为 `base`
- 本次不写入 `localStorage`

### 4.3 状态切换规则

桌面端：

- 切换 provider：保留 `providerDetailView`
- 切换二级 tab：仅更新 `providerDetailView`

移动端：

- 进入 `Providers` 详情：`providerMobileView = 'base'`
- 点击“打开配置文件编辑”：`providerMobileView = 'config'`
- 从 `配置文件编辑` 返回：`providerMobileView = 'base'`
- 在 `config` 状态下切换 provider：强制 `providerMobileView = 'base'`

### 4.4 Command Preview 状态修正

当前 `commandPreview` 使用单一字符串状态，存在 provider 切换与异步返回交错时串写的风险。

本次建议顺手修正为以下两种方式之一：

1. 按 provider 维度维护 preview 状态
2. 把 preview 状态下沉到 `ProviderBaseSettingsPanel`，并在 effect 中加入过期请求保护

本设计更推荐方案 2，因为 preview 只属于 `基础配置` 视图，状态下沉后职责更清晰。

---

## 5. ConfigEditor 生命周期要求

### 5.1 问题

如果 `ConfigEditor` 在切换二级视图时被直接卸载，未保存的编辑内容会丢失。这会造成明显的使用风险。

### 5.2 设计要求

对每个 provider 的 `ConfigEditor` 采用“首次打开后保持挂载”的策略：

- 未访问过该 provider 的 `配置文件` 视图前，不预先创建 editor
- 第一次进入时再挂载对应 editor
- 后续切回 `基础配置` 时，只隐藏 editor，不销毁 editor
- `Claude` 与 `Codex` 的 editor 实例相互独立

### 5.3 预期效果

- 未保存内容在 provider 内切换视图后仍保留
- 避免首次进入 `Providers` 就初始化多个 Monaco 实例
- 降低对现有 `ConfigEditor` 内部保存逻辑的侵入性

---

## 6. 文案与样式改动

### 6.1 新增文案 key

建议新增以下翻译 key：

- `settings.provider.base`
- `settings.provider.config_file`
- `settings.provider.open_config_file_editor`
- `settings.provider.back_to_base`

如移动端入口需要补充说明，也可以增加：

- `settings.provider.config_file_hint`

### 6.2 样式改动范围

样式继续集中在 `packages/web/src/styles/components.css`。

需要新增的样式类型：

- provider 二级导航容器
- provider 二级导航按钮 active/hover 状态
- 移动端“打开配置文件编辑”入口
- 移动端配置文件子视图顶部返回区
- 配置文件视图更紧凑的内容布局

本次不引入新的全局设计 token。

---

## 7. 错误处理与边界情况

### 7.1 ConfigEditor 读取失败

保持现有 `ConfigEditor` 的错误态呈现，不因新导航结构改变错误处理策略。

### 7.2 ConfigEditor 文件不存在

保持现有“文件不存在”空态，不新增额外 provider 层包装逻辑。

### 7.3 Preview 请求失败

`基础配置` 视图继续展示 preview 错误兜底，但需要确保错误只影响当前 provider 的当前视图，不串到其他 provider。

### 7.4 未保存内容

本次不新增全局“离开前确认”机制，但必须保证：

- 在同一 provider 内从 `配置文件` 切到 `基础配置` 时不丢内容
- 在桌面端切换 provider 后，已访问过的 provider editor 内容仍保留

---

## 8. 测试设计

### 8.1 单元/组件测试

需要重点覆盖：

- 桌面端进入 `Providers` 后默认显示 `基础配置`
- 桌面端切到 `配置文件` 后才显示对应 `ConfigEditor`
- 桌面端切换 provider 时保留当前二级视图
- 移动端进入 `Providers` 默认显示 `基础配置`
- 移动端点击“打开配置文件编辑”后进入 `config` 子视图
- 移动端在 `config` 子视图切换 provider 后回到 `base`
- preview 状态不因 provider 切换而串写

### 8.2 现有测试修正

`packages/web/src/features/settings/components/settings-page.test.tsx` 中部分断言仍基于旧结构，需要更新。

`e2e/specs/phase2/provider.spec.ts` 中还存在明显过期断言，例如：

- model 选择
- cwd override
- hooks
- API key

这些内容与当前 provider settings 实现已不一致。此次改动应至少把该文件修正为围绕新结构的可用基线。

### 8.3 E2E 核心验收点

建议保留以下最小高价值验收点：

- 进入 `Settings > Providers` 可见 `Claude | Codex`
- 桌面端可在 `基础配置 | 配置文件` 间切换
- 移动端默认显示 `基础配置`
- 移动端可通过次级入口进入配置文件编辑
- 切换 provider 后对应配置内容正确更新

---

## 9. 实现边界与交付顺序

### 9.1 主要改动文件

- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/settings/components/config-editor.tsx`
- `packages/web/src/styles/components.css`
- `packages/web/src/locales/zh.json`
- `packages/web/src/locales/en.json`

建议新增：

- `packages/web/src/features/settings/components/provider-settings.tsx`

如需要更清晰的模块边界，可继续拆成：

- `provider-base-settings-panel.tsx`
- `provider-config-file-panel.tsx`

### 9.2 推荐交付顺序

1. 抽离 `ProviderSettings`，保持旧行为不变
2. 引入桌面端二级导航并完成 `基础配置 / 配置文件` 拆分
3. 引入移动端 `base / config` 子视图与次级入口
4. 加入 `ConfigEditor` 的首次打开后保活策略
5. 修正 preview 状态边界与测试

这样可以把结构重组、交互变更和状态风险拆开验证，降低回归概率。
