# Skill Library Management — Design

Date: 2026-05-27
Status: Draft
Owner: spencer

## Problem

当前产品已经能管理 workspace、provider、LSP 工具和系统依赖，但还没有一条正式的 skill 管理链路：

- 没有统一的公共 skill 库
- 没有把一个 skill 挂到多个 agent 指定目录的能力
- 没有为 built-in provider 与 custom provider 统一管理 skill 目录
- 没有在工作区右侧侧栏中提供 skill 搜索、安装、挂载和修复入口

用户目标不是“把某个 skill 安装进某个固定 agent 目录”，而是：

- 对接 `skills-hub` 做在线搜索、详情查看与安装
- 先把 skill 安装到产品维护的公共目录
- 再把同一个 skill 挂载到不同 agent 的 skill 目录
- built-in agent 与 custom agent 都能单独配置 skill 目录
- 产品层对用户暴露的是“挂载”语义，而不是要求用户理解 `symlink`、复制或同步实现差异

仓库当前已经有几块可复用能力，但都不能直接解决这个问题：

- 右侧工作区侧栏目前只有 `文件 / 搜索 / Git`
  - [`packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx`](../../../packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx)
  - [`packages/web/src/features/workspace/atoms/layout.ts`](../../../packages/web/src/features/workspace/atoms/layout.ts)
- provider 安装、LSP 安装、系统依赖安装都已经验证了 “manager + structured job + command polling” 模式
  - [`packages/server/src/provider-runtime/install-manager.ts`](../../../packages/server/src/provider-runtime/install-manager.ts)
  - [`packages/server/src/lsp-tools/install-manager.ts`](../../../packages/server/src/lsp-tools/install-manager.ts)
  - [`packages/server/src/system-deps/install-manager.ts`](../../../packages/server/src/system-deps/install-manager.ts)
- built-in provider 与 custom provider 已经都在同一条 provider registry 中暴露给前端
  - [`packages/server/src/commands/provider.ts`](../../../packages/server/src/commands/provider.ts)
  - [`packages/server/src/commands/custom-provider.ts`](../../../packages/server/src/commands/custom-provider.ts)

因此缺口不是“少一个按钮”，而是缺少一个新的 `skills` 领域：它要同时管理远程来源、本地公共库、agent target 配置、挂载关系、健康检查和右侧面板交互。

## Goals

- 在桌面 workspace 右侧活动栏新增 `Skills` 面板，与 `文件 / 搜索 / Git` 同级。
- 引入应用级全局唯一的公共 skill 库，作为 skill 的唯一事实源。
- 对接 `skills-hub` 官方 CLI，支持搜索、详情查看、安装和卸载。
- 支持 built-in provider 与 custom provider 配置各自的 skill 目录。
- 支持把公共库中的 skill 显式挂载到一个或多个 agent 目录。
- 产品层暴露统一的“挂载”语义；底层默认优先 `symlink`，失败时允许退回 `copy/sync`。
- 提供结构化安装 job、挂载状态、健康检查和修复动作。

## Non-Goals

- v1 不做 workspace 级隔离；公共库和挂载配置都是应用级全局唯一。
- v1 不做 skill bundle、org/team 安装流或复杂权限模型。
- v1 不做多版本并存；同一 `slug` 在公共库中只保留一个当前版本。
- v1 不把 skill 管理合并进 provider 设置页或 diagnostics 页。
- v1 不尝试从 agent 原生目录反向推断全部状态；公共库索引和挂载关系表才是正式状态源。
- v1 不做后台自动更新所有 skill。

## User Decisions Captured

- 入口在工作区右侧活动栏，同级于 `文件 / 搜索 / Git`。
- 默认视角是“全局技能库”，不是“按 agent 进入”。
- 公共 skill 库是应用级全局唯一，不按 workspace 分片。
- built-in provider 与 custom provider 都需要支持自定义 skill 目录。
- 产品内直接提供 `skills-hub` 搜索、详情和安装，不是半托管模式。
- 用户面对的是“挂载”语义；底层优先 `symlink`，失败可降级为复制/同步。
- 本地自定义 skill 与已有 skill 未来可以纳入同一套管理，但 v1 以 `skills-hub + 公共库 + 挂载` 为主路径。

## Approaches Considered

### Option A: 中心公共库 + agent 挂载投影（推荐）

核心思路：

