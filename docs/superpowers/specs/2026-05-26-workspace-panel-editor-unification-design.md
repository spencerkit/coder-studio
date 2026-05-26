# Workspace 文件管理面板编辑器化统一设计

> Status: Draft
> Date: 2026-05-26
> Scope: `packages/web/src/features/workspace/views/shared/*`, `packages/web/src/features/workspace/views/mobile/*`, `packages/web/src/styles/components.css`, `packages/web/src/styles/components.theme.test.ts`

## 目标

统一当前 workspace 文件管理面板在桌面端和移动端的视觉语言，让 `Explorer`、`Search`、`Source Control` 三个面板更像同一套专业编辑器 workbench，而不是三个独立产品。

本轮目标：

- 保留现有桌面端 `Activity Bar + Sidebar View` 的信息架构
- 保留移动端 `Explorer / Search / Git` 三视图切换模型
- 收敛三块面板的圆角、边距、标题区、输入框、列表行、状态样式
- 将整体气质收敛到 `小圆角 / 硬朗 / 克制 / 高扫描效率`
- 保证浅色、深色和高对比主题下都继续走现有 token 体系

本轮不做：

- 不增加新的面板能力或 Git 工作流
- 不重做桌面端信息架构
- 不引入页面私有主题或绕过 token 的硬编码颜色体系
- 不把移动端做成另一套更圆、更软的移动 App 风格

## 相关背景

当前代码和已有设计已经完成了几件正确的事：

- 桌面端已经是 `Activity Bar + Explorer / Search / Source Control`
- `Search` 已经有独立内容搜索面板
- 移动端已经接入 `Explorer / Search / Source Control`
- 文件树、搜索结果、Git 列表都已经有独立共享组件

但视觉语言仍然没有完全统一：

- `Explorer` 更像树控件
- `Search` 更像独立搜索工具
- `Git` 仍有较重的表单和局部卡片感
- 移动端虽然已扁平化，但和桌面端还不是完全同一套 panel grammar

用户已确认的方向：

- 整体采用小圆角、硬朗设计风格
- 三块面板必须统一成一套视觉系统
- 选中态不要左侧强调条，改为更完整、更干净的块级高亮
- 需要特别注意视觉规范与主题一致性

## 设计结论

采用 `Workbench 统一化` 方向，并向更硬朗的编辑器工具面板靠拢。

核心原则：

- 信息架构保持不变，主要改视觉系统
- 共享一套 panel primitive，而不是为每个面板单独修样式
- 桌面端优先保证扫描效率与专业感
- 移动端保持同一套语言，只放大热区，不改变语气
- 所有背景、边框、选中、hover、focus 都必须走语义 token

## 统一视觉系统

## 1. 圆角规范

整体使用现有共享 radius token，不新增“文件管理面板专用圆角”。

约束：

- 输入框、列表行、面板内工具按钮使用小圆角
- 面板容器和分组容器使用中等偏小圆角
- 不使用大胶囊、超大卡片圆角、消费型圆按钮语言
- 状态 chip 可继续保留胶囊型 radius，但只用于状态，不扩散到面板主体

具体落点：

- `Explorer / Search / Git` 的输入框、行项、行内按钮统一靠拢到现有 `radius-control-sm / radius-panel / radius-md` 体系
- 移动端 `mobile-files-sheet` 内容面板继续使用共享 radius token，不引入大圆角容器

## 2. 间距与密度

三块面板统一成相同的密度节奏。

桌面端：

- 标题区高度统一到紧凑工具面板密度
- 列表行维持紧凑扫描节奏
- 分组块之间的间距小于普通页面卡片系统

移动端：

- 保持相同视觉节奏，但将行高和点击热区放大到触控可用范围
- 不因触控而放大圆角或加重卡片感

统一结果：

- `header / section / input / row / inline action` 的边距关系一致
- `Search` 不再比 `Explorer` 更像表单
- `Git` 不再比另外两块更像卡片式工具区

## 3. 面板层级

整体层级从 “多层壳卡片” 收敛为 “连续工具面”。

规则：

- 主面板依赖细边框、浅层背景和分隔线建立结构
- 禁止使用厚阴影、强渐变、明显浮起卡片层级
- 同一面板内，内容层级优先于容器层级

这意味着：

- 用户先看到文件、搜索结果、变更列表
- 而不是先看到包住这些内容的“卡片”

## 4. 交互态规范

### Hover

- 使用单层轻背景变化
- 不使用营销式高亮或重阴影

### Focus

- 必须沿用现有 control focus ring token
- 输入框、可点击 row、工具按钮使用同一套 focus 表达

### Selected

这是本轮的明确决策点。

不采用：

- 左侧竖条强调
- 选中时通过额外占位改变内容起始位置

采用：

- 完整块级高亮
- 低饱和选中背景
- 同色系轻边框或非常轻的内高光
- 与 hover、focus 能共存但不互相打架

目标效果：

- 更像编辑器侧栏里的当前项
- 更少后台列表或数据表格感
- `Explorer`、`Search Match`、`Git Change Row` 共用同一类选中语义

## 主题与视觉规范约束

本轮必须遵守现有主题系统，不允许为赶效果直接写死颜色。

### 1. Surface

工作区面板背景必须继续走：

- `--workspace-sidebar-surface`
- `--workspace-activitybar-surface`
- `--workspace-content-surface`
- 已有 `component-mix` surface token

禁止：

- 直接写死浅灰或深灰面板色
- 新增与现有 theme pipeline 脱节的 bespoke surface

### 2. Border / Hover / Selected

边框、hover、选中态都必须继续走现有语义 token 组合。

优先使用：

