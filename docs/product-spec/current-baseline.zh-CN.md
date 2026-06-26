# Coder Studio 当前代码基线总览

> **文档更新时间：** 2026-06-26  
> **代码基线：** 当前仓库 `packages/web`、`packages/server`、`packages/core`、`packages/providers`  
> **文档目的：** 以当前代码实现为唯一事实来源，重整产品需求描述，纠正旧版 PRD 中与实际实现不一致的页面、路由、入口和功能表述。  
> **重要原则：**
> - 本文只描述当前代码中已经接线、可达、可交互的能力。
> - 历史设计、旧版 README、过期 PRD、未挂载组件不计入“当前功能”。
> - 本文是“现状基线文档”，不是未来路线图。

---

## 1. 文档范围

本文覆盖以下产品面：

- Web 前端桌面壳层与移动壳层
- 工作区、会话、文件、Git、终端、通知、设置、监控、分析、诊断
- 嵌入式 Canvas 页面
- 与前端直接对应的 Server 命令面和 API 面

本文不覆盖：

- 未来规划或未接线入口
- 样式实现细节与 CSS 规范
- Provider 内部执行细节的逐行实现说明

---

## 2. 产品概览

### 2.1 产品定位

Coder Studio 是一个以浏览器为入口的 AI 编码工作台。当前实现把以下能力聚合到同一套工作区模型中：

- 打开并管理多个本地 workspace
- 在同一 workspace 中创建和切换多个 Agent 会话
- 使用文件树、搜索、Git、终端完成开发操作
- 在桌面端和移动端访问同一套工作区数据
- 配置 Provider、终端、外观、快捷键、通知、监控和更新行为

### 2.2 当前核心价值

当前代码体现出的核心价值是：

1. **一次部署，多端继续编码。**
2. **把 AI 会话、文件、Git、终端和诊断能力放进同一个工作流。**
3. **桌面端和移动端都有独立且真实的工作区体验，而不是单纯缩放同一套布局。**

### 2.3 当前端形态

| 端形态 | 入口条件 | 当前骨架 |
| --- | --- | --- |
| Desktop | 视口宽度 `> 899px` | 顶栏 + 左侧活动栏/侧栏 + 主工作区 + 底部终端 + 状态栏 |
| Mobile | 视口宽度 `<= 899px` | 顶栏 + 当前会话主区 + 抽屉/Sheet + 底部状态栏 |

> 说明：当前移动端不是桌面端的压缩版，交互模型不同。

---

## 3. 信息架构与应用生命周期

### 3.1 当前真实路由

| 路由 | 页面/壳层 | 当前状态 |
| --- | --- | --- |
| `/embedded/canvas/:workspaceId` | 独立嵌入 Canvas 页面 | 已接线 |
| `/` | 欢迎页 | 已接线 |
| `/login` | 登录页 | 已接线 |
| `/session-gate` | 激活门禁页 | 已接线 |
| `/workspace` | 主工作区 | 已接线 |
| `/analytics` | 工作分析页 | 已接线 |
| `/monitoring` | 性能监控页 | 已接线 |
| `/diagnostics` | 诊断页 | 已接线 |
| `/more/*` | More 页 / 设置与二级能力入口 | 已接线 |
| `*` | 404 页面 | 已接线 |

**当前没有顶级 `/settings` 路由。**  
设置相关内容实际通过 `/more/settings/*`、`/more/analysis/*`、`/more/about/*` 提供。

### 3.2 壳层选择

- `App` 先处理 `/embedded/canvas/:workspaceId`。
- 其余路径进入桌面或移动壳层：
  - `DesktopShell`
  - `MobileShell`

两套壳层共享：

- 路由体系
- workspace / session / terminal 数据模型
- 通知、连接状态、命令面板等全局能力

### 3.3 启动、认证与激活流程

当前启动流程由 `useBootstrap` 驱动，真实规则如下：

1. 若服务端开启认证且当前未认证：
   - `/login` 之外的页面一律重定向到 `/login`