- 产品维护一个公共 skill 库，作为唯一事实源。
- `skills-hub` 负责远程搜索和内容获取。
- 每个 agent 只保存自己的 `skillDir` 配置和挂载关系。
- 挂载层负责把公共库中的 skill 投影到 agent 目录。

优点：

- 符合产品目标：一个 skill 可以被多个 agent 共用。
- built-in 与 custom provider 可以用统一模型管理。
- 容易做健康检查、批量重挂载、异常修复和后续权限治理。
- 不依赖某个 agent 的目录成为“主目录”。

缺点：

- 需要新增公共库索引、target 配置、挂载关系和 manager。
- 服务端职责比“直接跑官方 CLI”更重。

### Option B: 选择某个 agent 目录充当公共库

核心思路：

- 让某个 agent 的官方 skills 目录兼任公共库。
- 其他 agent 从这个目录做同步或链接。

优点：

- 初看实现较短。

缺点：

- 架构上把“公共库”绑死到某个 provider 的私有格式。
- custom provider 很难获得干净的一致体验。
- 后续修复和健康检查会混入 provider 特有约束。

### Option C: 让官方 CLI 输出位置成为事实源，我们只做扫描

核心思路：

- 仍以 `skills-hub` 默认安装位置为正式来源。
- 产品只做扫描、展示和辅助同步。

优点：

- 产品实现最轻。

缺点：

- 不满足“安装到公共目录再管理”的目标。
- 状态会依赖外部工具目录，越来越难解释和修复。
- 无法稳定支持 custom agent 目录。

## Final Choice

采用 Option A。

产品引入独立的 `skills` 领域：

- 公共库是唯一事实源
- `skills-hub` 负责发现与获取内容
- `agent targets` 负责记录每个 provider 的 `skillDir`
- `mount relations` 负责记录公共库 skill 如何投影到 agent 目录
- 右侧 `Skills` 面板承担搜索、安装、挂载、修复和 target 配置入口

## Scope

### Included In v1

- 桌面工作区右侧活动栏新增 `Skills` 入口
- `skills-hub` 搜索、详情、安装、卸载
- 公共 skill 库与本地索引
- built-in + custom provider 的 `skillDir` 配置
- 单 skill 对多个 agent 的挂载/卸载
- 结构化安装 job、挂载状态、健康检查和修复
- `Agent Targets` 抽屉

### Excluded From v1

- workspace 级隔离
- 多版本并存与版本回滚
- 本地目录自动 watch/import
- skill bundle/org/team 管理
- 自动全量更新
- 移动端完整 `Skills` 管理体验

## Current Product Constraints

### Workspace Sidebar Today

桌面侧栏当前仅支持三种 `DesktopSidebarView`：

- `explorer`
- `search`
- `source-control`

参考：

- [`packages/web/src/features/workspace/atoms/layout.ts`](../../../packages/web/src/features/workspace/atoms/layout.ts)
- [`packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`](../../../packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx)

这意味着 skill 管理如果要进入右侧活动栏，需要扩展：

- `DesktopSidebarView` 枚举与默认 sanitize 逻辑
- `WorkspaceActivityBar` 的按钮集
- 桌面 workspace 主场景里的侧栏面板切换分支

### Provider Registry Already Unifies Built-in and Custom

前端和服务端已经能在同一条 provider registry 中看到 built-in 和 custom provider：

- [`packages/server/src/commands/provider.ts`](../../../packages/server/src/commands/provider.ts)
- [`packages/server/src/provider-runtime/custom-provider.ts`](../../../packages/server/src/provider-runtime/custom-provider.ts)
- [`packages/server/src/storage/repositories/custom-provider-repo.ts`](../../../packages/server/src/storage/repositories/custom-provider-repo.ts)

这为 `Agent Targets` 提供了天然入口：不需要为 custom provider 另起一套 target 机制。

### Existing Installer Pattern Is Worth Reusing

仓库已有三类安装器，已经验证了以下模式可用：

- 单资源单活动 job
- `start/get` 命令语义
- 结构化 `steps` / `failure`
- 前端轮询 job 状态

参考：

- [`packages/server/src/provider-runtime/install-manager.ts`](../../../packages/server/src/provider-runtime/install-manager.ts)
- [`packages/server/src/lsp-tools/install-manager.ts`](../../../packages/server/src/lsp-tools/install-manager.ts)
- [`packages/server/src/system-deps/install-manager.ts`](../../../packages/server/src/system-deps/install-manager.ts)

