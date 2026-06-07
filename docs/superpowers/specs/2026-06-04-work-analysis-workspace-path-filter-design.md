# Work Analysis Workspace Path Filter Redesign

Date: 2026-06-04
Status: Draft
Owner: spencer

## Problem

当前 `工作分析` 把“已打开的 workspace”当成分析前置筛选条件：

- 前端设置页只允许从当前 `orderedWorkspaces` 里选 workspace。
- 服务端 `work.analysis.*` 查询模型要求 `workspaceIds`。
- `WorkAnalysisService` 先把 `workspaceIds` 解析成 workspace path，再把这些 path 传给 provider log source 做发现。

这和真实需求不一致。

用户希望：

- 工作分析应先扫描 agent/provider 日志里在所选时间范围内命中的全部 workspace 目录。
- 即使某个目录从未在 Coder Studio 里 `open workspace`，只要它在 provider 日志中出现，也必须进入分析域。
- workspace 不应该作为“事前屏蔽不相关目录”的条件，而应该作为“分析结果出来后的筛选项”。
- 用户可以先看全部目录的汇总，再缩小到一个或多个具体路径。

因此，当前“只看已打开 workspace”的设计在产品语义上是错误的。

## Goals

- 工作分析不再依赖 Coder Studio 已打开 workspace 列表作为前置输入。
- provider log scan 在给定时间范围内收集所有命中的 `workspacePath`。
- `workspacePath` 成为工作分析域内的一级筛选维度。
- 前端路径筛选项来自分析结果中的 `availableWorkspacePaths`，而不是 `orderedWorkspacesAtom`。
- 初次分析默认汇总全部命中路径；用户可再按路径多选缩小结果。
- 保持 5 个内置 provider 都遵循同一语义。

## Non-Goals

- 不保留旧 `workspaceIds` 查询协议的兼容层。
- 不尝试把未打开目录映射成伪 workspace id。
- 不在本轮引入“已打开 workspace 标记”或路径分组 UI。
- 不把路径筛选扩展成更复杂的 tag、搜索或树形浏览器。
- 不修改 provider 原始日志结构。

## User Decisions Captured

- 不考虑兼容旧方案，应按正确方案重做。
- workspace 只作为分析结果筛选项，不再作为分析前置筛选项。
- UI 采用最简单的“纯路径多选”形式。
- 不要求路径选项和已打开 workspace 产生任何绑定关系。

## Current State

### Query Model

当前 `work.analysis.get`、`work.analysis.runBasic`、`work.analysis.runDeep` 都要求：

- `workspaceIds: string[]`
- `timeRange`

这使“分析域”在请求发出前就被限制为已打开 workspace。

### Service Data Flow

当前 [`packages/server/src/work-analysis/service.ts`](../../../packages/server/src/work-analysis/service.ts) 的关键流程是：

1. 规范化 `workspaceIds`
2. 通过 `workspaceResolver` 解析成 `workspacePaths`
3. 把这些 `workspacePaths` 传给 `workLogCollector`
4. provider adapter 只在这些 path 范围内找日志
5. analyzer 基于这个预筛选后的 session 集合做聚合

这意味着：

- 未打开 workspace 的日志永远不会进入分析域。
- `available workspaces` 的来源是 app state，而不是 provider 历史。

### Frontend State

当前 [`packages/web/src/features/settings/components/session-analysis-settings.tsx`](../../../packages/web/src/features/settings/components/session-analysis-settings.tsx)：

- 用 `orderedWorkspacesAtom` 渲染复选框
- 用 `activeWorkspaceId` 做默认值
- 把 `selectedWorkspaceIds` 直接发给 `work.analysis.*`

这使设置页本质上变成了“已打开 workspace 过滤器”，不是“分析结果路径过滤器”。

## Desired Model

### Core Principle

工作分析的输入只有两类：

- 时间范围
- 可选的 `workspacePaths` 结果过滤器

