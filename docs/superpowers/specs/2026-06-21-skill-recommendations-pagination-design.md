# Skill Recommendations Pagination Design

Date: 2026-06-21
Status: Draft
Owner: codex

## Problem

当前 `Skills` 面板里的推荐区使用 `skills.recommend` 一次性返回固定数量的结果，前端直接整块渲染：

- 默认不传 `limit`
- 服务端默认只返回 5 条推荐
- 接口参数把 `limit` 上限限制在 10
- 推荐区没有分页能力
- 推荐区也没有“滚动到底部继续加载”的交互

这会带来两个问题：

- 推荐区默认可见内容太少，用户很容易看不到后续推荐
- 如果简单把默认数量调大，推荐区会继续走“一次性全量加载”的模型，后续扩展性和滚动体验都不理想

用户这次要的不是单纯把数字从 5 改成 20，而是把推荐区改成真正的分页模型：

- 首屏默认展示 20 条
- 用户继续滚动整个侧边栏时，推荐区底部进入视口后自动加载下一页
- 推荐区本身不变成独立滚动容器

## Goals

- 把推荐区首屏默认数量提升到 20 条。
- 为 `skills.recommend` 增加稳定的分页能力。
- 在推荐区底部进入当前侧边栏滚动视口时，自动加载下一页。
- 保持当前侧边栏“单滚动容器”的交互，不引入推荐区内部二次滚动。
- 在推荐结果刷新后重置分页，避免旧结果和新结果混杂。
- 复用仓库内现有分页与触底加载模式，尽量减少新交互语义。

## Non-Goals

- 这次不改 `Discover` 搜索结果的分页模型。
- 这次不改推荐算法本身，不调整 query seed、权重或排序规则。
- 这次不为推荐结果引入游标型分页。
- 这次不把推荐区改成独立滚动列表。
- 这次不新增“手动加载更多”按钮作为主路径。
- 这次不尝试缓存跨页推荐快照或做服务端增量推荐计算。

## Current Context

### Existing Recommend API

服务端命令注册位于：

- [`packages/server/src/commands/skills/query.ts`](../../../packages/server/src/commands/skills/query.ts)

当前 `skills.recommend` 的特点：

- 请求参数只包含 `workspaceId` 和可选 `limit`
- `limit` 上限被限制为 10
- 返回值是 `SkillRecommendationEntry[]`
- 调用 `inspectWorkspaceIntelligence()` 生成工作区摘要
- 再调用 `buildSkillRecommendations()` 生成推荐列表

### Existing Recommendation Builder

推荐构建逻辑位于：

- [`packages/server/src/skills/recommendation.ts`](../../../packages/server/src/skills/recommendation.ts)

当前行为：

- 基于 workspace intelligence 构建若干 query seed
- 并行调用 skills hub 搜索
- 合并多组 query 的结果并累积分数
- 过滤已安装 skill
- 按 `score -> displayName -> slug` 排序
- 最后做一次 `slice(0, limit)`

这意味着推荐列表本质上已经先形成一个完整排序结果，再截断返回。因此它天然更适合使用 `offset + limit` 切片，而不是强行引入 cursor。

### Existing Frontend Recommendations Flow

前端推荐区的主要逻辑位于：

- [`packages/web/src/features/workspace/actions/use-skills-panel.ts`](../../../packages/web/src/features/workspace/actions/use-skills-panel.ts)
- [`packages/web/src/features/workspace/views/shared/skills-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/skills-panel.tsx)

当前行为：

- `refreshRecommendations()` 调用 `skills.recommend`
- 返回值直接写入 `recommendations` state
- 视图层对 `recommendations` 做本地排序后整块渲染
- 没有 `hasMore`
- 没有分页 loading 状态
- 没有触底加载逻辑

### Existing Scroll Root

当前侧边栏内容区的滚动容器不是推荐区本身，而是整个侧边栏 body：

- [`packages/web/src/styles/components.css`](../../../packages/web/src/styles/components.css)

关键规则：

- `.workspace-sidebar-panel__content > .workspace-sidebar-view > .workspace-sidebar-panel__body { overflow-y: auto; }`

这意味着推荐区要实现触底加载，observer 的 `root` 应该绑定到侧边栏 body，而不是推荐区列表本身。

### Existing Infinite Scroll Pattern

仓库里已经有稳定的“滚动到底部自动加载下一页”模式：

- [`packages/web/src/features/workspace/views/shared/git-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/git-panel.tsx)
- [`packages/web/src/features/workspace/actions/use-git-actions.ts`](../../../packages/web/src/features/workspace/actions/use-git-actions.ts)