skill 安装与挂载应该沿用这套模式，而不是直接把 CLI 输出裸传给前端。

### skills-hub CLI Constraint

已确认的官方 CLI 能力边界：

- `search <query>`
- `info <slug> --json`
- `install [slug] --target <target>`
- `sync [framework] --output <dir>`
- `list`
- `uninstall <slug>`

目前没有“直接安装到任意公共目录”的 `install --output` 能力。

因此产品不能把公共库设计成“官方 CLI 直接写入的目标目录”；必须由服务端做二次编排，用 staging/export 的方式把 skill 收敛进产品自己的公共库。

## Final UX

### 1. Activity Bar Entry

右侧活动栏新增 `Skills` 按钮，和 `文件 / 搜索 / Git` 同级。

建议状态：

- 默认图标
- 有失败/待修复 skill 时显示告警点
- 当前 view 为 `skills` 时保持与其他活动栏按钮一致的 active 样式

### 2. Skills Panel Layout

`Skills` 面板默认是“全局技能库”视角，自上而下分为四块：

1. 顶部工具栏
   - 搜索框：同时支持远程搜索和本地库过滤
   - 筛选：`全部 / 已安装 / 未挂载 / 有异常`
   - `Agent Targets` 入口
2. 主列表
   - 每条 skill 卡片显示：`name`、`slug`、`version`、`source`、摘要、状态
   - 状态：`未安装`、`已入公共库`、`部分挂载`、`全部挂载`、`异常`
3. 详情区或展开详情
   - 远程详情、本地安装状态、挂载摘要、最近错误
   - 主操作：`安装`、`更新`、`管理挂载`、`修复`、`卸载`
4. `Agent Targets` 抽屉
   - 列出所有 built-in + custom provider
   - 展示 `skillDir`、挂载数量、健康状态和目录修改入口

### 3. Primary Interaction Flows

#### Search and Install

- 用户输入搜索词
- 面板展示远程结果
- 若本地已安装，卡片直接显示本地状态摘要
- 用户点击 `安装`
- 前端轮询安装 job
- 成功后卡片切换到 “已入公共库”

#### Manage Mounts

- 用户在已安装 skill 上点击 `管理挂载`
- 详情区列出所有 agent
- 对每个 agent 展示：
  - `已挂载`
  - `未挂载`
  - `未配置 skillDir`
  - `挂载异常`
- 用户可以逐个执行 `挂载 / 卸载 / 修复 / 配置目录`

#### Edit Agent Target

- 用户进入 `Agent Targets`
- 修改某个 provider 的 `skillDir`
- 若该 provider 当前已有挂载，弹出确认：
  - `仅保存目录`
  - `保存并重挂载全部`
- 推荐默认是 `保存并重挂载全部`

#### Repair Drift

- 当健康扫描发现 source/target 漂移或损坏时，面板显示结构化异常
- 每种异常都要给明确动作：
  - `重新创建目录并挂载`
  - `重建挂载`
  - `更换目录`
  - `从公共库重新安装`

## Architecture

### 1. Public Skill Library

引入应用级全局唯一的公共库，建议位于 state root 下：

- `state/skills/library/`

v1 每个 `slug` 只保留一个当前版本，目录建议为：

- `state/skills/library/<slug>/`

该目录下存放规范化后的 skill 内容与 metadata。

公共库是唯一事实源。agent 原生目录只是投影结果，不是源目录。

### 2. Agent Target Registry

单独维护 `providerId -> skillDir` 映射，不塞进 built-in provider 配置，也不只放进 custom provider 记录中。

原因：

- built-in provider 也需要配置目录
- custom provider 需要和 built-in 共享同一套 target 管理 UI
- `skillDir` 属于“skill target 配置”，不是 provider 启动命令本体的一部分

### 3. Mount Relation Store

单独维护公共库和 agent target 之间的关系表。

它负责回答：

- 哪个 provider 使用了哪个 skill
- 当前采用的是 `symlink` 还是 `copy`
- target 路径是否健康
- 最近一次同步或修复是否成功

### 4. Skills Hub Client Wrapper

服务端新增 `skills-hub` 客户端封装，统一处理：

- CLI 可用性检查
- 搜索与详情查询
- staging 安装
- 输出解析
- 失败分类

这样前端和高层 manager 不需要知道底层 CLI 细节。

### 5. Separate Managers

建议新增三类 manager：

- `SkillInstallManager`
  - 负责远程安装 job、staging、公共库写入