其中：

- `workspacePaths` 为空或省略，表示“扫描并汇总时间范围内全部命中的路径”
- `workspacePaths` 非空，表示“只在已发现路径中保留这些路径对应的数据”

### Two-Phase Mental Model

正确语义应是：

1. **发现阶段**：provider 日志扫描命中的全部 session，并记录它们的 `workspacePath`
2. **分析阶段**：根据用户选择的 `workspacePaths` 对 discovered sessions 进行过滤和聚合

注意这里的“发现”不是单独暴露为用户操作，而是 `runBasic/get` 的内部流程。

### UI Semantics

设置页进入工作分析后：

1. 用户先只指定时间范围
2. 页面请求“全路径汇总”分析
3. 返回结果中包含 `availableWorkspacePaths`
4. 页面用这些路径渲染多选框，默认全选
5. 用户取消部分路径后，再次请求分析，传所选 `workspacePaths`

因此 UI 中的路径列表是“分析结果的一部分”，不是“app shell 里的 workspace 列表”。

## Proposed Architecture

### 1. Query Schema Rewrite

将工作分析查询模型改为：

- `workspacePaths?: string[]`
- `timeRange`

规则：

- 未提供 `workspacePaths` 或传空数组：不过滤路径
- 提供非空数组：按绝对路径字符串精确匹配过滤

不再接受 `workspaceIds`。

### 2. Provider Log Source Contract Rewrite

当前 provider source discover 输入依赖：

- `workspacePaths`
- `timeRange`

这需要改成只依赖：

- `timeRange`

provider adapter 的职责变为：

- 扫描 provider 自身日志根目录或数据库
- 找出时间范围内命中的 session
- 从记录中提取 `workspacePath`
- 返回归一化 `WorkLogSession[]`

是否保留某个 session，不再由外部 path 白名单决定，而由 provider adapter 根据时间范围和日志完整性决定。

### 3. Service-Level Filtering

`WorkAnalysisService` 的新流程：

1. 规范化查询
2. 调用 collector，按时间范围收集全部 provider sessions
3. 从 collection 中提取唯一 `availableWorkspacePaths`
4. 若查询指定了 `workspacePaths`，则按路径过滤 session
5. 用过滤后的 session 跑 basic analyzer
6. 在 record/basic result 中写入 `availableWorkspacePaths`
7. deep analysis 也只基于过滤后的 session/evidence

这里的关键变化是：

- provider collector 负责“收集全部”
- service 负责“按用户路径筛选”

### 4. Result Shape Rewrite

基础分析结果新增：

- `availableWorkspacePaths: string[]`

它表示：

- 在当前时间范围内，从 provider 日志实际发现过的全部 workspace 路径
- 已按 provider parse/时间范围规则归一化后的可选路径全集

同时保留现有汇总字段，但 `workSurface.workspaceIds` 应改为路径语义，例如：

- `workSurface.workspacePaths: string[]`

避免继续使用错误的 id 概念。

### 5. Frontend Filter Rewrite

设置页状态改为：

- `selectedWorkspacePaths: string[]`
- 初始为空，表示尚未拿到分析结果路径全集

流程：

1. 首次请求只带 `timeRange`
2. 收到结果后读取 `availableWorkspacePaths`
3. 如果用户尚未手动改过筛选，则把 `selectedWorkspacePaths` 设为全部路径
4. 当用户调整路径多选时，重新请求分析，传 `{ workspacePaths: selectedWorkspacePaths, timeRange }`

显示规则：

- 没有结果前，不渲染路径多选列表
- 有结果但 `availableWorkspacePaths` 为空，显示“该时间范围内没有发现 provider 日志目录”
- 路径直接显示绝对路径字符串

## Data Flow

### Basic Analysis

1. UI 请求 `work.analysis.get({ timeRange })`
2. service 扫描 provider logs，得到所有命中 session
3. service 产出：
   - `availableWorkspacePaths`
   - 基于全部路径聚合的 basic result
