# Skills

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- Skills panel。
- skill 搜索、信息、安装、卸载、修复。
- skill library、targets、mount/unmount、health scan。

不覆盖：
- Agent instructions 对 skill 内容的引用细节。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Skills panel | Desktop | 查看目标 skills、挂载状态、归因信息。 |
| Skills install/management UI | Both | 安装、修复或移除 skill。 |
| Agent 工作区上下文 | Internal | 供 agent instructions 或 provider 使用。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| SKILL-001 | Skills panel 展示 | Implemented | `skills-panel.tsx`、`use-skills-panel.ts` | `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx` |
| SKILL-002 | skills search/info | Implemented | `skills.search`、`skills.info` | `packages/server/src/__tests__/skills-command.test.ts` |
| SKILL-003 | skills library list | Implemented | `skills.library.list` | `packages/server/src/__tests__/skills/commands.test.ts` |
| SKILL-004 | skills install get/start | Implemented | `skills.install.get`、`skills.install.start` | `packages/server/src/__tests__/skills/commands.test.ts` |
| SKILL-005 | skills uninstall/repair | Implemented | `skills.uninstall`、`skills.repair` | `packages/server/src/__tests__/skills/commands.test.ts` |
| SKILL-006 | skills mount/unmount | Implemented | `skills.mount`、`skills.unmount` | `packages/server/src/__tests__/skills/commands.test.ts` |
| SKILL-007 | skills targets list | Implemented | `skills.targets.list` | `packages/server/src/__tests__/skills/target-registry.test.ts` |
| SKILL-008 | skills health scan | Implemented | `skills.health.scan` | `packages/server/src/__tests__/skills/commands.test.ts` |
| SKILL-009 | skill repositories | Internal | `packages/server/src/storage/repositories/skill-*` | `packages/server/src/__tests__/storage/skill-library-repo.test.ts` |

## 4. 模块级验收线索

- Skills panel 能展示当前 workspace 或目标的 skill 摘要。
- 安装或挂载操作后列表应刷新。
- Health scan 应能反馈不可用 skill。

## 5. 功能点规格

### SKILL-001 Skills panel 展示

状态：`Implemented`

用户行为：
- 用户在 workspace sidebar 打开 Skills panel，查看已安装 skill、发现远端 skill，并查看每个 provider 的挂载状态。

系统响应：
- panel 初始化时调用 `skills.library.list` 和 `skills.health.scan`。
- Library 区按 displayName/slug 排序展示已安装 skill。
- Discover 区支持搜索，输入变化后 250ms debounce 调用搜索。
- 每个 skill 行展示 provider target 摘要 token；展开后展示每个 target 的状态、原因、路径和操作。

状态与边界：
- Loading：library 或 search 加载时显示 loading。
- Empty library：没有已安装 skill 时显示空态。
- Empty search：有 query 但无结果时显示无结果状态。
- Error：搜索、扫描、安装、挂载等失败时在 Discover 区显示错误 Notice。

验收标准：
- Given 已安装一个 skill 且 Codex target 已挂载
- When 用户打开 Skills panel
- Then Library 区显示该 skill
- And skill 摘要中 Codex token 显示 mounted 状态

代码索引：
- `packages/web/src/features/workspace/views/shared/skills-panel.tsx`
- `packages/web/src/features/workspace/actions/use-skills-panel.ts`

### SKILL-002 skills search/info

状态：`Implemented`

用户行为：
- 用户在 Discover 区输入关键词搜索 skill，或内部流程查看 skill 详情。

系统响应：
- `skills.search` 要求 query trim 后非空。
- 服务端从 skills hub 搜索远端结果，并合并本地安装状态、已安装版本、已挂载 provider ids。
- `skills.info` 返回远端信息、本地 library entry 和 mount 列表。

状态与边界：
- Unavailable：缺少 skills hub、library repo 或 mount repo 时返回 `skills_unavailable`。
- Remote info fallback：`skills.info` 远端详情请求失败时，仍可用本地 library entry 回退展示。
- Installed ordering：前端搜索结果中已安装项排在未安装项前。

验收标准：
- Given skills hub 搜索返回 `react-tools` 且本地已安装
- When 调用 `skills.search`
- Then 返回项标记 `installed: true`
- And 包含 installedVersion 和 mountedProviderIds

代码索引：
- `packages/server/src/commands/skills.ts`
- `packages/web/src/features/workspace/actions/use-skills-panel.ts`

### SKILL-003 skills library list

状态：`Implemented`

用户行为：
- 用户查看本地已安装 skills。

系统响应：
- `skills.library.list` 读取 skill library repo。
- 服务端合并当前 mount repo 中 enabled mounts。
- 返回每个 skill 的 mountedProviderIds、mountStatus 和 errorCount。

状态与边界：
- Mount status：有 failed/stale mount 时为 `error`。
- Unmounted：没有 enabled mount 时为 `unmounted`。
- Partially mounted：当前代码在 mounts.length 为 1 时返回 `partially_mounted`。
- Fully mounted：多个 enabled mount 且无错误时返回 `fully_mounted`。

验收标准：
- Given skill `a` 有一个 enabled mount 且状态为 `stale`
- When 调用 `skills.library.list`
- Then `a.mountStatus` 为 `error`
- And `a.errorCount` 大于 0

代码索引：
- `packages/server/src/commands/skills.ts`
- `packages/server/src/storage/repositories/skill-library-repo.ts`
- `packages/server/src/storage/repositories/skill-mount-repo.ts`

### SKILL-004 skills install get/start

状态：`Implemented`

用户行为：
- 用户在 Discover 搜索结果中点击安装 skill。

