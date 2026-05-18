# 移动端文件页内容区扁平化并对齐 PC 样式 · 设计文档

> **版本：** 1.0
> **日期：** 2026-05-18
> **状态：** Draft（待评审）
> **作者：** Codex

---

## 0. 文档说明

### 0.1 目标

重做移动端 workspace 中“文件”页的内容区样式，把当前偏重的胶囊、渐变、浮起卡片语言收敛成与 PC 文件侧栏一致的扁平化工具面板风格。

本轮重点不是改功能，而是修正视觉归类，让移动端文件区回到与 PC 文件树 / Git 侧栏同一套产品语气。

### 0.2 本轮范围

本轮只覆盖移动端“文件”页的内容区。

包含：

- `Files / Git` tab 区域的视觉重做
- tab 右侧文件操作按钮区域的视觉重做
- 文件搜索框、文件树列表、Git 列表容器样式重做
- 移动端文件区与 PC 侧栏样式对齐所需的测试更新

不包含：

- 顶部返回栏和页面标题区域
- 底部状态栏
- Monaco 编辑器、图片预览、diff 查看器、终端等代码型界面
- 文件树 / Git 业务逻辑变更
- 主题 token 体系重构

### 0.3 相关实现入口

当前实现主要分布在以下位置：

- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
  - 负责移动端文件页内容区结构
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
  - 负责文件搜索、树节点、行内动作
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
  - 负责 Git 视图内容
- `packages/web/src/styles/components.css`
  - 当前移动端文件页与 PC 文件侧栏样式的主要定义位置
