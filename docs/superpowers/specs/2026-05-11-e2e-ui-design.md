# E2E UI 图谱方案设计

> **版本：** 1.0
> **日期：** 2026-05-11
> **状态：** Draft（等待评审）
> **作者：** Spencer + Codex

---

## 0. 文档说明

### 0.1 目的

为当前 app 新增一套独立于现有 `e2e/` 的 UI 自动化截图系统 `e2e-ui/`，用于：

- 用 mock 数据和稳定场景批量产出 PC / Mobile 双端页面与弹框截图
- 支持主题和语言切换
- 生成统一 `report.html` 供人工查看、样式回归比对和 agent 分析 UI
- 不改变现有 `e2e/` 的职责、目录和运行方式

### 0.2 背景

当前仓库已经具备以下基础：

- `packages/web` 已有双端壳切换：桌面走 `DesktopShell`，移动走 `MobileShell`
- UI 偏好已持久化在 `ui.theme` 和 `ui.locale`
- 现有 `e2e/` 已有 Playwright 基础设施与部分视觉类 spec
- 现有视觉类 spec 主要偏结构断言，不适合作为完整 UI 图谱输出系统

当前缺口：

- 没有一套只服务于“截图出图”和“视觉浏览”的独立用例体系
- 没有统一的截图归档与浏览页面
- 没有专门用于特殊状态、弹框、空态、错误态的稳定 scene 注册机制

### 0.3 设计目标

- 新建完全独立的 `e2e-ui/` 目录，与现有 `e2e/` 平级
- 保持现有 `e2e/` 不变，不迁移、不复用其 spec 结构
- 执行单一命令 `pnpm e2e-ui` 即完成：
  - 启动预览环境
  - 跑全部 UI scene
  - 输出全部截图
  - 生成统一 `report.html`
- 支持 PC / Mobile、Dark / Light、ZH / EN 组合截图
- 允许 scene 同时来源于：
  - 真实路由
  - 独立 mock / showcase 场景
- 结果只用于人工比对和 agent 查看，不接入 CI，不需要 smoke 分层

### 0.4 非目标

- 不替代现有 `e2e/`
- 不承担真实业务链路验收
- 不在本期接入 CI
- 不要求每个 scene 都做像素级基线断言
- 不把所有特殊态都强行走真实页面操作复现

---

## 1. 核心设计决策

| # | 决策 | 取舍理由 |
|---|---|---|
| D1 | UI 套件目录固定为 `e2e-ui/` | 与现有 `e2e/` 职责彻底分离 |
| D2 | 执行入口只保留一个命令 `pnpm e2e-ui` | 降低使用成本，符合“只做特殊用途”的目标 |
| D3 | scene 允许两种来源：`real-route` 与 `showcase` | 兼顾真实性、稳定性和覆盖率 |
| D4 | 截图结果统一写入 `e2e-ui/output/` | 输出目录固定，便于查看与清理 |
| D5 | 自动生成单文件 `report.html` | 无需额外服务即可离线浏览所有结果 |
| D6 | UI 套件默认只启动前端预览，不启动现有 e2e 的完整后端链路 | 保持运行更快、更稳 |
| D7 | 真实页面只覆盖稳定页面与少量易触发弹层 | 避免把图谱系统变成脆弱的流程自动化 |
| D8 | 特殊状态优先走 showcase / mock scene | 可稳定复现空态、错误态、确认态、loading 态 |
| D9 | 每个 scene 跑设备、主题、语言矩阵 | 满足 UI 修改和多皮肤、多语言回归查看需求 |
| D10 | report 按 category / source / device / theme / locale 分组 | 方便人工和 agent 快速定位同类 UI |

---

## 2. 总体架构

### 2.1 目录结构

建议目录如下：