2. 若已认证，或服务端未开启认证：
   - 停留在 `/login` 会被重定向到 `/`
3. 若激活状态为 `gated`：
   - 重定向到 `/session-gate`
4. workspace 启动引导只在 `/` 和 `/workspace` 发生：
   - 拉取 `workspace.list`
   - 拉取 `workspace.lastViewedTarget.get`
5. 引导完成后按 workspace 数量路由：
   - `/` 且 workspace 数量大于 0 时，重定向到 `/workspace`
   - `/workspace` 且 workspace 数量为 0 时，重定向到 `/`

### 3.4 工作区入口解析状态

`/workspace` 页面在进入真实工作区前，会经过 `WorkspaceRouteGate`：

- workspace 仍在解析中：显示加载壳
- workspace 拉取失败：显示错误空态
- workspace 已就绪：进入桌面或移动工作区视图

### 3.5 连接状态反馈

全局连接状态当前通过横幅和局部指示共同表达：

- `connected`：不显示主横幅
- `reconnecting`：显示正在重连提示
- `disconnected`：显示连接断开提示
- `rejected`：显示“另一个标签页已激活”提示

桌面顶栏和移动顶栏还会展示轻量连接状态指示。

---

## 4. 页面规格

### 4.1 欢迎页 `/`

#### 页面目标

欢迎页只承担“当前没有已进入 workspace 时的首屏入口”职责，不再承担旧版 PRD 中描述的设置入口职责。

#### 当前结构

欢迎页为两步式落地页：

1. 第一步：打开工作区
2. 第二步：开始编码 / 进入会话流

页面包含：

- 产品 kicker
- 标题与描述
- 两步工作流卡片
- 主按钮“打开工作区”
- 支撑性能力说明区

#### 当前功能

- “打开工作区”按钮打开 `WorkspaceLaunchModal`
- 支撑性能力说明当前只有两项：
  - Git tools
  - terminals

#### 明确不应再写入 PRD 的旧描述

- 欢迎页**没有**当前可达的设置按钮
- 欢迎页**不是**“三张功能卡 + 设置次按钮”的旧结构

### 4.2 登录页 `/login`

#### 页面目标

登录页用于处理服务端启用认证的场景。

#### 当前行为

- 页面会主动探测 `/auth/status`
- 若认证未开启：
  - 直接将前端鉴权态设为已通过
- 若已存在有效认证：
  - 直接将前端鉴权态设为已通过
- 若探测失败：
  - 展示状态不可用
- 若需要密码：
  - 保持在当前页等待提交

#### 当前交互

- 输入框类型固定为 `password`
- 提交接口为 `/auth/login`
- 提交中与状态探测中，提交按钮禁用
- 密码错误时直接展示服务端错误
- 若服务端返回封禁截止时间：
  - 页面会按当前语言格式化显示具体时间

#### 当前未提供的流程

- 忘记密码
- 切换账号
- 多账户管理

### 4.3 Session Gate `/session-gate`

#### 页面目标

当应用激活状态为 `gated` 时，当前页面作为阻断页展示。

#### 当前结构与交互

- 复用欢迎页风格外壳
- 展示门禁标题、说明和错误态状态面板
- 主操作为“重新进入”
- 点击后通过 `window.location.replace("/")` 回到首页重新进入流程

### 4.4 工作区页 `/workspace`（桌面）

#### 页面目标

桌面工作区是当前最完整的主工作台。用户可以在同一屏中完成：

- workspace 切换
- Agent 会话创建与继续
- 文件浏览、搜索、编辑和预览
- Git 提交、差异查看、分支切换、worktree 管理
- 终端操作
- Agent 指令、Memory、Skills 管理

#### 当前整体布局

页面结构为：

- 顶栏 `TopBar`
- 左侧活动栏 + 侧边内容区
- 主工作区舞台
- 可展开底部终端面板
- 底部状态栏

在 `focus mode` 或侧栏折叠时，左侧栏会收起。终端面板也可以单独隐藏。

#### 顶栏能力

当前顶栏包含：

