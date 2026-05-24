# Performance Monitoring — Design

Date: 2026-05-24
Status: Draft
Owner: spencer

## Problem

Coder Studio 现在有独立的诊断页，但没有正式的运行时性能监控能力。

这带来两个直接缺口：

- 用户无法快速判断“当前这台机器是不是已经接近吃满”
- 用户无法进一步归因“到底是哪个 workspace、哪个 agent 会话、还是哪个子进程在吃 CPU / 内存”

对这个项目来说，这不是一个纯后端指标问题，而是一个跨层问题：

- 服务端需要知道整机状态
- 服务端需要知道自己管理的进程树
- 前端需要把“整机压力”和“Coder Studio 自身消耗”放在同一张页面里
- 监控本身还必须可关、可降频、可降级，避免功能反过来制造额外负担

## Goals

- 提供独立的 `/monitoring` 页面，支持桌面端和移动端完整可用。
- 同时展示：
  - 宿主机 CPU / 内存压力
  - Coder Studio 当前服务和受管进程的总体资源消耗
  - `workspace -> session/agent -> subprocess` 的资源归因链路
- 支持实时监控和最近 `5 / 15 / 30 min` 的短时趋势。
- 在 `Settings` 中提供监控总开关、采集层选择和刷新频率配置。
- 在监控关闭、部分采样关闭、采样失败、深层采样过重等情况下提供明确降级状态。
- v1 覆盖 `macOS / Linux / Windows`。

## Non-Goals

- v1 不做跨天历史持久化。
- v1 不做阈值告警中心、通知规则或自动处理动作。
- v1 不在监控面板内直接提供 “stop session / close workspace / disable feature” 控制动作。
- v1 不采集磁盘 I/O、网络 I/O、fd、线程数、event loop lag 等更重的指标。
- v1 不把监控面板嵌进 workspace 主工作台视图。

## User Decisions Captured

- 监控对象同时包括：
  - 宿主机整体资源
  - Coder Studio 当前服务和受管进程
  - workspace / agent / 子进程归因
- “是否吃满”的判断依据以整机 CPU 和内存为主。
- 监控页面第一版是只读，不直接做关闭 workspace / agent 等控制动作。
- 归因主视图按 `workspace -> session/agent -> subprocess` 组织。
- 入口是独立的 `Monitoring` 页面，不放成工作区常驻面板。
- 桌面端和手机端都要完整可用。
- 指标范围第一版收敛到：
  - CPU
  - Memory
  - Process count
  - Uptime
  - Load average
- 监控功能必须有设置总开关、分层启用项和刷新频率配置。
- 默认值采用“默认关闭，进入 Monitoring 后再引导启用”。

## Approaches Considered

### Option A: 页面进入时按需拉取一次快照，前端自己轮询

优点：

- 服务端改动最少。
- 初版容易做出可用页面。

缺点：

- 无法稳定复用现有 WebSocket 实时模型。
- 页面打开才开始采样，历史趋势不可靠。
- 很难统一控制采样频率、缓存窗口和多端一致性。
- 页面刷新、移动端切页和桌面端切换会让监控状态断裂。

### Option B: 服务端常驻采样器 + 设置驱动开关/频率 + 独立 Monitoring 页面（推荐）

优点：

- 监控数据有单一真源，符合当前 server-first 架构。
- 能复用现有 command / topic / 页面加载模式。
- 可在服务端统一做采样预算、历史缓存、平台适配和降级。
- 容易同时服务桌面端和移动端。

缺点：

- 需要新增监控域、采样器、进程归因、前端页面和设置项。
- 需要补齐服务端“受管进程注册表”能力。

### Option C: 默认全开深度监控，尽量采一切细项

优点：

- 看起来“最完整”。

缺点：

- 与用户要求相冲突：监控本身会制造明显开销。
- 在跨平台实现、进程树遍历和历史缓存上都过重。
- 会把 v1 拖成性能排查工具而不是产品级监控页。

## Final Choice

采用 Option B。

监控能力作为独立的 `monitoring` 领域接入现有 server / ws / settings 体系：