系统响应：
- 前端调用 `skills.install.start`，成功后把 slug 到 jobId 的映射存入 panel state。
- hook 每秒调用 `skills.install.get` 轮询安装任务。
- job 状态为 `succeeded` 或 `failed` 时移除 jobId，并刷新 search、library 和 health。
- 安装中按钮显示 loading，已安装项禁用安装按钮。

状态与边界：
- Unavailable：缺少 skill install manager 时返回 `skill_install_unavailable`。
- Missing job：查询不存在 jobId 返回 `skill_install_job_not_found`。
- Polling：组件卸载或 effect 清理后停止轮询。

验收标准：
- Given Discover 搜索结果包含未安装 skill `x`
- When 用户点击安装
- Then 前端调用 `skills.install.start`
- And 安装按钮进入 loading
- When job 进入 succeeded
- Then panel 刷新 library 和 health

代码索引：
- `packages/server/src/commands/skills.ts`
- `packages/web/src/features/workspace/actions/use-skills-panel.ts`
- `packages/web/src/features/workspace/views/shared/skills-panel.tsx`

### SKILL-005 skills uninstall/repair

状态：`Implemented`

用户行为：
- 用户卸载 skill，或修复一个状态异常的 skill mount。

系统响应：
- `skills.uninstall` 删除 library entry 和 mount 关系；force 为 true 时先尝试 unmount 所有 mounts。
- 如果 skill 仍有 enabled mounts 且 force 未设置，返回 `skill_uninstall_blocked`，details 包含 provider ids。
- `skills.repair` 要求 mount 已存在，重新执行 mount 并扫描健康状态。
- 前端 repair 成功后刷新 search 和 health。

状态与边界：
- Blocked：仍挂载时普通卸载被阻止。
- Missing mount：repair 不存在关系时返回 `skill_mount_not_found`。
- File cleanup：卸载时会尝试删除 libraryPath，失败不会阻断返回。

验收标准：
- Given skill `x` 已挂载到 Codex
- When 调用 `skills.uninstall` 且 force 为 false
- Then 返回 `skill_uninstall_blocked`
- When 对异常 mount 点击 repair
- Then 前端调用 `skills.repair`
- And 成功后 target 状态刷新

代码索引：
- `packages/server/src/commands/skills.ts`
- `packages/web/src/features/workspace/actions/use-skills-panel.ts`

### SKILL-006 skills mount/unmount

状态：`Implemented`

用户行为：
- 用户展开某个 skill，在 provider target 上点击 mount 或 unmount。

系统响应：
- Mount 调用 `skills.mount`，传入 providerId、skillSlug、enabled true。
- 服务端执行 mount 后立即扫描该 relation，并 upsert 扫描结果。
- Unmount 调用 `skills.unmount`，服务端解除 provider 与 skill 的挂载关系。
- 前端操作成功后刷新 search 和 health。

状态与边界：
- Unconfigured：target 没有 skillDir 或 health 为 unconfigured 时 UI 不展示 mount 操作。
- Needs repair：enabled 但 status 不是 mounted 时展示 repair 操作。
- Unavailable：缺少 mount manager、health manager 或 target repo 时返回对应 unavailable 错误。

验收标准：
- Given skill `x` 未挂载到 Claude 且 Claude target 已配置
- When 用户点击 Claude 行的 mount
- Then 前端调用 `skills.mount`
- And 刷新后 Claude token 显示 mounted 状态

代码索引：
- `packages/server/src/commands/skills.ts`
- `packages/web/src/features/workspace/views/shared/skills-panel.tsx`

### SKILL-007 skills targets list

状态：`Implemented`

用户行为：
- 用户查看每个 provider 的 skill target 配置状态和挂载数量。

系统响应：
- `skills.targets.list` 基于 provider registry、provider skillMountDirectories、mount counts 和 target health 构建 target 列表。
- target 包含 providerId、displayName、skillDir、mountedSkillCount、lastHealthState 等信息。

状态与边界：
- Unconfigured：provider 没有 skill mount directory 或健康状态为 unconfigured。
- Counts：mountedSkillCount 来自 mount repo enabled relation 统计。
- Health required：list targets 需要 health manager 和 target repo。

验收标准：
- Given Codex provider 配置了 skill mount directory 且有两个 enabled mounts
- When 调用 `skills.targets.list`
- Then Codex target 返回 mountedSkillCount 为 2

代码索引：
- `packages/server/src/commands/skills.ts`
- `packages/server/src/skills/target-registry.ts`

### SKILL-008 skills health scan

状态：`Implemented`

用户行为：
- 用户点击 Skills panel 的 scan 操作，或 panel 初始化时自动扫描。

系统响应：
- `skills.health.scan` 先 discover 当前 mount repo 中的 mounts。
- 对每个 mount 执行 scan，并把扫描结果 upsert 到 mount repo。
- 返回 targets 和 scanned mounts。
- 前端根据 mounts 构建 mountsBySkillSlug，并刷新 library。

状态与边界：
- Discover：扫描前会同步已发现 relation。
- Per-mount scan：所有 mount 并行扫描。
- Error：命令失败时前端保留错误消息，不覆盖为成功态。

验收标准：
- Given mount repo 中有一个 missing_target relation
- When 用户点击 scan
- Then `skills.health.scan` 返回该 mount 的扫描状态
- And UI 对应 target 显示需要修复或异常原因

代码索引：
- `packages/server/src/commands/skills.ts`
- `packages/web/src/features/workspace/actions/use-skills-panel.ts`

## 6. 未确认项

- 外部 skills hub 网络失败时的 UI 错误态需在第二轮确认。