- workspace tabs
- 新建/打开 workspace 按钮
- 连接状态指示
- Quick Actions 按钮
- 终端显示/隐藏切换
- 侧栏显示/隐藏切换
- 打开 `/more`
- 全屏切换

> 旧版“顶栏设置按钮跳到 `/settings`”的描述已不成立。  
> 当前入口是 `/more`。

#### 左侧栏：真实视图集合

当前桌面侧栏不再只有 Files / Git 两项，而是 6 个真实视图：

1. `explorer`
2. `search`
3. `source-control`
4. `agent-instructions`
5. `memory`
6. `skills`

##### Explorer

Explorer 当前包含：

- 新建文件
- 新建文件夹
- 全部折叠
- 文件树

文件树当前支持：

- 目录懒加载
- 默认展开常见根目录（如 `app`、`packages`、`src`）
- 桌面拖拽路径
- 重命名、删除、创建等上下文动作
- 双击目录进入、单击选中

##### Search

Search 当前支持：

- 搜索
- 替换
- 大小写匹配
- 整词匹配
- 正则
- include files / exclude files
- ignore / exclude 规则开关
- 单文件替换
- 单匹配替换
- 结果预览与定位

##### Source Control

Git 侧栏当前包含：

- Commit 区
- Worktree 区
- Staged / Changes / Merge Changes 等变更分组
- Git 历史列表
- 历史分页增量加载
- 校验任务提示与重跑 verify
- Diff 预览打开

Worktree 区当前支持：

- 查看工作树列表
- 打开工作树
- 新建工作树
- 删除工作树

##### Agent Instructions

Agent Instructions 视图当前由两部分组成：

- Token trend 区块
- Agent Instructions 区块

当前已接线能力包括：

- 项目级 instructions 状态展示
- 生成 / 重新生成 / 编辑自定义 instructions
- 各 provider 的 system instructions 状态展示
- 对可编辑 system instructions 进行编辑

##### Memory

Memory 面板当前支持：

- 列表查看
- 关键字搜索
- 按 memory type 过滤
- 新建 memory
- 编辑 memory
- 删除 memory
- 对可行动类型维护状态

##### Skills

Skills 面板当前支持：

- 查看 custom / installed / builtin / recommendations
- 安装 skill
- 卸载 skill
- 针对 provider target 挂载 / 卸载
- 创建自定义 skill
- 查看来源、版本、origin、library path 等信息

#### 主工作区舞台

主舞台当前由两套内容叠加组成：

- `AgentPanes`
- `CodeEditorHost`

当前存在两种主模式：

- `agent` 模式：以会话为主
- `editor` 模式：以编辑器为主

编辑器当前支持：

- 固定（pinned）
- 浮动（floating）
- 浮动状态下拖拽移动
- 浮动状态下四角 resize
- 在 agent 模式下通过“恢复编辑器”按钮重新打开

#### 文件打开规则

当前文件打开行为不是单一文本编辑：

- 普通文件：进入编辑器文件 tab
- 预览式打开：可使用 preview tab
- 图片文件：由编辑器宿主进入预览模式
- `.csc` 文件：
  - 若是导航式打开，则默认以 Canvas tab 打开
  - 若带显式定位信息（如行列号）或指定草稿 pane，则按源码文件处理

#### 底部终端面板

当前终端面板：

- 可显示/隐藏
- 可拖动调整高度
- 位于主工作区底部

#### 状态栏

当前状态栏由两部分组成：

- 左侧：Git 状态条
- 右侧：更新轨 `FooterUpdateRail`

Git 状态条当前支持：

- 当前分支展示
- ahead / behind 摘要
- 打开分支快速切换
- 刷新 Git 状态

更新轨当前支持：

- 发现可更新版本
- 准备安装
- 安装中 / 重启中
- 失败 / 需要手动处理
- 成功提示
- 若系统中仍有活动工作，会先弹确认框

#### 桌面快捷键

当前桌面工作区内，至少存在以下已接线快捷键：