- 服务端按设置决定是否启动采样器
- 采样器维护宿主机、运行时汇总、workspace/session 聚合和可选的 subprocess 明细
- Web 端通过 `/monitoring` 独立页面展示
- 设置页负责总开关、采集层和刷新频率
- 页面状态标签 `disabled / light / standard / deep` 由设置派生，不单独持久化

## Scope

### Included In v1

- 新增 `/monitoring` 桌面端和移动端页面
- 宿主机总览：
  - CPU usage
  - Memory used / total
  - Available memory
  - System uptime
  - Load average
- Coder Studio footprint：
  - server process CPU / memory
  - 全部受管进程树 CPU / memory 汇总
  - managed process count
  - 占整机 CPU / 内存比例
- 归因视图：
  - workspace 聚合
  - session / agent 聚合
  - 可选 subprocess 明细
- 最近 `30 min` 短时历史缓存
- `Settings > General` 中新增监控配置块
- 监控关闭 / 部分启用 / 数据不可用 / 深层采样受限等状态

### Excluded From v1

- 跨服务重启的历史保留
- 告警与通知
- 自动阈值策略配置
- 杀进程、停会话、关工作区等控制动作
- 磁盘 / 网络 / fd / 线程等指标

## Current Product Constraints

### Separate Routed Pages Already Exist

当前项目已经有与工作台分离的独立页面形态，`DiagnosticsPage` 是最直接的参考：

- [`packages/web/src/features/diagnostics/page.tsx`](../../../packages/web/src/features/diagnostics/page.tsx)
- [`packages/web/src/shells/desktop-shell.tsx`](../../../packages/web/src/shells/desktop-shell.tsx)
- [`packages/web/src/shells/mobile-shell/index.tsx`](../../../packages/web/src/shells/mobile-shell/index.tsx)

这意味着 `Monitoring` 适合沿用“独立路由 + 独立页面状态机”的模式，而不是塞进 workspace 主视图。

### Settings Are Server-Backed and Flat-Key Persisted

当前设置通过 `settings.get` / `settings.update` 走服务端仓储，支持嵌套对象输入和 dot-key 存储：

- [`packages/server/src/commands/settings.ts`](../../../packages/server/src/commands/settings.ts)

因此监控配置应该直接进入统一 settings 模型，而不是单独引入新的配置文件。

### Session / Workspace Metadata Already Exists

项目已稳定维护 `workspace`、`session`、`terminal` 元数据：

- [`packages/core/src/domain/types.ts`](../../../packages/core/src/domain/types.ts)
- [`packages/server/src/session/manager.ts`](../../../packages/server/src/session/manager.ts)
- [`packages/server/src/terminal/manager.ts`](../../../packages/server/src/terminal/manager.ts)

这为“按 workspace / session 聚合资源消耗”提供了足够的业务主键。

### PTY Root PID Is Not Yet Exposed As a First-Class Runtime Primitive

当前 PTY 抽象层没有把 `pid` 作为正式接口暴露给监控域：

- [`packages/server/src/terminal/types.ts`](../../../packages/server/src/terminal/types.ts)

虽然底层 `node-pty` 运行时有 PID，但监控设计不能依赖隐式细节。v1 必须补一层正式的“受管进程根信息”能力。

## Architecture

### 1. 新增独立的 Monitoring 域

建议新增：

- `packages/core/src/domain/monitoring.ts`
- `packages/core/src/protocol/topics.ts` 中新增 monitoring topic
- `packages/server/src/monitoring/*`
- `packages/server/src/commands/monitoring.ts`
- `packages/web/src/features/monitoring/*`

职责拆分：

- `core`
  - 共享类型
  - settings schema 相关常量 / helper
  - topic 常量
- `server`
  - host collector
  - process table collector
  - managed process registry
  - aggregation + history buffers
  - commands + broadcast
- `web`
  - monitoring route
  - desktop / mobile page rendering
  - settings UI

### 2. Managed Process Registry

为避免监控逻辑直接耦合 `TerminalManager`、`Supervisor`、`LSP`、未来 installer 等多个运行时模块，新增一个服务端内部的 `ManagedProcessRegistry`。

职责：

