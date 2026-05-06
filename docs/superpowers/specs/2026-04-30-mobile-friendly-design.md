# 移动端全量适配 · 设计文档

> **版本：** 1.0
> **日期：** 2026-04-30
> **状态：** Draft（等待评审）
> **作者：** 技术共同设计 — Spencer + Claude

---

## 0. 文档说明

### 0.1 目的

把当前桌面优先的多面板 IDE，扩展为同时支持手机 / 平板 / 桌面的全量适配产品。改造目标包含：

- 触摸交互友好（44px 触摸目标、移动手势、消除滚动冲突）
- 单焦点导航模型（手机 / 小平板上 agent 是主角，工具是配角）
- 全功能可达（不裁剪 PC 端任何功能，仅做布局 / 容器形态适配）
- 桌面体验零回归

### 0.2 背景

当前 `packages/web` 是纯桌面布局：`body { overflow: hidden }` + `#root: 100vw/100vh`，CSS 中几乎没有 `@media` 媒体查询，所有面板（agent panes / code editor / terminal / files+git / supervisor）默认横向并排。在 < 900px 视口下：

- 多面板挤压到不可用，需要不停拖 splitter
- 按钮 / icon / tab 触摸目标多在 16-32px，远低于 iOS HIG / Material 标准
- Hover-only 操作（命令面板、agent toolbar、文件树 hover actions）触摸场景无替代入口
- 嵌套滚动容器（terminal / editor / chat）手指滑动时不可预期
- 缺少移动原生交互（侧滑切 workspace、长按菜单、sheet 等）

### 0.3 设计目标

- 在 `< 900px` 视口（含 `pointer: coarse`）走专属移动 shell，桌面 shell 不动
- 手机 / 小平板单焦点模型：当前 workspace 的 agent 对话作为主屏，其他能力通过 dock + sheet 按需访问
- 复用全部现有 feature 组件（agent-panes / code-editor / terminal-panel / supervisor / settings / command-palette），只改 chrome 与容器
- 触摸 token 化：通过 CSS 变量 + 媒体查询统一升级触摸目标尺寸，组件 JSX 几乎不动
- 6 期可独立合并的实施分期，每期桌面 e2e 必须不挂

### 0.4 非目标

明确**不**在本设计范围内：

- 重写 Monaco / xterm 或自研移动编辑器
- Tailwind / 设计系统大迁移
- 给桌面 shell 加新功能（只允许 token 替换式重构）
- PWA / 离线支持 / 安装到主屏（独立项目）
- 原生 app 壳（Capacitor / RN）（独立项目）
- 移动端的"再设计创新"（如焦点模式新形态、命令面板新交互）——直接复用或删除
- 下拉刷新 / 加载历史等高级移动交互（v2 再说）

---

## 1. 关键设计决策

| # | 决策 | 取舍理由 |
|---|---|---|
| D1 | **导航模型 = Agent-First 单栈 + Sheet** | 产品本质是 "AI agent 帮你写代码"，手机上 90% 的真实诉求是看 agent 进度 / 发指令 / 审 diff，不是写代码 |
| D2 | **Editor / Terminal 原样复用，不做触摸优化** | 系统软键盘能输入即可。复用 PC 组件，开发成本最低 |
| D3 | **断点：`max-width: 899px` OR `pointer: coarse`** | 双条件覆盖外接键鼠 iPad、带触屏小笔记本两种边角 |
| D4 | **桌面 split 状态在移动端只读，不回写** | 移动端只是不同的"取景器"，不污染桌面布局 |
| D5 | **Files / Git 同 sheet 复用桌面 panel-tabs 结构** | 镜像桌面信息架构，零改动复用 |
| D6 | **Dock = Files + Terminal 二项极简** | Editor 是 file 的 consequence、Git 合并进 Files、Supervisor 走 chat 顶徽章、Settings/CP 进 topbar `⋯` |
| D7 | **Supervisor 改为 chat 上方的状态徽章** | Supervisor 是 agent 执行 objective 的伴生概念，与 chat 强相关，不必占 dock 槽位 |
| D8 | **Settings 走整屏路由 + nav stack；其他二级走 sheet** | Settings 有真实层级 + URL 语义，路由优于 sheet；其他无层级用 sheet 一致 |
| D9 | **同时只有一个 sheet 存在** | 切换 dock item 时新 sheet 替换旧 sheet，避免多层嵌套引发"我在哪一层"焦虑 |
| D10 | **Toast 顶部居中**（与桌面右下角不同） | 移动端右下角被输入区与 dock 占据；顶部下推 topbar 是移动惯例 |
| D11 | **Terminal 不自动启动**（中央"启动终端"按钮） | 移动 PTY 资源敏感；建议桌面也同步该改进 |