- `Ctrl/Cmd + B`：切换侧栏
- `Ctrl/Cmd + 1`：Explorer
- `Ctrl/Cmd + 2`：Search
- `Ctrl/Cmd + 3`：Source Control
- `Ctrl/Cmd + 4`：Agent Instructions
- `Ctrl/Cmd + 5`：Memory
- `Ctrl/Cmd + 6`：Skills

### 4.5 工作区页 `/workspace`（移动）

#### 页面目标

移动端工作区以“当前会话 + 顶部入口 + 全屏 Sheet / 抽屉”为主，不复用桌面端的多栏结构。

#### 当前整体结构

当前移动工作区由以下部分组成：

- 顶栏 `MobileTopBar`
- 当前会话主区
- 底部状态栏
- Agent Sheet
- Files Sheet
- Terminal 全屏 Sheet
- Supervisor Sheet
- Workspace Drawer

#### 顶栏能力

当前移动顶栏包含：

- workspace 抽屉开关
- 当前 workspace 名称
- 文件入口
- 终端入口
- `/more` 入口
- 全屏入口

#### 当前会话主区

若存在会话：

- 主区展示当前激活 `SessionCard`

若不存在会话：

- 展示空态
- 主按钮为“创建会话”

#### Session 恢复规则

移动端当前会根据以下优先级恢复会话：

- `lastViewedTarget`
- workspace UI state 中的 `activeSessionId`
- 最近活跃会话

#### Agent Sheet

Agent Sheet 当前有两种模式：

- `sessions`
- `providers`

当前能力包括：

- 切换当前会话
- 关闭会话
- 创建新会话
- 选择 provider 启动会话
- 当 provider 不可直接启动时，进入 diagnostics 深链

#### Files Sheet

Files Sheet 当前分两层：

- `root`：面板模式
- `detail`：编辑器/预览明细模式

`root` 层当前包含 3 个视图：

- `explorer`
- `search`
- `source-control`

`detail` 层当前由 `CodeEditorHost` 承接，用于：

- 文件编辑
- 文件预览
- Git Diff 详情

#### Terminal Sheet

移动端终端当前以全屏 Sheet 展示：

- 主体为 `TerminalPanel`
- 底部附带工作区状态栏

#### Supervisor Sheet

当当前会话触发 supervisor 相关交互时：

- 自动切换到 `MobileSupervisorSheet`

#### Workspace Drawer

当前 Drawer 支持：

- 浏览所有 workspace
- 展开/折叠单个 workspace
- 查看该 workspace 下的会话列表
- 切换 workspace
- 切换 session
- 在当前 workspace 下新建 session
- 关闭 workspace
- 关闭 session
- 打开 workspace 启动器

#### 当前不应误写的点

- 代码中存在 `MobileDock` 组件和样式资源
- 但当前 `WorkspaceMobileView` **没有挂载该组件**
- 因此“底部 Dock 为当前主入口”**不应写成已上线能力**

### 4.6 More 页 `/more/*`

#### 页面定位

`/more/*` 是当前真实的“设置与二级能力中心”，不是边缘页面。

#### 当前一级分类

当前分类固定为 3 组：

| 分类 | 当前 section |
| --- | --- |
| `settings` | `general`、`providers`、`terminal`、`appearance`、`shortcuts` |
| `analysis` | `analytics`、`monitoring`、`diagnostics` |
| `about` | `product`、`update-status`、`auto-update` |

#### 桌面端表现

桌面端 `MoreFeaturesPage` 当前结构为：

- 页头
- 顶部 category tabs
- 左侧 section 导航
- 右侧内容区

访问规则：

- 会自动规范化到 `/more/<category>/<section>`
- 非法或缺失 section 会回落到该分类默认 section

#### 移动端表现

移动端当前是三层流转：

1. `/more`：分类列表
2. `/more/<category>`：section 列表
3. `/more/<category>/<section>`：具体内容

#### 当前内容映射