- `--border-default`
- `--surface-hover`
- `--state-selected-bg`
- `--state-selected-border`
- 已有 `component-mix-status-info-fg-*` 和 `component-mix-surface-*` 体系

允许为本轮补充更准确的语义 token 映射，但不允许绕过 token 直接写死十六进制颜色。

### 3. Radius

必须继续走共享 radius token。

本轮不接受：

- `999px` 扩散到普通 panel control
- `12px / 14px / 16px` 大圆角随意混用
- 桌面与移动端各用一套完全不同的 radius 语言

### 4. Theme-sensitive testing

`components.theme.test.ts` 需要补充或更新断言，保证：

- workspace sidebar surface 仍走语义 surface token
- 桌面端和移动端文件面板仍走共享 radius token
- 选中态不再依赖左侧 border-left 方案
- 搜索输入、文件树行、Git 列表行的视觉约束可以被测试捕获

## 三个面板的具体设计

## Explorer

`Explorer` 需要成为最基础的 panel grammar 来源。

保留：

- `Open Editors`
- `Workspace`
- 新建文件 / 新建文件夹 / 折叠操作
- 文件树已有展开、打开、上下文菜单能力

改动：

- `Open Editors` 行项、文件树行项、行内操作按钮统一到同一套 row/button 体系
- 文件树搜索框若出现在对应模式中，必须与 `Search` 面板输入框同源
- section header、action icon、row active/hover 语义成为另外两块面板的基准

目标：

- Explorer 看起来不是“树控件样式集合”
- 而是整个 sidebar design system 的主参考

## Search

`Search` 保留现有内容搜索能力，但视觉上必须向 `Explorer` 靠拢。

改动重点：

- 搜索输入框改成与 Quick Jump / Explorer 输入同一档工具输入框
- 分组头与 match row 使用与文件树行一致的层级语言
- 文件组、路径、匹配行不再像独立搜索结果卡片
- match 行选中态改成块级高亮，不再出现类似独立列表条目的割裂感

视觉目标：

- 像编辑器内的内容搜索面板
- 不是通用搜索页塞进 sidebar

## Source Control / Git

`Git` 面板的视觉问题最明显，因为它同时包含：

- commit 输入
- 变更列表
- worktree 列表
- 历史列表

本轮要求：

- `commit` 区块的控件语言向工具面板收敛，降低“表单区域”感
- `changes / worktrees / history` 三块与 Explorer section header 同构
- Git 列表行和 Search / Explorer 的 row grammar 统一
- 行内操作按钮、hover、active、selected 一律走同一套轻量表达

特别说明：

- Git 状态色仍保留状态表达职责
- 但状态色不能成为额外的容器装饰系统

## 桌面端设计

桌面端保持当前布局模型：

- 左侧 `Activity Bar`
- 右侧 sidebar content

本轮主要做：

- 统一 `workspace-sidebar-view` 的 header/body grammar
- 统一三块 view 的顶部工具栏高度、标题样式、按钮尺寸
- 统一列表容器、结果容器、commit 区块的工具面语言

桌面端目标关键词：

- dense
- inspectable
- editor-like
- text-first

## 移动端设计

移动端继续保留：

- 顶部三视图切换
- Explorer / Search / Git 的独立内容区

但必须与桌面端共享同一套工具面板语言。

规则：

- 顶部 tab 继续使用扁平切换，不回退到胶囊
- 激活态可用细下划线或细底部强调，但不使用厚块状填充
- 内容区 panel 使用与桌面端一致的 header / input / row grammar
- 仅提升点击热区，不提升装饰性

移动端目标：

- 视觉上仍然像桌面编辑器的移动映射
- 不是另一套消费型移动 UI

## 实现边界

预计主要涉及：

- `packages/web/src/features/workspace/views/shared/explorer-panel.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- `packages/web/src/features/workspace/views/shared/search-panel.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.tsx`
- `packages/web/src/styles/components.css`
- `packages/web/src/styles/components.theme.test.ts`
- 对应结构和交互测试

本轮优先做共享样式层收敛，不建议先分别修三个面板，否则容易再次分叉。

## 实施顺序

1. 在共享 sidebar 样式层抽出统一的 panel primitives
2. 先对齐桌面端 `Explorer / Search / Git` 的 header、input、row、section
3. 再映射到移动端 `mobile-files-sheet` 三视图
4. 最后补充主题约束测试与结构测试

## 测试策略

需要更新或新增的测试重点：

1. 样式约束测试
   - 文件树 row 选中态不再依赖 `border-left`
   - Search match / group row / Git row 的选中态统一到块级高亮表达
   - 搜索输入、Git 输入、Explorer 输入共用紧凑工具输入风格
   - 桌面端和移动端继续使用共享 radius token
2. 结构测试
   - 现有三块面板结构不因视觉收敛而破坏可操作性
   - 移动端 tab 切换、文件打开、Git preview 等行为保持不变
3. 主题验证
   - 浅色、深色、高对比主题下的面板 surface、selected、hover 仍走语义 token

## 验收标准

- Explorer / Search / Git 在桌面端和移动端表现为同一套设计语言
- 普通面板控件全面收敛到小圆角、硬朗、克制的工具面板风格
- 选中态不再使用左侧强调条
- 移动端视觉不再像另一套产品，只是在热区尺寸上适配触控
- 主题切换后不出现脱离 token 的颜色或明暗冲突
- `components.theme.test.ts` 能明确约束上述关键视觉决策

## 已确认设计结论

本设计已通过一次可视化稿确认，当前锁定方向为：

- V2 选中态：去掉左侧强调边，改用整块高亮
- 整体风格：小圆角、硬朗、统一 workbench
- 视觉规范：严格服从现有主题与 token 系统

后续实现如需偏离上述三点，必须重新评审。