- 注册当前服务进程本身
- 注册每个受管 PTY / session 的根 PID
- 注册其他由服务端拉起的长生命周期或中生命周期子进程
- 为每个根进程附带业务归属信息

建议的 registry entry 结构：

```ts
interface ManagedProcessRoot {
  rootPid: number;
  kind: "server" | "terminal" | "session_helper" | "lsp" | "installer" | "background";
  workspaceId?: string;
  sessionId?: string;
  terminalId?: string;
  providerId?: string;
  label: string;
  startedAt: number;
}
```

关键规则：

- server 进程固定注册一次，`rootPid = process.pid`
- terminal 创建时注册，结束时注销
- session 相关非 PTY 子进程如果有明确 workspace / session 归属，也注册进来
- 没有明确 workspace 归属的后台进程归到 `background runtime` 分组

这个 registry 是 monitoring 域的输入，不直接暴露给前端。

### 3. Sampling Service

新增 `MonitoringService`，由 server 生命周期托管。

职责：

- 根据 settings 判断是否启用
- 根据 sample interval 启动 / 更新定时器
- 在每一轮采样中收集 host + process 数据
- 聚合成页面所需快照
- 写入短时历史缓存
- 通过 command 和 topic 暴露给前端

采样循环：

1. 读取当前 monitoring settings
2. 若 `enabled = false`，停止定时器并清空内存历史
3. 若 `enabled = true`，按 `sampleIntervalMs` 执行采样
4. 每一轮生成单一 `snapshot`
5. snapshot 写入缓存后再广播

### 4. Host Metrics Collector

host 层优先用 Node 原生能力完成：

- CPU usage: 基于 `os.cpus()` 时间片做 delta 计算
- Total / free memory: `os.totalmem()` / `os.freemem()`
- Available memory: 先用规范化字段，没有时回退 `freemem`
- System uptime: `os.uptime()`
- Load average: `os.loadavg()`

平台策略：

- `macOS / Linux`: load average 正常展示
- `Windows`: load average 标记为 `unavailable`，不让整页失败

### 5. Process Table Collector

为了跨平台支持 `CPU / RSS / PPID / elapsed time / command`，新增按平台适配的进程表采集器。

建议分为三个 adapter：

- `darwin`
- `linux`
- `win32`

产出统一结构：

```ts
interface ProcessStatRow {
  pid: number;
  ppid: number;
  cpuPercent: number;
  rssBytes: number;
  elapsedSec?: number;
  command?: string;
  executable?: string;
}
```

实现要求：

- 采集器失败时不能让 host metrics 一起失败
- 采集器返回部分字段缺失时，聚合逻辑仍可工作
- Windows 不要求和 Unix 用同一命令来源，只要求输出结构统一

### 6. Tree Aggregation Strategy

`runtime summary`、`workspace attribution`、`session attribution` 和 `subprocess drill-down` 不应该各自重复扫描系统进程表。

单轮采样流程应该是：

1. 收集完整 process table
2. 建 `pid -> row` 和 `ppid -> children[]` 索引
3. 以 `ManagedProcessRegistry` 中的 root PID 为起点构建受管进程树
4. 计算：
   - `server process`
   - `all managed processes total`
   - `workspace aggregate`
   - `session aggregate`
   - `subprocess groups`（仅在 deep 模式或对应采集层开启时输出）

重要约束：

- `workspace/session attribution` 即使不展示 leaf 明细，也仍然需要树聚合，否则 agent 根进程会低估真实消耗
- `subprocess drill-down` 只是在已有树聚合之上多输出 leaf/group 级明细，而不是开启另一套独立采样

### 7. Attribution Rules

#### 7.1 Host

永远只代表整机状态，不混入任何 Coder Studio 逻辑。

#### 7.2 Coder Studio Footprint

由以下部分组成：

- server 主进程
- 所有受管 terminal/session 根进程及其子树
- 明确注册的后台运行时进程

#### 7.3 Workspace

一个 workspace 的资源占用是其名下所有 session / terminal / workspace-scoped background 进程之和。

#### 7.4 Session / Agent

session 占用以对应 terminal root 为主键，向下合并其整棵子树。

#### 7.5 Standalone Shell