- `SkillMountManager`
  - 负责单个/批量挂载、卸载、重挂载
- `SkillHealthManager`
  - 负责健康扫描、漂移识别和修复计划

这三类职责不要揉成一个“大 manager”，否则 install/mount/repair 状态会耦合得很快失控。

## Domain Model

新增共享类型，建议放在 `packages/core/src/domain/skill-management.ts`。

### Skill Library Entry

```ts
export interface SkillLibraryEntry {
  slug: string;
  displayName: string;
  description?: string;
  version: string;
  source: "skillhub" | "local";
  libraryPath: string;
  installState: "installed" | "installing" | "failed";
  installedAt: number;
  updatedAt: number;
  lastError?: string;
}
```

### Agent Skill Target

```ts
export interface AgentSkillTargetEntry {
  providerId: string;
  displayName: string;
  kind: "built_in" | "preset" | "custom";
  skillDir?: string;
  mountPreference: "auto";
  lastHealthState: "healthy" | "warning" | "error" | "unconfigured";
  lastHealthError?: string;
}
```

### Skill Mount Relation

```ts
export interface SkillMountRelation {
  providerId: string;
  skillSlug: string;
  enabled: boolean;
  sourcePath: string;
  targetPath: string;
  mountModeResolved: "symlink" | "copy";
  status: "mounted" | "stale" | "missing_target" | "missing_source" | "failed";
  lastSyncedAt?: number;
  lastError?: string;
}
```

### Skill Install Job

```ts
export interface SkillInstallJobSnapshot {
  jobId: string;
  slug: string;
  version?: string;
  status: "queued" | "running" | "succeeded" | "failed";
  currentStepId?: string;
  steps: SkillInstallStepSnapshot[];
  failure?: SkillInstallFailure;
}
```

结构风格直接参考现有 provider/LSP/system-deps installer。

## Persistence

建议新增三个 file-backed repository：

- `skill-library-repo.ts`
  - 存公共库索引
- `skill-target-repo.ts`
  - 存 `providerId -> skillDir`
- `skill-mount-repo.ts`
  - 存挂载关系

建议路径：

- `state/skills/library-index.json`
- `state/skills/targets.json`
- `state/skills/mounts.json`

这样和现有 `settings repo`、`custom provider repo` 的存储风格保持一致。

## Install Flow

### Why Install Needs Staging

`skills-hub install` 目前只支持 `--target <framework>`，不支持直接写入产品公共库。

因此 v1 采用：

1. 服务端创建 staging 目录
2. `SkillInstallManager` 调用官方 CLI，把 skill 安装到受支持 target 对应的 staging 目录
3. 服务端从 staging 目录中解析并抽取受管 skill 内容
4. 服务端校验 staging 结果中是否存在合法 skill 内容
5. 原子替换公共库中的 `<slug>` 目录
6. 更新 `skill-library-repo`

v1 的实现前提是：选择一个 `skills-hub` 已支持的 target 作为 staging 格式来源，但 staging 目录本身必须由产品创建和销毁；公共库仍然只由产品写入，而不是直接暴露给官方 CLI 作为正式安装目标。

### Install State Policy

安装只负责“把 skill 放进公共库”，不默认自动挂到所有 agent。

推荐默认行为：

- 安装成功后仅更新公共库
- 若该 skill 之前已有启用中的挂载关系，则允许在成功后提示用户 `重新同步到已启用 agent`

这样能避免“装一个 skill 导致多个 agent 目录被静默修改”。

## Mount Flow

挂载由 `SkillMountManager` 独立负责：

1. 读取目标 provider 的 `skillDir`
2. 确保目录存在且可写
3. 计算 target path：`<skillDir>/<slug>`
4. 优先尝试 `symlink`
5. 若因平台、权限或文件系统约束失败，则退回 `copy/sync`
6. 更新 `skill-mount-repo`
7. 立即执行该 relation 的健康检查

产品层对用户始终显示“已挂载”；若发生降级，则在细节状态中标出 `已降级复制`。

## Unmount and Uninstall

### Unmount

- 只影响某个 `providerId + skillSlug` relation
- 删除 target path
- 保留公共库 skill
- relation 更新为 disabled 或删除

### Uninstall From Public Library

默认不允许在仍有启用挂载时直接卸载公共库 skill。

前端提供两个动作：

- `先卸载所有 agent 后删除`
- `强制删除并清理失效挂载`