4. UI 渲染结果和路径多选，默认全选
5. 用户选择子集路径
6. UI 请求 `work.analysis.get({ timeRange, workspacePaths })`
7. service 复扫 provider logs 并在 service 层过滤路径
8. UI 渲染所选路径对应分析结果

### Deep Analysis

1. UI 在已有路径筛选状态下触发 `runDeep`
2. 请求参数沿用当前 `workspacePaths + timeRange`
3. service 复扫并按路径过滤
4. evidence sampler 只从过滤后的 session 中抽样
5. deep runner 基于过滤后的 basic/evidence 运行

## Testing Strategy

### Server Tests

新增或改写以下测试：

- `WorkAnalysisService` 在未提供 `workspacePaths` 时，会聚合多个未打开目录的 session
- `WorkAnalysisService` 在提供 `workspacePaths` 时，只保留匹配路径的 session
- `basic-analyzer` 的 `workSurface` 和新 `availableWorkspacePaths` 使用路径语义
- `work-analysis` commands schema 改为接受 `workspacePaths`
- provider log collector 相关测试不再依赖 discover 输入里的 `workspacePaths`

### Frontend Tests

新增或改写以下测试：

- settings page 首次进入分析页时，初次请求不发送 `workspaceIds`
- 收到分析结果后，路径多选项来自 `availableWorkspacePaths`
- 调整路径多选后，请求发送 `workspacePaths`
- 页面不再依赖 `orderedWorkspacesAtom` 渲染分析筛选项

### E2E

新增一条真实路径语义的 e2e：

- provider 日志中存在两个未打开目录
- 设置页工作分析首次展示汇总结果
- 路径筛选项展示这两个目录
- 取消一个目录后，结果只剩另一个目录对应数据

## Risks

### Provider Scan Cost

去掉前置 workspace path 白名单后，provider scan 范围会扩大。

缓解：

- 仍严格按时间范围裁剪
- adapter 先做轻量 metadata 过滤，再读重内容
- 保持 basic analysis summary-first，不加载全文

### Path Normalization Drift

不同 provider 记录的路径格式可能不完全一致，例如大小写、symlink、Windows 分隔符。

本轮先采用现有绝对路径字符串语义，不引入复杂 canonicalization；如果后续出现实测问题，再单独设计路径归一化策略。

### Empty First Result UX

首次进入时路径筛选项要等第一次分析结果返回后才知道，这比“直接用已打开 workspace 列表”多一步。

这是正确代价，因为路径全集本来就应该来自 provider 历史，而不是 app state。

## Migration Impact

这是一次显式语义重写，不做向后兼容。

影响：

- 前后端 `work analysis` 查询类型全部改成 `workspacePaths`
- 基础分析结果中的 workspace 维度改成 path 语义
- 旧测试和旧 seed 数据凡是使用 `workspaceIds` 作为分析筛选输入的，都要更新

不要求保留旧 query record 的读取兼容语义；按新方案统一即可。

## Recommended Implementation Order

1. 改 query types / commands schema 到 `workspacePaths`
2. 改 service 与 collector contract，去掉 discover-time path 白名单
3. 改 analyzer/result types，加入 `availableWorkspacePaths`
4. 改设置页状态机，路径筛选来源切到分析结果
5. 补齐 server/web/e2e 测试

## Acceptance Criteria

- 用户未打开某个 workspace，但它出现在 provider 日志中时，工作分析仍能发现并展示该路径。
- 工作分析首次运行时默认汇总全部命中路径，而不是只看当前打开 workspace。
- 用户可以从结果里的路径列表中多选一个或多个路径重新查看分析结果。
- 前端和服务端都不再把“已打开 workspace”当成工作分析前置筛选条件。
- 5 个内置 provider 的工作分析语义保持一致。