没有 session 归属的 shell terminal 仍然归属到 workspace，但单独显示为 `Standalone terminal` 分组，不伪装成 agent。

#### 7.6 Background Runtime

没有 workspace 归属的后台进程显示为 `Background runtime` 分组，出现在 `Coder Studio footprint` 的细分列表里，但不进入 workspace 树。

### 8. History Retention

v1 只做内存态短时历史。

默认规则：

- 保留窗口：`30 min`
- 默认页面窗口：`15 min`
- 可切换窗口：`5 / 15 / 30 min`
- 历史数据随 monitoring 关闭或 server 重启而丢失

为控制内存体积，历史分层保留：

- `host`：完整 `30 min`
- `runtime summary`：完整 `30 min`
- `workspace aggregate`：完整 `30 min`
- `session aggregate`：完整 `30 min`
- `subprocess groups`：完整 `30 min` 仅保留最近最热的有限集合，冷组只保留当前样本并在空闲后淘汰

建议 v1 对 subprocess history 设定内存上限：

- 只为最近活跃的 top-N leaf groups 保留完整序列
- 超出预算的 leaf group 仅保留当前值，不阻塞整体页面

这保证首屏和主要归因路径稳定，同时防止 deep 模式在大进程树上无限膨胀。

### 9. Commands and Topics

建议新增：

- `monitoring.get`
  - 返回当前 settings 派生状态、最新完整快照、页面所需历史数据
- `monitoring.recheck`
  - 手动触发一次立即采样，不改变定时器节奏

建议新增 topic：

- `monitoring.snapshot.updated`

前端模式：

- 进入页面时调用 `monitoring.get`
- 页面订阅 `monitoring.snapshot.updated`
- 连接恢复或页面手动刷新时重新执行 `monitoring.get`

这与当前 diagnostics 风格一致，但数据模型是持续流，而非一次性检查结果。

## Settings Model

### 1. Settings Shape

建议把监控配置并入统一 settings：

```ts
interface MonitoringSettings {
  enabled: boolean;
  hostMetricsEnabled: boolean;
  runtimeSummaryEnabled: boolean;
  workspaceAttributionEnabled: boolean;
  subprocessDrilldownEnabled: boolean;
  sampleIntervalMs: 1000 | 2000 | 5000 | 10000;
}
```

存储路径：

- `monitoring.enabled`
- `monitoring.hostMetricsEnabled`
- `monitoring.runtimeSummaryEnabled`
- `monitoring.workspaceAttributionEnabled`
- `monitoring.subprocessDrilldownEnabled`
- `monitoring.sampleIntervalMs`

### 2. Derived Mode Label

`Light / Standard / Deep` 是 UI 派生状态，不单独写入 settings。

建议规则：

- `disabled`
  - `enabled = false`
- `light`
  - 只开 host，或 host + runtime summary
- `standard`
  - 开到 workspace attribution
- `deep`
  - 开到 subprocess drill-down

### 3. Dependency Rules

设置项允许“有选择地启用”，但不能允许互相矛盾的组合。

建议依赖关系：

- `hostMetricsEnabled` 可单独开启
- `runtimeSummaryEnabled` 开启后才有服务占用汇总
- `workspaceAttributionEnabled` 依赖 `runtimeSummaryEnabled`
- `subprocessDrilldownEnabled` 依赖 `workspaceAttributionEnabled`

行为规则：

- 开启高层级项时，自动开启其依赖项
- 关闭低层依赖项时，自动关闭依赖它的更深层项

### 4. Default Values

默认值：

- `enabled = false`
- `hostMetricsEnabled = true`
- `runtimeSummaryEnabled = true`
- `workspaceAttributionEnabled = true`
- `subprocessDrilldownEnabled = false`
- `sampleIntervalMs = 2000`

解释：

- 默认总开关关闭，避免无感启动后台采样
- 用户第一次进入 `/monitoring` 时看到引导
- 一旦启用，推荐的起步配置是 `standard`，而不是 `deep`

## UX and Interaction

### 1. Route and Entry

新增独立路由：

- `/monitoring`

接入：