```text
e2e-ui/
  package.json
  playwright.config.ts
  specs/
    capture.spec.ts
  fixtures/
    scene-runner.ts
    capture.ts
    prefs.ts
  scenes/
    index.ts
    pages.ts
    modals.ts
    sheets.ts
    states.ts
  report/
    build-report.ts
  output/
    screenshots/
    manifest.json
    report.html
```

前端侧新增独立预览入口：

```text
packages/web/
  ui-preview.html
  src/ui-preview/
    app.tsx
    scenes/
    mocks/
```

### 2.2 职责划分

`e2e-ui/` 负责：

- Playwright 执行
- scene 编排
- 截图落盘
- 结果清单生成
- `report.html` 产出

`packages/web/src/ui-preview/` 负责：

- 注册 showcase scene
- 注入 mock 数据
- 稳定渲染特殊状态

现有 `e2e/` 继续负责：

- 真实链路验收
- 行为与业务流程验证
- 现有 acceptance / regression 范围

### 2.3 系统边界

这套系统不是测试“功能是否正确”，而是产出“这个 UI 当前长什么样”的稳定可浏览资产。

因此它的成功标准不是断言通过数，而是：

- scene 能稳定打开
- 截图能稳定产出
- report 能按类别浏览
- 用户和 agent 能快速横向比较同一 scene 的不同主题、语言、设备结果

---

## 3. Scene 模型

### 3.1 Scene 类型

每个 scene 必须声明自己的来源：

- `real-route`
  - 直接打开真实页面路由
  - 允许少量 UI 操作进入稳定状态
- `showcase`
  - 进入 `ui-preview.html`
  - 通过 mock 数据直接渲染目标 UI

### 3.2 Scene 元数据

建议统一使用以下结构：

```ts
type UIScene = {
  id: string;
  title: string;
  category: "page" | "modal" | "sheet" | "toast" | "empty" | "error" | "loading";
  source: "real-route" | "showcase";
  route: string;
  devices: Array<"desktop" | "mobile">;
  themes: Array<"dark" | "light">;
  locales: Array<"zh" | "en">;
  description?: string;
  setup: (page: Page) => Promise<void>;
  target: (page: Page) => Promise<Locator>;
};
```

### 3.3 分类原则

- `page`：完整页面主视图
- `modal`：桌面模态框、确认框、弹层
- `sheet`：移动端 drawer / sheet / fullscreen sheet
- `toast`：提示信息
- `empty`：空态
- `error`：错误态
- `loading`：加载中状态

### 3.4 为什么要 scene 注册层

如果没有 scene 注册层，截图逻辑会散落在 Playwright spec 中，结果会出现：

- 截图命名不一致
- 同类 UI 无法聚类展示
- 难以扩展主题 / 语言 / 设备矩阵
- report 数据源不统一

scene 注册层的职责是把“拍什么”从“怎么跑”里分离出来。

---

## 4. 场景来源策略

### 4.1 真实路由场景

推荐首批放入 `real-route` 的场景：

- `welcome`
- `settings-general`
- `settings-appearance`
- `settings-providers`
- `workspace-desktop`
- `workspace-mobile`
- `not-found`
- `auth-preview`

这些场景的共同特点：

- 页面本身存在稳定入口
- 不需要复杂依赖就能打开
- 更适合直接反映真实产品状态

### 4.2 Showcase 场景

推荐优先走 `showcase` 的场景：

- `workspace-launch-modal`
- `command-palette`
- `branch-quick-pick`
- `worktree-modal`
- `supervisor-dialog`
- `confirm-dialog-danger`
- `toast-success`
- `toast-error`
- `empty-state`
- `provider-config-error`
- `mobile-workspace-drawer`
- `mobile-files-sheet`
- `mobile-terminal-sheet`
- `mobile-supervisor-sheet`
- `loading-state`

这些场景适合 showcase 的原因：

- 真实流程触发成本高
- 状态依赖复杂
- 容易受外部数据波动影响
- 人工主要关注外观，而非交互链路

### 4.3 路由与 Showcase 的混合原则

采用以下规则决定 scene 来源：