---

## 2. 整体架构

### 2.1 Shell 切换

```
packages/web/src/
├── app.tsx                          # 入口：根据 viewport 选 shell
├── shells/
│   ├── desktop-shell.tsx            # 现有桌面布局（移过来，逻辑不动）
│   └── mobile-shell/                # 新增
│       ├── mobile-shell.tsx         # 移动端根布局
│       ├── mobile-topbar.tsx
│       ├── mobile-dock.tsx
│       ├── mobile-sheet.tsx         # 通用 bottom sheet 容器（手势 + 动画）
│       ├── mobile-workspace-drawer.tsx
│       └── hooks/
│           ├── use-viewport.ts      # 'mobile' | 'desktop'
│           └── use-sheet-stack.ts
└── features/                         # 所有现有 feature 不动，作为内容塞进 shell
```

`app.tsx` 顶层用 `useViewport()` 判断：

```tsx
const viewport = useViewport(); // matchMedia 监听
return viewport === 'mobile' ? <MobileShell /> : <DesktopShell />;
```

`useViewport` 用 `(max-width: 899px) or (pointer: coarse)` 的 `matchMedia` 监听变化，旋转屏幕 / 桌面缩窗口都自动切换。

### 2.2 共享 / 不共享边界

| 层 | 桌面 / 移动 |
|---|---|
| jotai atoms | 共享 |
| WS 连接 / dispatch | 共享 |
| feature 组件（agent-panes / code-editor / terminal-panel / supervisor / settings / command-palette / git-panel / file-tree / git-diff-viewer） | 共享 |
| 路由配置 | 共享（路由映射相同，shell 决定渲染容器） |
| chrome（topbar / dock / sheet / drawer） | 各自独立 |
| 全局手势监听 | 仅 mobile |
| 触摸 token | 通过媒体查询自动切换 |

---

## 3. 移动端 Home 屏

### 3.1 整体布局（< 900px）

```
┌──────────────────────────────────────────┐
│ ☰  my-app ▾           ● 已连接    ⋯      │  topbar           44px
├──────────────────────────────────────────┤
│ [● Claude] [⏳ Codex²] [✓ Gemini]   +    │  agent chips      44px
│                                  📍 3/8  │  supervisor 徽章（条件显示）
├──────────────────────────────────────────┤
│                                          │
│   <agent chat - 复用桌面同款组件>         │  flex: 1
│                                          │
├──────────────────────────────────────────┤
│ [ 输入框 / 附件 ]               ➤        │  composer        56px+
├──────────────────────────────────────────┤
│       📂                  💻             │  dock            60px
│      Files              Terminal         │  + safe-area
└──────────────────────────────────────────┘
```

### 3.2 Topbar

| 区域 | 内容 |
|---|---|
| 左 | `☰` + 当前 workspace 名 + `▾`（pill，整体可点 ≥ 44×44px） |
| 中 | 连接状态点 + 文字（已连接 / 重连中 / 离线） |
| 右 | `⋯` 溢出菜单：Settings / 主题 / 命令面板 / 帮助 / 登出 |

### 3.3 Workspace 抽屉（点 pill 触发）

- 全屏左抽屉，从左边缘 80% 宽度滑入
- 顶部搜索框（输入即过滤）
- 列表项 ≥ 56px：workspace 名 + 路径 + 状态点 + agent 数量徽标
- 长按列表项 → 操作菜单（重命名 / 关闭 / 删除）
- 底部固定：`+ 新建` / `导入` / `设置`
- 关闭：右滑 / 点遮罩 / Android 返回键
- 触发手势：tap pill **或** 屏幕左边缘右滑

### 3.4 Agent chip 条