该模式使用：

- `IntersectionObserver`
- 底部 sentinel 元素
- `hasMore` 状态
- 单独的分页 loading 状态
- 请求并发保护

推荐区应复用这一思路，而不是新造另一套触底加载模型。

## User Decisions Captured

- 推荐区默认首屏展示 20 条。
- “加载更多”必须是真分页，而不是前端一次性拿全量后再逐步展开。
- 触发下一页的动作来自滚动整个侧边栏，不是推荐区内部滚动。
- 推荐区不新增独立滚动容器。
- 实现方案采用 `offset + limit`，不采用 cursor 分页。

## Approaches Considered

### Option A: Offset + Limit Pagination（推荐）

核心思路：

- 服务端每次按当前逻辑生成完整有序推荐列表
- 返回前按 `offset + limit` 切片
- 同时返回 `hasMore`
- 前端首屏请求 `offset=0, limit=20`
- 后续页用 `offset=recommendations.length, limit=20`

优点：

- 最贴近当前实现
- 服务端改动边界清晰
- 易于复用现有前端 infinite scroll 模式
- 不需要保存复杂的推荐游标状态

缺点：

- 每次翻页都要重新构建完整推荐列表
- 推荐结果如果在刷新期间发生变化，前端需要做去重保护

### Option B: Cursor Pagination

核心思路：

- 服务端在第一页返回分页 cursor
- 前端用 cursor 请求下一页

优点：

- 接口语义更像传统分页 API

缺点：

- 当前推荐结果并没有天然 cursor 来源
- 仍然需要先构建完整推荐列表再导出 cursor
- 复杂度高于收益
- 不符合当前推荐源的真实数据形态

## Final Choice

采用 Option A。

本次把 `skills.recommend` 改成基于 `offset + limit` 的分页接口，并让前端推荐区在现有侧边栏滚动容器里通过底部 sentinel 自动加载下一页。

## API Design

### Request Shape

`skills.recommend` 请求参数调整为：

- `workspaceId: string`
- `limit?: number`
- `offset?: number`

规则：

- `limit` 默认值为 `20`
- `limit` 上限调整为 `20`
- `offset` 默认值为 `0`
- `offset` 最小值为 `0`

这里把上限直接收敛到 20，是为了和当前明确确认的 UI 分页粒度保持一致，避免本次改动引入未使用的更大页尺寸。

### Response Shape

`skills.recommend` 返回值从：

- `SkillRecommendationEntry[]`

改为：

- `{ entries: SkillRecommendationEntry[]; hasMore: boolean }`

`hasMore` 的含义与 `git.log` 保持一致：

- 当前页后仍有更多推荐结果时为 `true`
- 当前页已经到达末尾时为 `false`

### Server Pagination Rules

服务端分页规则：

1. 先按当前逻辑生成完整排序后的推荐列表。
2. 用 `offset` 和 `limit` 对完整列表做切片。
3. `hasMore = offset + entries.length < totalEntries`

这保证：

- 排序稳定
- 不会因为前端分页导致跨页顺序变化
- 分页语义可以和当前推荐算法解耦

## Server Design

### Command Layer

修改：

- [`packages/server/src/commands/skills/query.ts`](../../../packages/server/src/commands/skills/query.ts)

变更内容：

- 放宽 `skills.recommend` 参数 schema，支持 `offset`
- `limit` 默认值改为 20，最大值改为 20
- 返回值改为分页对象，而不是数组

### Recommendation Builder

修改：