1. 能稳定直达、且能代表真实产品页面的，用 `real-route`
2. 需要复杂准备、外部依赖、异常注入、特定空态的，用 `showcase`
3. 同一个组件如果既有真实页面形态，又有多个特殊态，正常态可走真实路由，特殊态走 showcase

这是本方案的关键：不追求“所有 UI 都走真实流程”，也不追求“所有 UI 都是假场景”，而是用最小成本获得最稳定的 UI 图谱。

---

## 5. 截图矩阵与文件产物

### 5.1 运行矩阵

每个 scene 按以下维度展开：

- Device
  - `desktop`
  - `mobile`
- Theme
  - `dark`
  - `light`
- Locale
  - `zh`
  - `en`

并不是所有 scene 都必须覆盖全部维度。scene 自己声明支持的矩阵组合。

### 5.2 文件命名

截图建议命名格式：

```text
<category>/<scene-id>/<device>__<theme>__<locale>.png
```

示例：

```text
pages/settings-appearance/desktop__dark__zh.png
pages/settings-appearance/mobile__light__en.png
modals/workspace-launch-modal/desktop__dark__zh.png
sheets/mobile-files-sheet/mobile__dark__zh.png
```

### 5.3 输出目录

统一输出到：

```text
e2e-ui/output/
  screenshots/
  manifest.json
  report.html
```

其中：

- `screenshots/` 存放全部 PNG
- `manifest.json` 是 report 的数据源
- `report.html` 是可直接打开的统一浏览页

---

## 6. Report 设计

### 6.1 目标

`report.html` 的目标不是测试报告式的“通过/失败”，而是图片浏览式的“分类查看与横向比较”。

### 6.2 页面结构

建议页面分为两栏：

- 左侧筛选栏
  - category
  - source
  - device
  - theme
  - locale
- 右侧内容区
  - scene 分组列表
  - 每组内展示同一 scene 的全部截图
  - 支持点击查看大图

### 6.3 分组方式

report 内的第一层分组建议按 `category`：

- Pages
- Modals
- Sheets
- Toasts
- Empty
- Error
- Loading

每个分组下按 `scene id` 聚合。这样用户能在同一块中直接对比：

- 同一 scene 的 PC / Mobile 差异
- 同一 scene 的 Dark / Light 差异
- 同一 scene 的 ZH / EN 差异

### 6.4 Manifest 数据

建议每张图记录以下字段：

```json
{
  "id": "settings-appearance",
  "title": "Settings / Appearance",
  "category": "page",
  "source": "real-route",
  "device": "desktop",
  "theme": "dark",
  "locale": "zh",
  "path": "screenshots/pages/settings-appearance/desktop__dark__zh.png",
  "description": "真实设置页外观设置分区"
}
```

report 只依赖 `manifest.json` 和本地图片文件，不依赖额外服务端。

---

## 7. 执行流程

### 7.1 单命令入口

根命令固定为：

```bash
pnpm e2e-ui
```

该命令内部完成：

1. 启动 `packages/web` 预览环境
2. 执行 `e2e-ui` Playwright scene 采集
3. 输出截图文件
4. 生成 `manifest.json`
5. 生成 `report.html`

### 7.2 为什么只保留一个命令

用户明确要求只保留一个入口命令。这样做的好处：

- 使用成本最低
- 不需要记住 capture / report / open-report 等多个脚本
- 适合“有需要时手工跑一下看 UI”这种使用方式

### 7.3 运行环境要求

- 依赖 Node / pnpm
- 默认本地运行，不接 CI
- 生成结果覆盖 `e2e-ui/output/` 现有产物

---

## 8. 状态注入与稳定性策略

### 8.1 主题与语言注入

统一通过 Playwright fixture 在页面加载前写入：

- `localStorage["ui.theme"]`
- `localStorage["ui.locale"]`

确保真实路由与 showcase scene 都走同一套偏好入口。

### 8.2 稳定截图策略