- 横向滚动，永远定位当前高亮 chip 在视口
- chip 高 32px，hit area 扩到 44px（hit-slop）
- 圆点 = 状态（running / idle / error）；角标数字 = 未读消息数
- 长按 chip → agent 操作菜单（关闭 / 重启 / pin）
- chat 区域水平 swipe → 同步切换 chip
- 溢出：横滚 + scroll-snap，每次对齐一个 chip

### 3.5 Composer

- 单行起，自动撑高至 4 行后内滚
- 左侧附件按钮（图片 / 文件，复用桌面 attachment 流）
- 右侧发送按钮，loading 态变停止键
- 软键盘弹出时用 `visualViewport` 把 composer 上推

### 3.6 Dock

| 图标 | 标签 | 行为 |
|---|---|---|
| 📂 | Files | 打开 Files sheet（含 Files/Git tab + nav stack 进入 editor / diff viewer） |
| 💻 | Terminal | 打开 Terminal sheet |

- dock item 触摸区 ≥ 64×64px（2 项布局间距宽松）
- 当前激活 sheet 对应的 dock item 高亮显示

### 3.7 Supervisor 徽章

- 当前 agent 有 supervisor 状态时：agent chip 条右侧显示 `📍 cycle 3/8` 徽章
- tap 徽章 → 拉起 Supervisor sheet
- 无 supervisor 状态时整个徽章不显示

---

## 4. Workspace + Agent 切换

### 4.1 桌面 split 在移动端的扁平化

桌面"split"本质是布局状态（哪些 agent 是"打开的" + 怎么排列），与 agent 进程状态解耦。

**移动端规则**：

1. **保留"打开的 agent 集合"** — 桌面打开多少个，移动端就有多少 chip
2. **二维布局压成一维链** — 按"从左到右、从上到下"阅读顺序拍平
3. **不写回桌面 split 状态** — 移动端是只读 viewer

### 4.2 默认选中 agent（按优先级）

1. 当前会话里最后交互过的 agent
2. 桌面 split 的"最左 / 最上"那个
3. 都没有 → 空状态 + "添加 agent" CTA

### 4.3 跨设备同步边界

- **桌面新开 agent，移动端正在看**：chip 条 push 新 chip，不抢焦点；右上角徽标提示
- **桌面关掉 agent，移动端正显示它**：自动 fallback 到"最近交互的另一个"，toast 提示 "{agent} 已在其他设备关闭"
- **移动端关 agent**：影响数据层 agent 集合（双端同步），桌面 split 槽位记忆保留，重新打开同名 agent 自动回到原位

---

## 5. Sheet 系统

### 5.1 形态

- 默认**全屏 sheet**（顶部留 12px 状态条 + grab handle）
- 轻量场景用**半屏 sheet**（确认弹窗、quick action）
- **同时只有一个 sheet 存在**

### 5.2 生命周期

- 打开：底部弹出 240ms cubic-bezier(0.32, 0.72, 0, 1)（iOS 标准曲线）
- 关闭手势：下滑 grab handle 超过 30% 高 / velocity 阈值 / Android 返回键 / iOS 边缘左滑
- 切换 dock item：旧 sheet 直接被新 sheet 替换（不是先关再开），动画用 cross-fade

### 5.3 状态保留

- sheet 关闭后保留状态 5 分钟（terminal 不断、editor 不丢编辑、files 树展开态保留）
- 通过 jotai 把 sheet 内部状态提到 atom 层，让 sheet 卸载时数据还在
- 超时或 workspace 切换则清

### 5.4 Z 轴

```
[ workspace drawer (z=40) ]
[ sheet (z=30) ]
[ composer + dock (z=20) ]
[ topbar + agent chips (z=10) ]
[ chat (z=0) ]
```

drawer 永远盖过 sheet，sheet 永远盖过 chat。

### 5.5 Files sheet 结构

```
┌──────────────────────────────────────────┐
│ ←       Files | Git              ⋯       │  sheet 顶 + tab
├──────────────────────────────────────────┤
│  [Files tab 内容] 或 [Git tab 内容]       │
│                                          │
│  - Files tab: 文件树 + 搜索               │
│    └─ tap 文件 → push 到 Monaco 全屏       │
│                                          │
│  - Git tab: 状态 / diff / branch / commit │
│    └─ tap diff → push 到 diff viewer       │
└──────────────────────────────────────────┘
```