- `/more/settings/*`：嵌入 `SettingsPage`
- `/more/analysis/analytics`：嵌入 `WorkAnalyticsSettingsSection`
- `/more/analysis/monitoring`：嵌入监控设置与监控看板
- `/more/analysis/diagnostics`：嵌入 `DiagnosticsPage`
- `/more/about/*`：嵌入 About / Update / Auto Update 视图

### 4.7 工作分析页 `/analytics`

#### 页面定位

`/analytics` 是当前独立的分析页面，不是“设置页下的一个旧子页壳”。

#### 当前能力

- 时间范围选择
- 预设范围切换
- 刷新分析看板
- 扫描状态展示
- provider 数据来源质量摘要
- KPI 网格
- token trend
- agent / model / project 排行
- skill 归因拆分
- 小时热力图
- 刷新失败和警告态反馈

### 4.8 监控页 `/monitoring`

#### 页面定位

`/monitoring` 是当前独立监控页面，也可在 `/more/analysis/monitoring` 中以内嵌形态出现。

#### 当前能力

- 刷新监控快照
- 时间窗口切换：`5m` / `15m` / `30m`
- Host Overview
- Runtime Summary
- Attribution Tree
- Subprocess Drilldown
- Background Runtime
- Entity Detail 面板
- disabled / degraded / waiting / empty 等多类状态

### 4.9 诊断页 `/diagnostics`

#### 页面定位

`/diagnostics` 既是独立页面，也能作为 More 页内嵌内容使用。

#### 当前上下文类型

当前诊断流至少覆盖：

- `manual_check`
- `workspace_open`
- `session_start`
- `mobile_continue`

#### 当前能力

- 拉取诊断报告
- 手动 recheck
- 按上下文继续后续动作
- 复制诊断详情
- 安装系统依赖
- 展示 LSP 服务状态
- 展示 workspace / git / nodejs / provider runtime / server auth / mobile host 等检查项

#### 当前继续动作

- `workspace_open`：通过 `workspace.open` 继续打开工作区
- `session_start`：在通过诊断后创建会话并返回工作区
- `mobile_continue`：在通过诊断后生成并复制手机访问入口

### 4.10 嵌入 Canvas `/embedded/canvas/:workspaceId`

#### 页面定位

该路由是工作区外部的独立 Canvas 渲染页面。

#### 当前参数要求

- 路径参数：`workspaceId`
- 查询参数：`sourcePath`
- 可选查询参数：`refresh`

#### 当前行为

- 通过 `/api/canvas/:workspaceId/data?sourcePath=...` 拉取数据
- 支持 `architecture_canvas` 与 `report_canvas`
- 缺少 `sourcePath`、workspace 不存在、路径越界、画布不存在时会进入错误态

#### 与工作区内 Canvas 的关系

- 工作区内打开 `.csc` 文件时，也可作为 Canvas tab 呈现
- `/embedded/canvas/:workspaceId` 是独立页面形态，不依赖工作区壳层

### 4.11 404 页面 `*`

当前 404 页面展示：

- 标题与说明
- 当前未命中路径
- 返回首页按钮

---

## 5. 跨页面共享系统

### 5.1 Workspace 启动器

当前 workspace 启动器可从以下入口打开：

- 欢迎页主按钮
- 桌面顶栏新增 workspace 按钮
- 命令面板中的“打开工作区”
- 移动端 workspace drawer 底部入口

#### 当前形态

- 桌面：WorkbenchLayer 弹层
- 移动：Sheet

#### 当前能力

- 浏览目录
- 返回上级目录
- 快速回到 Home
- root path 切换
- 新建文件夹
- 选择目录并打开 workspace
- 最近 workspace 列表
- 打开最近 workspace
- 删除单条最近记录
- 清空最近记录

#### 当前约束

它是**应用内目录浏览器**，不是系统原生文件选择器。

### 5.2 命令面板（Quick Actions）

#### 当前入口

- 全局快捷键 `Ctrl/Cmd + K`
- 桌面顶栏 Quick Actions 按钮
- 移动壳层命令面板 Sheet

#### 当前命令集合