截图前统一做以下处理：

- 等待主内容渲染完成
- 等待字体加载完成
- 关闭或冻结容易扰动截图的动画
- 规避光标闪烁、时间变化、随机数据变化

### 8.3 Mock 数据原则

showcase 场景中的 mock 数据必须：

- 固定
- 可读
- 能体现典型 UI 状态
- 不依赖外部服务

例如：

- 文件列表固定几条有层级的示例路径
- Git 变更固定 staged / unstaged / conflicted 组合
- 弹框标题和文案固定，避免长度随机

---

## 9. 错误处理与可维护性

### 9.1 Scene 失败策略

单个 scene 失败时，应：

- 在终端输出失败 scene id
- 尽量不影响其他 scene 继续执行
- 在 `manifest.json` 中可选记录失败项，便于后续排查

### 9.2 目录扩展规则

新增 scene 时必须满足：

- 在 `scenes/` 中注册
- 明确 `category`
- 明确 `source`
- 明确支持的 `devices / themes / locales`
- 明确截图目标 locator

这样可以避免后续截图集变成不可管理的脚本拼盘。

### 9.3 与现有 e2e 的隔离

必须保持以下边界：

- 不复用现有 `e2e/specs/*`
- 不修改现有 `e2e/playwright.config.ts`
- 不把 `e2e-ui/` 结果混到现有 test report
- 不把 `e2e-ui` 纳入现有 CI 命令

---

## 10. 首批交付范围

### 10.1 第一批 Pages

- Welcome
- Settings / General
- Settings / Appearance
- Settings / Providers
- Workspace / Desktop
- Workspace / Mobile
- Auth Preview
- Not Found

### 10.2 第一批 Modals / Sheets / States

- Workspace Launch Modal
- Command Palette
- Branch Quick Pick
- Worktree Modal
- Supervisor Dialog
- Confirm Dialog
- Mobile Workspace Drawer
- Mobile Files Sheet
- Mobile Terminal Sheet
- Success Toast
- Error Toast
- Empty State
- Loading State
- Provider Error State

### 10.3 为什么先做这批

这批覆盖了：

- 主页面骨架
- 双端主要容器
- 高价值弹层
- 多数 UI 调整时最常回看的状态

已经足够支撑：

- UI 改版前后人工回看
- 主题/语言兼容检查
- agent 查看现有样式结构

---

## 11. 测试与验证策略

这套系统的验证分三层：

1. Scene 可达性
   - 所有 scene 能稳定打开目标状态
2. 产物完整性
   - 每个 scene 的截图文件落盘成功
   - `manifest.json` 与图片文件一一对应
3. 报告可用性
   - `report.html` 可直接打开
   - 筛选和分组可正确浏览图片

本期不要求：

- 把每张图都做断言型视觉基线测试
- 接入 CI 阻塞合并
- 输出传统测试通过率报表

---

## 12. 实施步骤

建议按以下顺序实施：

1. 建立 `e2e-ui/` 基础目录与 Playwright 配置
2. 建立 scene 注册模型与截图输出规范
3. 建立 `packages/web/ui-preview.html` 与 showcase 渲染入口
4. 先接入首批 page scene
5. 再接入 modal / sheet / state scene
6. 生成 `manifest.json`
7. 生成 `report.html`
8. 补充文档和使用说明

这样可以先尽快跑通整条链路，再逐步丰富 scene 数量。

---

## 13. 结论

本方案的核心不是“再写一套 Playwright 测试”，而是为仓库建立一套独立的 UI 图谱系统：

- `e2e-ui/` 和现有 `e2e/` 平级
- `pnpm e2e-ui` 单命令运行
- 同时支持真实路由和 mock showcase
- 全量输出截图和统一 `report.html`
- 服务于人工比对、UI 调整和 agent 样式分析

这是当前需求下最稳妥的边界：既不污染现有 e2e，也不会把 UI 图谱系统做成脆弱的真实流程自动化。