- 顶部 tab 复用桌面 `panel-tabs` 组件
- nav stack 嵌在 sheet 内（`Files列表 → 文件编辑` / `Git状态 → diff详情`）
- 顶部左侧返回箭头：在 nav 内部时回上层、在 root 时关闭 sheet

---

## 6. 手势语言

### 6.1 全局手势表

| 区域 | 手势 | 行为 |
|---|---|---|
| chat | 左右滑 | 切换上一个 / 下一个 agent |
| chat | 长按消息 | 操作菜单（复制 / 引用 / 重发 / 删除） |
| sheet grab handle | 下滑 | 关闭 sheet（>30% 高或 velocity 触发） |
| sheet 内 nav | 边缘左滑 | 返回上一层（nav stack pop） |
| dock item | tap | 打开 / 替换 sheet |
| 屏幕左边缘 | 右滑 | 唤起 workspace 抽屉 |
| 屏幕右边缘 | 左滑 | 关闭当前 sheet |
| topbar workspace pill | tap | 等同左边缘右滑 |
| agent chip | tap / 长按 | tap 切换 / 长按弹操作菜单 |

### 6.2 冲突规避

- iOS Safari 顶部下滑 = 关 tab：chat 顶部不做下拉手势（v1 不要"下拉刷新历史"）
- xterm 自己有 touch 事件：sheet grab handle 24px 高度专用，不传给内容
- Monaco 处理触摸选择 / 光标：sheet 关闭仅从 grab handle 触发，不能从 editor 区域

---

## 7. 触摸 Token + Design System

### 7.1 新增 token（`tokens.css`）

```css
:root {
  --touch-target-min: 32px;
  --touch-target-comfortable: 40px;
  --touch-target-large: 44px;
  --touch-spacing-min: 8px;
  --touch-hit-slop: 0px;
}

@media (max-width: 899px), (pointer: coarse) {
  :root {
    --touch-target-min: 44px;
    --touch-target-comfortable: 48px;
    --touch-target-large: 56px;
    --touch-spacing-min: 12px;
    --touch-hit-slop: 8px;
  }
}
```

### 7.2 现有组件改造（仅 token 替换）

| 组件 | 改造 |
|---|---|
| `.btn` | 用 `--touch-target-min` |
| icon button | 用 `--touch-target-comfortable` + `hit-slop` 隐形扩区 |
| topbar tabs | 移动端 44px |
| 列表项 | 移动端 56px |
| modal close 按钮 | 移动端 44px |
| splitter / resize handle | 移动端**直接隐藏**（移动 shell 不允许 resize） |
| dropdown 选项 | 移动端 44px |

### 7.3 滚动冲突修复

1. **chat 是唯一长滚动容器** — topbar / agent chips / composer / dock 全部 `overflow: hidden`，chat 用 `overflow-y: auto; overscroll-behavior: contain`
2. **sheet 打开时锁定底层 chat** — `document.body.style.overflow = 'hidden'`
3. **sheet 内 nav stack 仅当前可见层有 overflow**
4. **xterm / Monaco 用 `touch-action: pan-x pan-y`** — 让原生滚动不被吞掉
5. **agent chip 条用 `scroll-snap-type: x mandatory`**

### 7.4 安全区 / 软键盘 / 视口

- 用 `env(safe-area-inset-*)` 处理刘海 / Home indicator
- 软键盘用 `visualViewport` API 监听，把 composer 上推到键盘上方
- 横屏 dock 自动收成 48px
- 用 `100dvh` + `visualViewport` 双保险解决 iOS Safari 100vh 跳动
- composer 用 `position: sticky` + `bottom: env(keyboard-inset-height)` 兜底

---

## 8. 二级页面

### 8.1 形态映射