- `packages/web/src/styles/components.theme.test.ts`
  - 样式约束测试
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`
  - 结构级行为测试

本轮重点 class：

- `.mobile-files-sheet--root`
- `.mobile-files-sheet__segmented`
- `.mobile-files-sheet__segment`
- `.mobile-files-sheet__tab-actions`
- `.mobile-files-sheet__tab-action`
- `.mobile-files-sheet__content`
- `.mobile-sheet--files .file-tree-shell--mobile`
- `.file-tree-shell--mobile .file-tree-search`
- `.file-tree-shell--mobile .tree-item`
- `.mobile-sheet--files .git-panel--mobile`

### 0.4 现状与问题

当前移动端文件页内容区存在以下特征：

- tab 区是带渐变和阴影的胶囊容器
- 工具按钮使用独立圆形按钮语言
- 搜索框是脱离内容面的“大输入卡片”
- 文件树 / Git 容器使用明显浮起的大圆角卡片
- 内容区整体与 PC 侧栏使用了两套不同的视觉系统

这带来四个问题：

1. 同一产品内，PC 文件侧栏与移动端文件页语气割裂
2. 内容区层级过多，用户先看到壳层，再看到真正的文件内容
3. 文件 / Git 是工具面板，却被渲染成偏消费型的移动端卡片
4. 当前移动端内容区在扁平化字体规范下依然显得过于厚重

---

## 1. 设计目标与非目标

### 1.1 设计目标

- 让移动端文件页内容区与 PC 文件侧栏共享同一套扁平化视觉语言
- 保留移动端触控尺寸，但去掉渐变、浮起阴影和厚重胶囊感
- 让 tab、toolbar、search、tree list、Git list 的层级关系更接近 PC
- 降低容器存在感，让文件内容本身成为视觉主角
- 在浅色 / 深色主题下继续依赖现有 token 正常工作

### 1.2 非目标

- 不把移动端文件页改造成完全复制 PC 的窄侧栏布局
- 不为“完全一致”牺牲移动端点击热区
- 不改文件树节点展开、搜索、创建、删除等交互语义
- 不处理内容区外的导航栏、状态栏或工作区其他页面

---

## 2. 方案选择

### 2.1 方案 A：仅视觉降噪

只去掉渐变、阴影和圆按钮，尽量保留现有移动端内容区结构和分组形态。

优点：

- 改动最小
- 风险最低

缺点：

- 只能做到“更轻”，做不到“和 PC 是一套语言”
- tab、toolbar、search、tree 的层级关系依旧偏移动端自成体系

### 2.2 方案 B：组件级对齐 PC

对齐 PC 文件侧栏的组件语言，把 tab、toolbar、search、tree list、Git list 全部向 PC 靠拢，同时仅保留移动端必需的尺寸和触控适配。

优点：

- 与用户要求最一致
- 能从根上解决视觉体系不一致的问题
- DOM 改动可控，主要是样式和少量结构收敛

缺点：

- 需要同步更新样式测试
- 需要仔细处理移动端与 PC 的尺寸差异

### 2.3 方案 C：最大化复用 PC 侧栏结构

尽量把移动端内容区直接映射成 PC 侧栏的移动版，追求最大一致性。

优点：

- 视觉一致性最高

缺点：

- 改动面更大
- 容易把 PC 的密度和行为假设直接带进移动端

### 2.4 结论

本轮采用 **方案 B：组件级对齐 PC**。

原因：

- 用户已明确选择 `2`
- 当前问题不只是“视觉太重”，而是“视觉系统不一致”
- 方案 B 可以在不碰外层导航的前提下，把内容区完整拉回 PC 工具面板语言

---

## 3. 信息结构与布局

### 3.1 内容区框架

移动端文件页内容区保持两层结构：

1. 顶部工具带
2. 内容面板

其中顶部工具带内同时承载：

- `Files / Git` tab
- 右侧文件动作按钮

不再把顶部区域渲染成独立浮起胶囊块。

### 3.2 内容面板分工

`Files` tab 下：

- 搜索框置于内容面板顶部
- 文件树列表紧跟其后
- 搜索框与列表属于同一个连续 panel

`Git` tab 下：

- Git 视图容器沿用相同 panel 语言
- 视觉上与文件树面板保持同层级，而不是另一张更重的卡片

### 3.3 保持不变的结构约束

- 文件树右侧行内动作在移动端继续常显
- 搜索框仍位于文件树之上
- tab 切换、创建文件、创建文件夹、折叠全部功能保持原状
- `editor / diff` route 继续走现有结构，但不纳入本轮视觉重做

---

## 4. 视觉设计

### 4.1 整体视觉归类

本页内容区从：

- `mobile / sheet / pill / floating-card`

调整为：

- `workspace / sidebar-tooling / flat-panel`

这意味着本轮主要是 token 映射和容器语义的修正，不新增页面私有主题。

### 4.2 Tab 区

Tab 区向 PC 侧栏 header 对齐：

- 去掉渐变背景
- 去掉明显阴影
- 去掉大胶囊圆角轮廓
- 改为轻量 panel header 或直接内容区顶部的一层工具带
- 激活态使用 PC 同语言的细下划线，而不是厚重圆角块

Tab 文本层级：

- 使用 `label` 级别字号
- 默认常规字重
- 激活态靠颜色和下划线强调，不靠更重字重堆出层级

### 4.3 右侧工具按钮

右侧文件操作按钮向 PC `panel-toolbar-btn` 语言靠拢：

- 从独立圆形 icon button 改成更扁平的方圆角 icon action
- 背景默认透明
- hover / pressed 只出现轻量 `bg-hover`
- 边框默认不作为主要视觉元素

保留的移动端差异：

- 触控尺寸维持 `32px - 36px`
- 按钮间距略大于 PC，避免误触

### 4.4 文件 / Git 主容器

文件树和 Git 容器统一改成平面 panel：

- 去掉渐变面
- 去掉浮起阴影
- 圆角从 `xl` 收敛到 `md` 级别，或在需要时直接取消顶部大圆角
- 通过 `1px border + 背景层次 + 分隔线` 建立结构

视觉结果应更接近 PC 侧栏：

- 是一个连续的工作面
- 不是一张抬起来的卡片

### 4.5 搜索框

搜索框对齐 PC 文件树搜索框：

- 使用同类边框和背景语义
- 减少脱离内容面的“独立卡片感”
- 保留触控可用的高度
- 字号和内边距与 PC 接近，但允许略高的竖向尺寸

### 4.6 文件树列表

文件树列表的目标是“PC 侧栏的移动版”：

- 行容器保持连续列表感
- 保留移动端约 `40px` 行高
- 行项不再依赖大圆角和额外背景块塑形
- hover / active / selected 状态沿用 PC 的轻背景和左侧强调线语义
- 选中态继续允许略高于 PC 的可见度，但不能回到厚重高亮块

### 4.7 Git 列表

Git 视图在 `mobile` variant 下需要与文件树处于同一视觉系统：

- 使用同级 panel surface
- 标题、列表、操作区层次向 PC Git 侧栏看齐
- 不额外叠加与文件树不同的壳层语言

---

## 5. 响应式与可用性约束

### 5.1 保留的移动端适配

- 触控按钮尺寸不降低到 PC 级别
- 文件树行高维持移动端易点选标准
- 内容区滚动方式与安全区处理保持现有行为
- 行内操作在移动端继续可见，不依赖 hover

### 5.2 可访问性要求

- tab、按钮、搜索框、树节点的 focus-visible 语义保持有效
- 颜色变化必须继续依赖现有主题 token，不引入弱对比硬编码
- 选中态不能只靠颜色差异表达，继续保留结构性提示，如左侧 accent bar

---

## 6. 实现设计

### 6.1 DOM 结构

优先保留 `mobile-files-sheet.tsx` 现有结构：

- `mobile-files-sheet--root`
- `mobile-files-sheet__segmented`
- `mobile-files-sheet__tabs`
- `mobile-files-sheet__tab-actions`
- `mobile-files-sheet__content`

原则上不新增与视觉无关的包装层。

允许的轻量结构调整：

- 如果需要为 tab 与 actions 做更精确对齐，可在现有 header 内新增一层轻量布局 wrapper
- 不引入新的分区、说明文案或空态模块

### 6.2 样式修改重点

主要修改位置：

- `packages/web/src/styles/components.css`

重点重写区域：

- `.mobile-files-sheet--root`
- `.mobile-files-sheet__segmented`
- `.mobile-files-sheet__segment`
- `.mobile-files-sheet__segment.active::after`
- `.mobile-files-sheet__tab-actions`
- `.mobile-files-sheet__tab-action`
- `.mobile-sheet--files .file-tree-shell--mobile`
- `.file-tree-shell--mobile .file-tree-search`
- `.file-tree-shell--mobile .tree-item`
- `.file-tree-shell--mobile .tree-item.selected`
- `.mobile-sheet--files .git-panel--mobile`

修改原则：

- 优先复用 PC 侧栏已验证的 token 映射与状态语义
- 不为移动端文件页新增孤立的专用颜色体系
- 只有尺寸和间距因触控而偏离 PC

### 6.3 测试与约束同步

需要更新的测试至少包括：

- `packages/web/src/styles/components.theme.test.ts`
  - 更新移动端文件页内容区样式断言
  - 明确不再允许渐变 / 投影 / 浮起卡片语言残留
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`
  - 若 DOM 结构轻微调整，同步修正结构断言

