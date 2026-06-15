# Work Analysis

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 工作分析页面、时间范围、dashboard、basic/deep analysis。
- 任务分类、效率、重试、证据采样、日志源适配。

不覆盖：
- 系统监控。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Work Analysis page | Both | 查看工作分析数据。 |
| 时间范围控件 | Both | 选择分析范围。 |
| Refresh / Rebuild / Run | Both | 触发分析刷新或重建。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| WA-001 | Work Analysis page 渲染 | Implemented | `packages/web/src/features/work-analysis/page.tsx` | `packages/web/src/features/work-analysis/page.test.tsx` |
| WA-002 | 前端 controller 和 dispatch | Implemented | `use-work-analysis-controller.ts`、`use-work-analysis-dispatch.ts` | `use-work-analysis-controller.test.tsx` |
| WA-003 | 时间范围和格式化 | Implemented | `lib/time-range.ts`、`format.ts` | `format.test.ts` |
| WA-004 | work analysis get/basic/deep | Implemented | `work.analysis.get`、`runBasic`、`runDeep` | `packages/server/src/__tests__/work-analysis-commands.test.ts` |
| WA-005 | dashboard get/refresh/rebuild | Implemented | `work.analysis.dashboard.*` | `packages/server/src/__tests__/work-analysis-commands.test.ts` |
| WA-006 | log collector 和 source adapters | Internal | `packages/server/src/work-analysis/log-sources` | `work-analysis-log-collector.test.ts`、`work-analysis-log-sources-file-adapters.test.ts` |
| WA-007 | task classifier | Internal | `work-analysis/classification` | `work-analysis-task-classifier.test.ts` |
| WA-008 | efficiency/retry metrics | Internal | `work-analysis/metrics` | `work-analysis-efficiency-metrics.test.ts`、`work-analysis-retry-metrics.test.ts` |
| WA-009 | optimize/exporters | Internal | `work-analysis/optimize`、`exporters` | `work-analysis-efficiency-and-optimize.test.ts` |

## 4. 模块级验收线索

- 页面加载后能展示当前时间范围内的分析结果。
- Refresh 或 rebuild 后 dashboard 数据更新。
- 缺少数据时应显示空态或说明。

## 5. 功能点规格

### WA-001 Work Analysis page 渲染

状态：`Implemented`

用户行为：
- 用户进入 Work Analysis 页面或 Settings 的 Analysis 分区。

系统响应：
- 页面创建 work analysis controller，并从 URL query 解析时间范围和目录筛选。
- 控制器加载 dashboard 后渲染状态条、KPI、token 趋势、贡献排行、任务/工具/skill 归因和小时热力图。
- 没有可用或足够新的小时索引时，服务自动补齐索引后返回 dashboard。
- 没有 dashboard 时展示空态，并提供立即刷新按钮。

状态与边界：
- Loading：首次读取或补齐索引时显示扫描中提示。
- Empty：没有索引或数据时显示“暂无工作分析索引”。
- Warning：scanState error 或 dashboard quality warnings 以 Notice 展示。
- URL sync：筛选条件变化后写回路由 query。

验收标准：
- Given 当前没有 dashboard 数据
- When 用户打开 Work Analysis 页面
- Then 页面显示自动扫描中的状态
- And 索引补齐后展示 dashboard
- And 仍提供立即刷新操作

代码索引：
- `packages/web/src/features/work-analysis/page.tsx`
- `packages/web/src/features/work-analysis/navigation.ts`

### WA-002 前端 controller 和 dispatch

状态：`Implemented`

用户行为：
- 用户切换时间范围、选择目录、刷新或强制重建 dashboard。

系统响应：
- `useWorkAnalysisController` 维护 selected/available workspace paths、range preset、custom range、dashboard loading 和刷新状态。
- query 无效时不发请求，并清空 dashboard record。
- 加载 dashboard 时使用 request id 和 cancelled guard，避免旧请求覆盖新结果。
- `useWorkAnalysisDispatch` 遇到 `activation_required` 时跳转 `/session-gate`。

状态与边界：
- Invalid time：custom start/end 无效时 query 为 null。
- Empty customized paths：用户自定义目录但选择为空时 query 为 null。
- Race：后返回的旧 dashboard 请求不能覆盖新筛选结果。
- Session gate：服务端要求激活时中断当前数据流并导航。

验收标准：
- Given 用户快速切换 24h 到 7d
- When 较旧的 24h 请求晚于 7d 返回
- Then controller 保留 7d 对应 dashboard

代码索引：
- `packages/web/src/features/work-analysis/use-work-analysis-controller.ts`
- `packages/web/src/features/work-analysis/use-work-analysis-dispatch.ts`

### WA-003 时间范围和目录筛选

状态：`Implemented`

用户行为：
- 用户选择 24h、7d、30d、90d 或自定义开始/结束时间。
- 用户按 workspace path 筛选 dashboard，或恢复全部目录。

系统响应：
- 时间筛选构造 `timeRange`，preset 使用 `{ preset }`，自定义范围使用 `{ startAt, endAt }`。
- 目录筛选默认跟随 dashboard 中的项目路径。
- 第一次点击目录时进入自定义模式，并只选择被点击目录。
- 在只剩一个目录时取消该目录，会退出自定义模式并恢复全部目录。

