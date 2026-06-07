# Providers

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- provider 列表、runtime status、安装状态。
- Claude、Codex、Gemini、Cursor、OpenCode provider 定义。
- 自定义 provider 管理。

不覆盖：
- Provider 启动后的 session 生命周期。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Settings Providers | Both | 配置 provider 和配置文件。 |
| Draft launcher | Both | 选择 provider 启动 session。 |
| Diagnostics / runtime status | Both | 查看 provider 运行依赖状态。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| PROVIDER-001 | provider 列表 | Implemented | `provider.list`、`packages/providers/src/registry.ts` | `packages/server/src/__tests__/provider-list.test.ts` |
| PROVIDER-002 | provider runtime status | Implemented | `provider.runtimeStatus`、`packages/server/src/provider-runtime/runtime-status.ts` | `packages/server/src/__tests__/provider-runtime/runtime-status.test.ts` |
| PROVIDER-003 | provider 安装状态和启动安装 | Implemented | `provider.install.get`、`provider.install.start` | `packages/server/src/__tests__/provider-runtime/install-manager.test.ts` |
| PROVIDER-004 | Claude provider | Implemented | `packages/providers/src/claude/definition.ts` | `packages/providers/src/claude/definition.test.ts` |
| PROVIDER-005 | Codex provider | Implemented | `packages/providers/src/codex/definition.ts`、`headless.ts` | `packages/providers/src/codex/definition.test.ts` |
| PROVIDER-006 | Gemini provider | Implemented | `packages/providers/src/gemini/definition.ts` | `packages/providers/src/gemini/definition.test.ts` |
| PROVIDER-007 | Cursor provider | Implemented | `packages/providers/src/cursor/definition.ts` | `packages/providers/src/cursor/definition.test.ts` |
| PROVIDER-008 | OpenCode provider | Implemented | `packages/providers/src/opencode/definition.ts` | `packages/providers/src/opencode/definition.test.ts` |
| PROVIDER-009 | 自定义 provider 列表/创建/更新/删除 | Implemented | `packages/server/src/commands/custom-provider.ts` | `packages/server/src/__tests__/custom-provider-command.test.ts` |
| PROVIDER-010 | provider settings UI | Implemented | `packages/web/src/features/settings/components/provider-settings.tsx` | `packages/web/src/features/settings/components/provider-settings.test.tsx` |

## 4. 模块级验收线索

- 设置页应能展示 provider 列表和配置状态。
- Draft launcher 应能使用可用 provider 创建 session。
- 自定义 provider 创建后应在列表中可见。

## 5. 功能点规格

### PROVIDER-001 provider 列表

状态：`Implemented`

用户行为：
- 用户进入需要选择 provider 的入口，例如设置页、session draft launcher 或 agent instructions 生成弹窗。

系统响应：
- 前端通过 `provider.list` 拉取 provider registry。
- 服务端返回每个 provider 的展示名称、类型、稳定性、能力摘要，以及是否支持 agent instructions 生成。
- 内置 provider 和已注册的自定义 provider 都应出现在同一列表中。

状态与边界：
- Success：返回 registry 当前快照。
- Capability：`supportsAgentInstructionsGeneration` 由 provider 定义能力推导，不由 UI 猜测。
- Registry：自定义 provider 创建或删除后，后续列表应反映最新 registry。

验收标准：
- Given provider registry 包含内置 Claude 和一个自定义 provider
- When 前端调用 `provider.list`
- Then 返回列表包含 Claude 和该自定义 provider
- And 每项包含用于 UI 展示的名称和能力信息

代码索引：
- `packages/server/src/commands/provider.ts`
- `packages/providers/src/registry.ts`

### PROVIDER-002 provider runtime status

状态：`Implemented`

用户行为：
- 用户在设置页或诊断入口查看某个 provider 是否可用。

系统响应：
- 前端调用 `provider.runtimeStatus`。
- 服务端基于 provider registry 和 runtime dependencies 生成 provider 状态。
- UI 对可用 provider 展示 ready 状态；对不可用 provider 展示 warning、文档链接、手工安装提示和诊断入口。

状态与边界：
- Available：provider CLI 或运行依赖可用。
- Unavailable：返回手工 guide key、文档 URL 或缺失信息。
- UI：设置页只展示已返回的 runtime 状态，不在前端自行探测 CLI。