- desktop shell 路由
- mobile shell 路由
- command palette 增加 “Open Monitoring”
- settings 内提供跳转入口

v1 不要求新增 topbar 常驻按钮。

### 2. Desktop Layout

桌面端采用“两层判断 + 一层钻取”的平衡式布局。

#### 2.1 First Screen

首屏上半部分同时展示两块：

- `Host overview`
- `Coder Studio footprint`

它们必须同屏可见，不做二选一。

#### 2.2 Lower Area

下半部分采用双栏：

- 左栏：`Attribution tree`
  - `workspace -> session/agent -> subprocess`
  - 默认按 `CPU` 排序，可切到 `Memory`
- 右栏：`Detail panel`
  - 当前选中实体的当前值、趋势、归属信息和热点子项

#### 2.3 Visible Controls

以下控制在桌面端必须一眼可见，不藏进二级菜单：

- `CPU / Memory` 排序切换
- `5 / 15 / 30 min` 时间窗
- 手动刷新
- 当前 monitoring mode 标签

### 3. Mobile Layout

移动端不照搬桌面双栏。

建议结构：

- 顶部：总览卡片 + 当前 mode / last updated / refresh frequency
- 中段：分段切换
  - `Overview`
  - `Attribution`
  - `Process`
- 详情：点击某个 workspace / session / subprocess 后进入独立详情层

原则：

- 功能完整
- 信息密度比桌面低
- 不在一个小屏上并排塞进归因树和详情面板

### 4. Disabled State

当 `monitoring.enabled = false`：

- 页面不假装加载中
- 直接展示 `Monitoring disabled` 空状态
- 说明不会进行后台采样
- 提供 “Open settings” 跳转到设置页对应分组

### 5. Partial Collection State

当某些层未开启：

- 不把区域渲染成错误
- 显示明确的解释性空态

例如：

- 未开启 runtime summary：
  - 只展示 host
  - `Coder Studio footprint` 显示 “Enable runtime summary in settings”
- 未开启 subprocess drill-down：
  - 归因树展示 workspace/session 聚合
  - subprocess 区显示 “Enable subprocess drill-down in settings”

### 6. Visual State Labels

页面顶部展示：

- `Disabled`
- `Light`
- `Standard`
- `Deep`

同时显示：

- `Last updated`
- `Refresh every 2s / 5s / ...`

## Monitoring Settings UI

### 1. Placement

不新增独立 settings section，先放在 `Settings > General` 里新增 `Performance monitoring` 分组。

理由：

- 这是运行时行为配置，不是外观或 provider 配置
- 能避免 settings 左侧导航继续膨胀

### 2. Controls

推荐控件：

- 主开关：
  - `Enable performance monitoring`
- 预设 pills：
  - `Light`
  - `Standard`
  - `Deep`
- 高级自定义开关：
  - `Host metrics`
  - `Runtime summary`
  - `Workspace and session attribution`
  - `Subprocess drill-down`
- 频率 pills：
  - `1s`
  - `2s`
  - `5s`
  - `10s`

交互规则：

- 选预设时直接写入对应组合
- 用户手动改高级开关后，预设标签切到 `Custom`
- 关闭主开关时，其余选项保留但禁用显示，重新开启时恢复上次选择

### 3. Page/Header Reflection

`Monitoring` 页面顶部只读展示当前策略，不直接在页面内修改设置。

这保持“监控页是读操作，设置页是配置入口”的边界清晰。

## Domain Model

以下为建议共享类型轮廓。

### Host Summary

```ts
interface MonitoringHostSummary {
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  loadAverage: [number, number, number] | null;
  uptimeSec: number | null;
  pressure: "normal" | "elevated" | "hot" | "unknown";
}
```

### Runtime Summary

```ts
interface MonitoringRuntimeSummary {
  serverCpuPercent: number | null;
  serverMemoryBytes: number | null;
  totalManagedCpuPercent: number | null;
  totalManagedMemoryBytes: number | null;
  managedProcessCount: number;
  cpuShareOfHostPercent: number | null;
  memoryShareOfHostPercent: number | null;
}
```

### Attribution Entity