状态与边界：
- Custom range：开始/结束时间由 DateTimePicker 输入。
- No directories：没有可筛选目录时显示空提示。
- URL：自定义筛选会写入路由，便于刷新恢复。

验收标准：
- Given dashboard 中有 `/repo/a` 和 `/repo/b`
- When 用户点击 `/repo/a`
- Then query 只包含 `/repo/a`
- When 用户再次取消 `/repo/a`
- Then query 恢复为全部目录

代码索引：
- `packages/web/src/features/work-analysis/page.tsx`
- `packages/web/src/features/work-analysis/lib/time-range.ts`
- `packages/web/src/features/work-analysis/use-work-analysis-controller.ts`

### WA-004 work analysis get/basic/deep

状态：`Implemented`

用户行为：
- 内部流程或测试直接请求基础/深度工作分析。

系统响应：
- `work.analysis.get` 返回当前查询结果。
- `work.analysis.runBasic` 触发基础分析。
- `work.analysis.runDeep` 触发深度分析。
- 三个命令都接受可选 workspacePaths 和必填 timeRange。

状态与边界：
- Preset：timeRange 可为 `24h|7d|30d|90d` preset。
- Custom：timeRange 可为 startAt/endAt 数值。
- Unavailable：workAnalysisService 缺失时返回 `work_analysis_unavailable`。
- UI：当前主页面主要使用 dashboard 命令；basic/deep 是服务端能力。

验收标准：
- Given workAnalysisService 已配置
- When 调用 `work.analysis.runBasic` 且 timeRange 为 `{ preset: "7d" }`
- Then 服务端调用 basic analysis 并返回结果

代码索引：
- `packages/server/src/commands/work-analysis.ts`
- `packages/server/src/work-analysis`

### WA-005 dashboard get/refresh/rebuild

状态：`Implemented`

用户行为：
- 用户查看 dashboard、点击立即刷新，或确认强制刷新索引。

系统响应：
- 页面加载时调用 `work.analysis.dashboard.get`。
- 点击刷新调用 `work.analysis.dashboard.refresh`，成功后替换 dashboardRecord。
- 点击强制刷新先弹出确认框，确认后调用 `work.analysis.dashboard.rebuild`。
- 强制刷新会清空并重建小时索引，不删除原始日志。

状态与边界：
- Refreshing：刷新按钮展示 loading。
- Rebuilding：确认按钮在重建中禁用并展示进行中文案。
- Error：命令失败时当前代码保持原 dashboard，不自动展示单独错误，只依赖 scanState/quality warnings。
- Unavailable：服务缺失返回 `work_analysis_unavailable`。

验收标准：
- Given 页面已有 dashboard
- When 用户点击强制刷新并确认
- Then 前端调用 `work.analysis.dashboard.rebuild`
- And 成功返回后 dashboardRecord 被更新

代码索引：
- `packages/server/src/commands/work-analysis.ts`
- `packages/web/src/features/work-analysis/page.tsx`
- `packages/web/src/features/work-analysis/use-work-analysis-controller.ts`

### WA-006 log collector 和 source adapters

状态：`Internal`

用户行为：
- 无直接稳定 UI；作为 dashboard 和 analysis 服务的数据源。

系统响应：
- log collector 从配置的日志源读取 agent/session 记录。
- source adapters 适配不同 provider 或文件日志格式。
- 采集结果供 classifier、metrics 和 dashboard projection 使用。

状态与边界：
- Missing logs：没有可读日志时上层 dashboard 应进入空态或低数据质量提示。
- Adapter errors：源适配失败应被服务层汇总为 scanState 或 warning。

验收标准：
- Given 日志源包含可解析 session 记录
- When collector 执行扫描
- Then 返回标准化记录供后续分析

代码索引：
- `packages/server/src/work-analysis/log-sources`
- `packages/server/src/work-analysis/log-collector.ts`

### WA-007 task classifier

状态：`Internal`

用户行为：
- 无直接 UI；用户在 dashboard 中看到任务类型分布。

系统响应：
- classifier 将 session 或 message 证据归入任务类别。
- dashboard 将分类结果汇总到任务类型 token 分布。

状态与边界：
- Unknown：无法识别的记录应落入默认/未知类别，而不是阻断 dashboard。
- Evidence：分类基于日志证据，不依赖旧 PRD。

验收标准：
- Given 一组包含编码任务证据的记录
- When classifier 处理
- Then 输出对应任务类别供 dashboard 聚合

代码索引：
- `packages/server/src/work-analysis/classification`

### WA-008 efficiency/retry metrics

状态：`Internal`

用户行为：
- 用户在 dashboard KPI 或质量提示中查看效率、重试等指标。

系统响应：
- metrics 模块基于分析记录计算 active time、token、retry 等指标。
- dashboard projection 将指标格式化为 KPI、趋势和排行。

状态与边界：
- Empty records：输入为空时应返回空指标或 0 值，不阻断页面。
- Formatting：前端负责 duration、percent、token 的展示格式。

验收标准：
- Given 分析记录包含 token 和 activeDuration
- When metrics 聚合
- Then dashboard KPI 包含总 token 和活跃时间

代码索引：
- `packages/server/src/work-analysis/metrics`
- `packages/web/src/features/work-analysis/format.ts`

## 6. 未确认项

- 导出功能是否有稳定 UI 入口需在第二轮确认。