当前代码已接线的命令包括：

- 打开 workspace
- 返回首页
- 打开 `/more/settings/general`
- 打开 `/monitoring`
- 打开 Quick Open（桌面且有活动 workspace 时）
- 开关 focus mode（桌面）
- 开关侧栏（桌面）
- 开关终端（桌面）
- 切换到指定 workspace
- 从工作区返回欢迎页

#### 当前更正

- “Settings” 命令当前跳转的是 `/more/settings/general`
- 不是 `/settings`

### 5.3 Quick Open

#### 当前入口

- 仅桌面壳层挂载
- 全局快捷键 `Ctrl/Cmd + P`

#### 当前能力

- 搜索当前 workspace 中文件
- 键盘上下选择
- 回车打开
- 支持鼠标悬停与点击

#### 当前打开规则

- 通过 `file.search` 获取结果
- 常规导航打开文件
- `.csc` 文件在导航式打开时默认进入 Canvas tab

### 5.4 分支快速切换

#### 当前形态

- 桌面：状态栏分支按钮上的 Popover
- 移动：独立移动选择 Sheet

#### 当前能力

- 搜索分支
- 选择分支并切换
- 创建分支
- 标记当前分支
- 标记远程分支
- 标记已被 worktree 占用的分支

### 5.5 通知与 Toast

#### In-app Toast

当前 Toast 系统：

- 最多保留 5 条
- 支持自动消失
- 点击后可跳到对应 workspace / session

#### Session 完成通知

当前通知引擎会在长任务完成时发送提示，真实规则包括：

- 主触发：`running -> idle`
- 回退触发：`running -> ended`
- 过短任务不会提示（当前阈值为 4 秒）
- 页面可见且用户已在同一 workspace / 会话时，会被抑制
- 页面不可见时，优先使用浏览器系统通知
- 声音提示受独立开关控制

### 5.6 连接反馈

当前全局连接反馈由两层组成：

- 页面顶部的连接状态横幅
- 顶栏/移动顶栏中的轻量连接状态点

### 5.7 状态栏与更新轨

当前状态栏提供：

- Git 分支摘要
- Git ahead / behind / refresh
- 分支快速切换入口
- 更新状态轨

更新轨当前覆盖：

- update available
- installing
- restarting
- failed
- manual required
- succeeded

---

## 6. 当前设置架构与配置模型

### 6.1 设置入口架构

当前设置并非独立顶层页面，而是通过 `/more` 组织：

- `/more/settings/*`
- `/more/analysis/*`
- `/more/about/*`

`SettingsPage` 当前可见 section 为：

- `general`
- `providers`
- `terminal`
- `appearance`
- `shortcuts`

`SettingsPage` 当前还支持嵌入式 section：

- `monitoring`
- `analysis`
- `diagnostics`
- `about`

### 6.2 General

当前 General section 已接线项包括：

- 完成通知开关
- 通知声音开关
- 浏览器通知能力状态
- 浏览器通知权限状态
- LSP runtime mode：`auto` / `off`
- supervisor evaluation timeout
- supervisor retry 开关
- supervisor retry 最大次数
- supervisor retry 延迟
- retry on timeout
- retry on evaluator error
- 语言切换：`zh` / `en`

### 6.3 Providers

当前 Providers section 已接线项包括：

- provider 列表
- provider badge / capability / stability 信息
- provider runtime status
- additional args 文本编辑
- 命令预览
- 配置编辑器（当前仅 `claude`、`codex`）
- diagnostics 深链

### 6.4 Terminal

当前 Terminal section 已接线项包括：

- terminal renderer：`standard` / `compatibility`
- copy on select
- 终端 profile 配置
- 默认 terminal profile
- 自定义 terminal profile
- 桌面终端字号
- 移动终端字号

### 6.5 Appearance

当前 Appearance section 已接线项包括：

- 主题选择
- 背景模式：无背景 / 图片背景
- 背景适配方式
- 背景资源上传
- 背景资源删除
- 玻璃与材质参数
- surface opacity / blur 等个性化设置
- 桌面端与移动端覆盖配置