```ts
interface MonitoringEntitySummary {
  id: string;
  kind: "workspace" | "session" | "subprocess_group" | "background_group";
  parentId?: string;
  workspaceId?: string;
  sessionId?: string;
  label: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  processCount: number;
  uptimeSec: number | null;
  trend: "rising" | "steady" | "falling" | "unknown";
  childCount?: number;
}
```

### Snapshot

```ts
interface MonitoringSnapshot {
  sampledAt: number;
  mode: "disabled" | "light" | "standard" | "deep";
  host: MonitoringHostSummary | null;
  runtime: MonitoringRuntimeSummary | null;
  workspaces: MonitoringEntitySummary[];
  sessions: MonitoringEntitySummary[];
  subprocessGroups?: MonitoringEntitySummary[];
  backgroundGroups?: MonitoringEntitySummary[];
}
```

### Page Response

```ts
interface MonitoringResponse {
  settings: MonitoringSettings;
  snapshot: MonitoringSnapshot;
  history: {
    host: MonitoringSeriesBundle;
    runtime: MonitoringSeriesBundle | null;
    workspaces: Record<string, MonitoringSeriesBundle>;
    sessions: Record<string, MonitoringSeriesBundle>;
  };
  capabilities: {
    loadAverageAvailable: boolean;
    subprocessHistoryLimited: boolean;
  };
}
```

## Pressure and Status Rules

### 1. Host Pressure

整机压力标签只基于 host CPU 和 memory。

- `normal`
- `elevated`
- `hot`
- `unknown`

`load average` 只做辅助显示，不作为“是否吃满”的主判断。

阈值先做成服务端常量，不进 v1 设置面板。

### 2. Monitoring Mode

页面 mode 和 host pressure 是两个独立维度：

- mode 说明“当前监控采了多深”
- pressure 说明“机器当前压力有多高”

不能混成一个状态。

## Degradation and Failure Handling

### 1. Missing Host Fields

- host 某单项缺失时，只让该字段显示 `unavailable`
- 不让整页失败

### 2. Process Collection Failure

如果进程表采集失败：

- host 区仍然显示
- runtime / attribution 区显示降级说明
- 页面 mode 不自动变为 disabled，因为配置仍然是启用状态

### 3. Deep Sampling Too Costly

如果 subprocess deep collection 在大工作区上开销过大：

- 首先保 host 和 runtime summary 可用
- 然后保 workspace / session 聚合
- 最后才牺牲 subprocess leaf 完整度

也就是说，降级顺序必须是：

1. subprocess detail
2. session/workspace detail richness
3. runtime summary
4. host metrics

### 4. Sampling Telemetry

监控模块自身要记录：

- 本轮采样耗时
- process table 行数
- leaf group 数量
- 是否发生历史裁剪 / 降级

这些值先不对用户大面积展示，但至少要能在日志和页面提示中使用。

## Testing Strategy

### Core

- monitoring settings 常量和类型
- interval schema / helper
- topic 常量

### Server

- monitoring settings 开关和依赖规则
- service 启停和频率切换即时生效
- host summary 聚合
- process table 聚合
- workspace / session / subprocess 归因
- monitoring 关闭时不采样、不广播
- 平台字段缺失和采样失败降级
- subprocess history 裁剪不影响上层 summary

### Web

- `/monitoring` 桌面端渲染
- `/monitoring` 移动端渲染
- disabled / light / standard / deep 各状态
- host-only / partial attribution / deep leaf 三类空态
- 时间窗与排序切换
- settings 中监控块的交互和依赖规则

### Integration

- 启动多个 workspace / agent / shell，验证聚合值与归属链路一致
- session 退出后热点列表和 process count 及时收敛
- settings 改频率、开关和采集层后，server 采样策略同步切换
- deep 模式在大进程树下仍能保持首页可用

## Open Implementation Notes

- 监控页的图表不需要在 v1 引入复杂图表库；小型折线 / sparkline 即可。
- `Monitoring` 页面视觉语言应复用 diagnostics/settings 的 surface 和 page header 体系，避免另起一套设计系统。
- 如果后续要支持告警或控制动作，优先在当前 `Monitoring` 域上扩展，不再新起并行“performance tools”页面。