| 页面 | 桌面形态 | 移动形态 | 改动量 |
|---|---|---|---|
| Auth / Login | 居中 modal | **整屏路由**，卡片 100% 宽 + 上下 padding | 仅 CSS |
| Welcome | 主区居中 | **整屏路由**，按钮纵向 stack、字号放大 | 仅 CSS |
| Settings | 居中 modal + 左右栏分类 | **整屏路由 + nav stack**：分类 → 详情，返回箭头回列表 | 加一层 nav stack 包装 |
| Command Palette | 浮层 modal | **整屏 sheet**，topbar `⋯` 触发 | sheet 容器 + 触摸优化 |
| Branch quick pick | 浮层 | 半屏 sheet（在 Git sheet 内 push） | sheet 容器 |
| Workspace launch modal | 居中 modal | **整屏 sheet**（多步表单） | sheet 容器 |
| Worktree modal | 居中 modal | 同上 | sheet 容器 |
| Objective dialog | 居中 modal | 半屏 sheet | sheet 容器 |
| Toast notifications | 右下角堆叠 | **顶部居中**，多条折叠成 "+N" 徽章 | 改 toast 容器位置 |
| Config drift banner | topbar 下整宽横条 | 同位置，padding 调整、按钮变小图标 | 仅 CSS |

### 8.2 设计原则

- **桌面 modal → 移动 sheet**：所有居中浮层在移动端统一变 sheet 形态
- **多级配置 → nav stack**：树状信息架构拍平成"列表 → 详情"
- **modal 宽度限制全部解除**：`max-width: 520px` 等在移动端覆盖为 `100vw`

---

## 9. 边界场景

### 9.1 连接状态

| 状态 | UI |
|---|---|
| 连接中 | topbar 状态条转圈 + 文字；不阻塞 |
| 重连中 | 同上 + 红色 |
| 离线 | 全宽顶部红条 "离线，操作将在重连后同步"；composer 仍可输入但发送禁用 |
| 长时间断开（>30s） | 弹半屏 sheet 提示 + 重试按钮 |

### 9.2 空状态

| 场景 | UI |
|---|---|
| 无 workspace | 直接渲染 Welcome 整屏路由 |
| 有 workspace 无 agent | chat 区居中插画 + "添加 agent" 按钮 |
| Files sheet 文件树为空 | 列表区 "该 workspace 暂无文件" + "新建文件" |
| Terminal 没启动 | 中央 "启动终端" 按钮（不自动消耗 PTY） |

### 9.3 认证 / 会话

- token 过期：拦截 ws 重连失败，自动 navigate 到 `/login`，登录后回原 path
- 移动端 auth 与桌面共用 atoms，shell 切换无感

### 9.4 应用前后台切换（移动专属）

- iOS Safari tab 移后台可能终止 ws：监听 `visibilitychange`，回前台强制重连一次
- 后台时间 > 60s：toast 提示"重新同步中"，同步完毕悄悄消失

### 9.5 长任务 / 后台 agent

- agent 跑在 server 端，移动端断网回来仍能拿结果
- 任意 agent 出 result：topbar 状态条徽章 +1，非当前 agent 的 chip 加未读角标

### 9.6 内存压力

- 移动 Safari kill 后台 tab → 重新进入走 ws 重连 + state rehydrate
- 不在前端缓存 agent 完整历史，分页加载

---

## 10. 实施分期

每期独立 PR，桌面端始终不受影响（`< 900px` 才走移动 shell）。

### Phase 0 — 基础设施（无 UX 改变）

- 把现 `app.tsx` 的布局抽到 `shells/desktop-shell.tsx`，逻辑零改动
- 加 `useViewport()` hook、stub `mobile-shell.tsx`（先渲染桌面 shell 占位）
- `tokens.css` 加触摸 token + 媒体查询覆盖
- `components.css` 把硬编码尺寸换成 token

**验收**：桌面所有现有 e2e + visual regression 不挂。

### Phase 1 — 移动 shell 骨架

- 实现 `MobileTopBar` / `MobileDock` / `MobileSheet` / `MobileWorkspaceDrawer`
- 接通 atoms，chat 区先空状态占位
- 手势 framework（左右滑、sheet 拖、边缘左滑）抽成 hooks

**验收**：< 900px 视口能看到完整 chrome，能切 workspace、能打开/关闭空 sheet。

### Phase 2 — Agent chat + chip 条

- 复用 `agent-panes` 组件嵌进 mobile shell
- agent chip 条 + 切换逻辑（tap / 横滑同步）
- composer + 软键盘 viewport 处理

**验收**：手机端能正常聊 agent，能切 agent，软键盘弹出不遮 composer。

### Phase 3 — Sheet 内容

- Files sheet（Files/Git tab + nav stack 到 Monaco / git-diff-viewer）
- Terminal sheet
- supervisor 徽章 + sheet