推荐默认行为是前者。

## Health Model

健康检查至少覆盖三层：

### Library Health

- 公共库目录是否存在
- metadata 是否齐全
- skill 内容是否仍可读

### Target Health

- `skillDir` 是否存在
- 目录是否可写
- provider 是否仍在 registry 中

### Mount Health

- target path 是否存在
- 若为 `symlink`，是否仍指向当前 source path
- 若为 `copy`，是否与 source 的版本/mtime 不一致

前端状态统一收敛为：

- `已挂载`
- `已降级复制`
- `目标缺失`
- `源已丢失`
- `需要重挂载`
- `未配置目录`

## Error Handling and Repair

### Install Failure

- 不污染正式公共库索引
- staging 目录清理
- job 状态标记为 `failed`
- UI 提供 `重试安装`

### Mount Failure

- 不影响公共库中该 skill 的 `installed` 状态
- relation 标记为 `failed`
- 若属于可预期 `symlink` 失败，自动尝试降级

### External Drift

用户可能手动修改了 agent skill 目录。v1 不自动覆盖漂移结果，而是：

- 将 relation 标为 `stale`
- 提供 `以公共库为准重建`

### Path Safety

用户可配置 `skillDir`，因此所有文件操作都必须保守：

- 仅允许操作明确记录过的 target path
- 卸载/修复时先校验 relation 与真实路径匹配
- 不允许对未受管路径执行递归删除
- 写路径统一走安全 resolve 逻辑，避免路径穿越

## Command Surface

建议新增 `skills.*` 命令族：

- `skills.search`
- `skills.info`
- `skills.library.list`
- `skills.install.start`
- `skills.install.get`
- `skills.mount`
- `skills.unmount`
- `skills.uninstall`
- `skills.targets.list`
- `skills.targets.update`
- `skills.health.scan`
- `skills.repair`

命令语义遵循现有 server command 风格：

- 查询与动作分离
- 长任务使用 `start/get`
- 失败返回结构化 code/message/details

## UI Composition

建议新增：

- `packages/web/src/features/workspace/views/shared/skills-panel.tsx`
- `packages/web/src/features/workspace/views/shared/agent-skill-targets-drawer.tsx`
- `packages/web/src/features/workspace/actions/use-skills-panel.ts`
- `packages/web/src/features/workspace/atoms/skills.ts`

桌面主场景需要修改：

- `DesktopSidebarView` 增加 `skills`
- `WorkspaceActivityBar` 增加技能图标按钮
- `WorkspaceDesktopView` 增加 `SkillsPanel` 渲染分支

服务端建议新增：

- `packages/server/src/skills/skills-hub-client.ts`
- `packages/server/src/skills/install-manager.ts`
- `packages/server/src/skills/mount-manager.ts`
- `packages/server/src/skills/health-manager.ts`
- `packages/server/src/commands/skills.ts`
- `packages/server/src/storage/repositories/skill-library-repo.ts`
- `packages/server/src/storage/repositories/skill-target-repo.ts`
- `packages/server/src/storage/repositories/skill-mount-repo.ts`

core 建议新增：

- `packages/core/src/domain/skill-management.ts`

## Testing Strategy

### Core / Server

- repository 读写与 schema 归一化测试
- install manager 的 job 生命周期与失败分类测试
- mount manager 的 `symlink -> copy` 降级测试
- health manager 的漂移识别与修复计划测试
- command dispatch wiring 测试

### Web

- 活动栏新增 `Skills` 按钮的切换测试
- `SkillsPanel` 搜索、安装、挂载、错误态测试
- `Agent Targets` 抽屉配置目录与重挂载确认测试
- 本地状态与轮询状态联动测试

### End-to-End

- 搜索 skill -> 安装到公共库 -> 挂载到 built-in agent
- 搜索 skill -> 安装到公共库 -> 挂载到 custom agent
- 修改 `skillDir` -> 触发 `remount all`
- 模拟 target 漂移 -> 在面板中修复

## Rollout Notes

v1 建议先在桌面端落地，不阻塞移动端。移动端可以先不暴露 `Skills` 面板入口，或仅展示只读摘要。

这套设计是一个新的独立领域，不建议把它硬塞进 provider settings 或 diagnostics。最合理的落点仍然是 workspace 右侧活动栏，因为它和 `文件 / 搜索 / Git` 一样，都是“和当前工作区协作但不属于 agent 会话本身”的工具面板。