如有必要，可补充新的样式断言，明确：

- tab 区使用 PC 同语言的细下划线激活态
- tab action 使用扁平 icon action，而非圆形浮起按钮
- 文件树移动端 variant 不再渲染厚重卡片壳层

---

## 7. 验证方案

实现完成后至少验证以下内容：

1. `Files / Git` tab 切换正常
2. 新建文件 / 新建文件夹 / 折叠全部按钮功能不回归
3. 搜索框输入、搜索结果、空结果、加载态正常
4. 文件树展开、选中、删除等常见操作不回归
5. Git 面板在移动端保持可读且与文件树样式同系统
6. 浅色 / 深色主题下没有出现硬编码颜色破坏
7. 编辑器、diff、终端等排除范围未被意外重写

建议执行的最小验证集：

- 移动端文件页结构测试
- 样式主题测试
- 必要时补一轮移动端 workspace 手动预览

---

## 8. 风险与边界

### 8.1 主要风险

- `mobile` variant 与 `desktop` variant 的样式共用选择器较多，容易误伤 PC 文件侧栏
- Git 视图内部若含有自身容器语言，可能出现“外层扁平、内层仍厚重”的不一致
- 样式扁平化后，如果边界和分隔线处理不足，内容区可能显得过空

### 8.2 风险控制

- 所有移动端改动优先挂在 `.mobile-sheet--files` 或 `file-tree-shell--mobile` 作用域下
- 样式测试同时覆盖 PC 和 mobile 关键块，防止串改
- 视觉强调优先通过层级、边框、选中态解决，不回退到阴影和大圆角

---

## 9. 最终结论

本轮将把移动端文件页内容区从“独立浮起卡片组”改成“PC 文件侧栏的移动版”。

核心原则只有两条：

1. 视觉语言向 PC 对齐
2. 交互尺寸保留移动端可用性

这样可以在不改业务逻辑、不动外层导航的前提下，先把最明显的视觉割裂修正掉，并为后续移动端 workspace 其他内容区统一风格提供基线。