### 6.6 Shortcuts

当前 Shortcuts section 已接线项包括：

- 分类展示：
  - `global`
  - `workspace`
  - `editor`
  - `terminal`
- 编辑快捷键绑定
- 重置快捷键

### 6.7 Monitoring（嵌入设置）

当前嵌入监控设置页已接线项包括：

- 启用/禁用 monitoring
- 预设模式：`light` / `standard` / `deep` / `custom`
- 采样间隔
- 时间窗口预览
- 高级能力开关：
  - host metrics
  - runtime summary
  - workspace attribution
  - subprocess drilldown
- 内嵌监控看板

### 6.8 About / Update / Auto Update

当前 About 相关 section 已接线项包括：

- 产品信息
- 当前版本
- server instance id
- 当前安装支持情况
- 最新版本
- 上次检查时间
- 更新可用性
- 更新状态
- 立即检查更新
- 准备安装更新
- 自动检查开关
- 自动检查间隔
- 需要手动处理时的提示与命令展示

---

## 7. 后端能力附录（当前命令面）

当前 Server 已注册的命令家族包括：

- `workspace`
- `workspace-activity`
- `automation`
- `ui-actions`
- `canvas`
- `activation`
- `connection`
- `recovery`
- `session`
- `session-metadata`
- `session-review`
- `terminal`
- `task`
- `file`
- `git`
- `agent-instructions`
- `skills`
- `agent-context`
- `settings`
- `diagnostics`
- `provider`
- `custom-provider`
- `system-deps`
- `supervisor`
- `worktree`
- `fencing`
- `lsp`
- `updates`
- `monitoring`
- `work-analysis`
- `memory`

这些命令家族说明当前产品面已经不仅限于早期版本中的文件、Git 和会话基础能力。

### 7.1 Canvas API

当前独立 Canvas 页面依赖的服务端 API 为：

- `GET /api/canvas/:workspaceId/data?sourcePath=...`

当前约束：

- workspace 不存在返回 `404`
- 缺少 `sourcePath` 返回 `400`
- 路径逃逸会被拒绝
- 找不到 canvas 返回 `404`

---

## 8. 实现边界与禁止误写项

以下内容在今后维护 PRD 时，**不要再写成当前已上线能力**：

### 8.1 顶级 `/settings`

- 当前产品路由中没有顶级 `/settings`
- 设置中心的真实入口是 `/more/*`

### 8.2 欢迎页设置按钮

- 当前欢迎页没有设置次按钮
- 欢迎页的主动作只有“打开工作区”

### 8.3 桌面侧栏只有 Files / Git

- 当前桌面侧栏真实视图是 6 项
- Files / Git 只是其中两项视图能力的一部分

### 8.4 移动端底部 Dock 为当前主入口

- 当前代码里虽然有 `MobileDock` 组件
- 但主工作区视图没有挂载该组件
- 因此不应把“底部 Dock 导航”写成当前产品入口

### 8.5 分析/监控/诊断只是设置子面板

- `/analytics`
- `/monitoring`
- `/diagnostics`

以上 3 个当前都是真实独立页面，同时也可以在 `/more` 中以内嵌内容出现。

### 8.6 Embedded Canvas 是工作区内私有能力

- `.csc` 文件可在工作区内作为 Canvas tab 打开
- 但当前还存在独立路由 `/embedded/canvas/:workspaceId`
- 不能只按“工作区内部预览”描述

---

## 9. 维护原则

后续维护本文时，应遵守以下规则：

1. 路由图以 `App` 与 Shell 注册结果为准。
2. 页面能力以当前真实挂载组件为准，不以“存在组件文件”作为已上线依据。
3. 设置项以 `/more` 下的真实 section 和 `SettingsPage` 可见/嵌入 section 为准。
4. 工作区能力以桌面与移动两套视图分别核对，不做互相投射。
5. 若独立页面和内嵌页面同时存在，应在 PRD 中明确写出“双入口”。