- [`packages/server/src/skills/recommendation.ts`](../../../packages/server/src/skills/recommendation.ts)

建议把当前“生成完整推荐列表”和“应用分页切片”显式分层：

- 保留现有推荐构建和排序逻辑
- 新增分页包装逻辑，负责 `offset/limit` 和 `hasMore`

目标不是重写推荐算法，而是把当前隐式的 `slice(0, limit)` 提升成显式分页输出。

### Shared Domain Types

修改：

- [`packages/core/src/domain/skill-management.ts`](../../../packages/core/src/domain/skill-management.ts)

新增稳定的分页返回类型，例如：

- `SkillRecommendationPage`

它至少包含：

- `entries: SkillRecommendationEntry[]`
- `hasMore: boolean`

这样前后端、UI preview 和测试都能共享同一个返回契约。

## Frontend Design

### State Model

修改：

- [`packages/web/src/features/workspace/actions/use-skills-panel.ts`](../../../packages/web/src/features/workspace/actions/use-skills-panel.ts)

推荐状态从“单数组”扩展为分页状态：

- `recommendations`
- `recommendationsHasMore`
- `loadingRecommendations`
- `loadingRecommendationPage`

并增加一个分页请求锁，防止 observer 连续触发造成重复请求。

### Data Flow

前端需要两个清晰动作：

1. `refreshRecommendations()`

行为：

- 清空当前推荐分页状态
- 请求第一页：`offset=0, limit=20`
- 替换 `recommendations`
- 更新 `recommendationsHasMore`

2. `loadMoreRecommendations()`

行为：

- 如果首屏仍在加载、正在翻页、`hasMore=false`、推荐区折叠，则直接返回
- 请求下一页：`offset=recommendations.length, limit=20`
- 结果按 `slug` 去重后追加到列表末尾
- 更新 `recommendationsHasMore`

这里必须做 `slug` 去重，因为服务端每次翻页都会重新计算完整推荐集。如果在刷新、安装或外部状态变化的边界时推荐结果略有漂移，前端仍应避免重复卡片。

### Refresh Triggers

以下场景统一触发“重置并加载第一页”：

- 面板初次加载
- `refreshToken` 变化
- skill 安装成功
- skill 卸载成功
- skill 更新成功

目标是保证推荐区始终反映当前 skill 安装状态和工作区分析结果，而不是在旧分页基础上继续叠加新结果。

### View Integration

修改：