验收标准：
- Given Claude CLI 不可用且 runtime status 包含 manual guide
- When 用户打开 Provider Settings 中的 Claude
- Then 设置页显示 warning 状态
- And 用户可以打开诊断页或 provider 文档

代码索引：
- `packages/server/src/commands/provider.ts`
- `packages/server/src/provider-runtime/runtime-status.ts`
- `packages/web/src/features/settings/components/provider-settings.tsx`

### PROVIDER-003 provider 安装状态和启动安装

状态：`Implemented`

用户行为：
- 用户或诊断流程启动 provider 安装，并轮询安装任务。

系统响应：
- `provider.install.start` 创建安装 job 并返回 job snapshot。
- `provider.install.get` 根据 jobId 返回任务状态。
- provider install manager 不存在时返回 `provider_install_unavailable`。
- 查询不存在的 jobId 时返回 `provider_install_job_not_found`。

状态与边界：
- Started：安装 job 已创建，可轮询。
- Succeeded / Failed：由 install manager 维护终态。
- Unavailable：服务端未配置安装管理器时不能启动或查询。

验收标准：
- Given provider install manager 已配置
- When 调用 `provider.install.start` 启动 Claude 安装
- Then 返回包含 jobId 的安装任务
- When 使用该 jobId 调用 `provider.install.get`
- Then 返回同一个任务的当前状态

代码索引：
- `packages/server/src/commands/provider.ts`
- `packages/server/src/provider-runtime/install-manager.ts`

### PROVIDER-009 自定义 provider 列表/创建/更新/删除

状态：`Implemented`

用户行为：
- 用户或内部设置流程管理一个自定义 provider。

系统响应：
- `customProvider.list` 返回已保存的自定义 provider 列表。
- `customProvider.create` 校验 id、名称、命令、参数、env、工作目录模式、会话模式和 capabilities。
- 创建成功后写入 custom provider repo，并更新 provider registry。
- `customProvider.update` 只能更新已存在的自定义 provider。
- `customProvider.delete` 删除配置，并从 provider registry 移除定义。

状态与边界：
- Validation：id 必须匹配 `/^[a-z0-9][a-z0-9-_]*$/`。
- Duplicate：id 与现有 registry 冲突时返回 `custom_provider_exists`。
- Missing：更新或删除不存在的 provider 返回 `custom_provider_not_found`。
- Unavailable：缺少 custom provider repo 或 registry setter 时返回 `custom_provider_unavailable`。

验收标准：
- Given 当前不存在 id 为 `review-bot` 的 provider
- When 创建 `review-bot`
- Then `customProvider.create` 返回 provider list item
- And 后续 `provider.list` 包含 `review-bot`
- When 删除 `review-bot`
- Then 后续 `provider.list` 不再包含 `review-bot`

代码索引：
- `packages/server/src/commands/custom-provider.ts`
- `packages/server/src/provider-runtime/custom-provider.ts`

### PROVIDER-010 provider settings UI

状态：`Implemented`

用户行为：
- 用户在 Settings Providers 中切换 provider、编辑启动参数、查看命令预览，或打开 Claude/Codex 配置文件编辑器。

系统响应：
- Provider tab 根据 `provider.list` 数据渲染。
- 选中 provider 后加载 runtime status，并展示可用状态、文档和诊断入口。
- 启动参数按行解析，空行会被过滤，保存到 `settings.update` 的 `providers.<providerId>.additionalArgs`。
- 命令预览通过 `settings.previewCommand` 生成。
- 仅 Claude 和 Codex 支持配置文件编辑入口。

状态与边界：
- Loading：runtime status 和 command preview 异步加载。
- Preview race：切换 provider 或参数变化时，旧 preview 结果不能覆盖新 provider。
- Mobile：移动端配置文件编辑器通过二级入口打开。
- Unsupported config：非 Claude/Codex provider 不显示 config file 子页。

验收标准：
- Given 用户打开 Settings Providers 并选中 Codex
- When 用户输入两行启动参数
- Then 前端调用 `settings.update` 保存为数组
- And command preview 使用最新参数刷新
- And Codex 配置文件编辑入口可打开

代码索引：
- `packages/web/src/features/settings/components/provider-settings.tsx`
- `packages/server/src/commands/settings.ts`

## 6. 未确认项

- 各 provider 的真实 CLI 可执行验收需要单独环境准备。