**验收**：手机端可访问全部 dock 功能，sheet 切换 / 关闭无 jank。

### Phase 4 — 二级页面

- Auth / Welcome / Settings 改整屏路由（settings 加 nav stack）
- Command palette / workspace-launch / worktree / objective dialog 改 sheet
- toast 位置切换、config-drift banner 紧凑化

**验收**：所有二级入口在移动端可达 + 可用。

### Phase 5 — 边界场景 + 打磨

- 连接状态 UI / 空状态 / visibilitychange 重连 / iOS Safari quirks
- 横屏 dock 紧凑化 / safe-area 全覆盖
- micro-anim 调音

**验收**：飞行模式断网 / 杀后台再回前台 / 旋转屏幕全部正常。

### Phase 6 — 测试 + 真机验收 + 文档

- 实机过 iPhone / Android / iPad 三档
- e2e 覆盖率达标
- 写移动端使用文档（README 补一节）

**验收**：发布。

---

## 11. 测试策略

### 11.1 单元测试（vitest）

- `useViewport` / `useSheetStack` / 手势 hooks 各自独立测
- mobile shell 组件用 Testing Library 跑结构 + 交互测

### 11.2 集成测试

- 现有 component theme 测试加移动端断点变体
- atoms ↔ shell 切换无状态丢失

### 11.3 E2E（Playwright）

- **桌面套**：现有 `acceptance:phase1` 全套保留，必须通过——回归红线
- **移动套**新增：`device: 'iPhone 13'` + `'Pixel 7'` + `'iPad mini portrait'` 三档跑核心流：登录 → 选 workspace → 切 agent → 发消息 → 打开 Files → 改文件保存 → 打开 Terminal
- 视觉回归基线分桌面 / 移动两套快照

### 11.4 真机测试（每期 ship 前）

- iPhone Safari（最新 iOS）
- Android Chrome（最新 Android）
- iPad Safari 竖屏 / 横屏（验证 900px 切换点）
- 至少两人在不同网络（4G / 弱 wifi / 飞行模式恢复）走一遍

---

## 12. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| CSS token 改动连带影响桌面视觉 | 中 | Phase 0 视觉回归基线先抓，再改 token |
| Monaco / xterm 在真机上意外不可用 | 中 | Phase 3 早期上真机；最坏改 read-only fallback 兜底 |
| iOS Safari 软键盘 / 100vh / 后台 kill | 高 | `100dvh` + `visualViewport` + visibilitychange 三件套；Phase 5 集中处理 |
| 两套 shell 长期维护分叉 | 低-中 | feature 组件共用、shell 只管 chrome；Phase 0 目录组织强制此边界 |
| 用户在桌面拖 splitter 的肌肉记忆在移动端没了 | 低 | 文档说明；移动端不允许 resize 是设计选择 |
| ws 在弱网移动场景下重连不稳 | 中 | 服务端已有重连 + resume_id；前端 visibilitychange 触发；Phase 5 弱网测 |
| 设计 / 开发节奏被实际真机问题拖慢 | 中 | Phase 0/1 先 ship 最小可用版本，迭代式推进 |

---

## 13. 不在范围内（Scope Guards）

- ❌ 重写 Monaco / xterm 或自研移动编辑器
- ❌ Tailwind / 设计系统大迁移
- ❌ 给桌面 shell 加新功能（只允许 token 替换式重构）
- ❌ PWA / 离线支持 / 安装到主屏（独立项目）
- ❌ 原生 app 壳（Capacitor / RN）（独立项目）
- ❌ 双向手势 collab 功能（observer follow 计划另开）
- ❌ 焦点模式在移动端的"再创新"（直接删除，不替代）
- ❌ 命令面板在移动端的"再设计"（直接复用 sheet 包裹，可后续打磨）
- ❌ 下拉刷新 / 加载历史等 v2 移动交互

---

## 14. 后续 / Follow-up

- v2 移动交互：长按 dock 预览（peek）、下拉加载历史、对比模式（双 agent 同屏）
- PWA 化：离线缓存、安装主屏、推送通知
- 折叠屏 / iPad mini 横屏的中间档位适配
- 桌面 splitter 与移动 sheet 状态保留时长统一