- [`packages/web/src/features/workspace/views/shared/skills-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/skills-panel.tsx)

视图层变更：

- 推荐区底部新增 sentinel 元素
- 当推荐区展开、`hasMore=true`、浏览器支持 `IntersectionObserver` 时，注册 observer
- observer 的 `root` 指向当前侧边栏滚动容器 `.workspace-sidebar-panel__body`
- sentinel 进入视口后触发 `loadMoreRecommendations()`

### Loading UX

推荐区加载态分成两种：

1. 首屏加载

- 沿用当前整块推荐区的 loading 文案

2. 后续分页加载

- 不覆盖已加载卡片
- 只在推荐列表底部显示一条轻量 loading 行
- sentinel 保持在列表尾部

这样能避免用户滚动到一半时，整个推荐区闪回到首屏 loading 状态。

## Interaction Design

### Default Behavior

- 用户打开 `Skills` 面板
- 推荐区首屏加载 20 条
- 用户继续滚动整个侧边栏
- 当推荐区底部进入当前侧边栏滚动视口时，自动加载下一页 20 条

### Collapsed State

- 推荐区折叠时不注册 observer
- 折叠期间不触发分页请求
- 重新展开后保留已加载的推荐结果和 `hasMore` 状态

这保证折叠动作只影响可见性，不意外重置用户已加载的内容。

### Empty State

- 第一页返回空结果时，继续显示现有“无推荐”文案
- 后续页如果返回空列表，只更新 `hasMore=false`，不显示额外空态

### Failure State

- 第一页请求失败：保持现有错误提示语义
- 后续页请求失败：不清空当前已加载推荐，只停止本次追加并保留现有列表

这样失败不会破坏用户已经看到的推荐内容。

## Edge Cases

### Recommendation Set Changes Between Pages

由于服务端每次翻页都会重新计算完整推荐集，理论上可能出现：

- 某个 skill 在第一页请求后被安装
- 工作区状态变化导致推荐排序略变

本次设计的处理方式是：

- 显式刷新场景一律重置分页
- 非刷新场景下，前端追加时按 `slug` 去重

本次不尝试跨请求锁定服务端推荐快照，因为这会引入额外状态管理，而当前需求不需要。

### Observer Availability

如果浏览器环境没有 `IntersectionObserver`：

- 推荐区仍正常显示第一页 20 条
- 不启用自动加载下一页

本次不为这一降级路径补做新的按钮型交互，因为当前运行环境以现代浏览器为主，且仓库已有多个 observer 依赖点。

### Duplicate Fetch Prevention

触底 observer 在快速滚动时可能多次触发，因此前端必须使用单独的分页请求锁，保证：

- 同一时间最多只有一个“下一页”请求在飞行
- 首屏加载和分页加载不会并发执行

## Testing

### Server Tests

修改或新增：

- [`packages/server/src/__tests__/skills/commands.test.ts`](../../../packages/server/src/__tests__/skills/commands.test.ts)
- [`packages/core/src/domain/skill-management.test.ts`](../../../packages/core/src/domain/skill-management.test.ts)

至少覆盖：

- `skills.recommend` 默认返回分页对象
- 默认分页大小为 20
- `offset + limit` 切片正确
- `hasMore` 在中间页和末页上的行为正确

### Frontend Action Tests

修改或新增：

- [`packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`](../../../packages/web/src/features/workspace/views/shared/skills-panel.test.tsx)
- [`packages/web/src/features/workspace/actions/use-skills-panel.ts`](../../../packages/web/src/features/workspace/actions/use-skills-panel.ts)

至少覆盖：

- 首屏请求会发送 `limit=20, offset=0`
- 触发分页时会发送下一页 `offset`
- 分页结果会追加而不是覆盖
- 重复 slug 会被去重
- `refreshToken` 或安装成功后会重置并重新从第一页开始

### View Tests

至少覆盖：

- 推荐区展开且 `hasMore=true` 时注册 observer
- sentinel 进入视口会触发 `loadMoreRecommendations()`
- 推荐区折叠时不触发分页
- 分页 loading 只显示在列表底部，不覆盖已有结果

## Files Expected To Change

- [`packages/core/src/domain/skill-management.ts`](../../../packages/core/src/domain/skill-management.ts)
- [`packages/core/src/domain/skill-management.test.ts`](../../../packages/core/src/domain/skill-management.test.ts)
- [`packages/server/src/commands/skills/query.ts`](../../../packages/server/src/commands/skills/query.ts)
- [`packages/server/src/skills/recommendation.ts`](../../../packages/server/src/skills/recommendation.ts)
- [`packages/server/src/__tests__/skills/commands.test.ts`](../../../packages/server/src/__tests__/skills/commands.test.ts)
- [`packages/web/src/features/workspace/actions/use-skills-panel.ts`](../../../packages/web/src/features/workspace/actions/use-skills-panel.ts)
- [`packages/web/src/features/workspace/views/shared/skills-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/skills-panel.tsx)
- [`packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`](../../../packages/web/src/features/workspace/views/shared/skills-panel.test.tsx)
- [`packages/web/src/ui-preview/preview-store.ts`](../../../packages/web/src/ui-preview/preview-store.ts)

## Verification Strategy

实现阶段至少需要运行：

- `pnpm --filter @coder-studio/core test -- skill-management`
- `pnpm --filter @coder-studio/server test -- skills`
- `pnpm --filter @coder-studio/web test -- skills-panel`

如果包级命令与仓库当前脚本组织不完全匹配，则应回退到仓库实际可用的等价测试命令，但验证范围必须覆盖：

- 共享类型
- 服务端推荐分页
- 前端推荐分页与触底加载
