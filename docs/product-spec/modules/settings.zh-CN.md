# Settings

> 当前代码基线。本文描述当前用户真实可达的设置与二级功能入口，以及其对应的 settings 读写能力。

## 1. 模块范围

覆盖：
- `/more` 页面及其路由归一化。
- `/more/settings/*` 下的嵌入式设置分区。
- `/more/analysis/*` 与 `/more/about/*` 下的二级入口。
- settings 读取、更新、配置文件编辑与命令预览。

不覆盖：
- 独立顶级页面 `/analytics`、`/monitoring`、`/diagnostics` 的完整页面行为。
- provider runtime 的具体执行逻辑。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| 顶栏 `/more` 按钮 | Desktop | 打开 More 页面。 |
| `/more` | Both | More 页面入口。 |
| `/more/settings/*` | Both | 常规设置入口。 |
| `/more/analysis/*` | Both | 工作分析、监控、诊断的嵌入入口。 |
| `/more/about/*` | Both | 产品、更新状态、自动更新入口。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| SETTINGS-001 | More 页面路由解析与归一化 | Implemented | `packages/web/src/features/more/routes.ts`、`packages/web/src/features/more/page.tsx` | `packages/web/src/features/more/page.test.tsx` |
| SETTINGS-002 | 常规设置分区嵌入渲染 | Implemented | `packages/web/src/features/more/page.tsx`、`packages/web/src/features/settings/components/settings-page.tsx` | `packages/web/src/features/more/page.test.tsx` |
| SETTINGS-003 | settings.get / settings.update | Implemented | `packages/server/src/commands/settings.ts` | `packages/server/src/commands/settings.test.ts` |
| SETTINGS-004 | 配置文件读取与写入 | Implemented | `settings.readConfigFile`、`settings.writeConfigFile`、`packages/web/src/features/settings/components/config-editor.tsx` | `packages/web/src/features/settings/components/config-editor.test.tsx` |
| SETTINGS-005 | Provider 启动命令预览 | Implemented | `settings.previewCommand`、`packages/web/src/features/settings/components/provider-settings.tsx` | `packages/server/src/commands/settings.test.ts` |
| SETTINGS-006 | Providers 分区 | Implemented | `packages/web/src/features/settings/components/provider-settings.tsx` | `packages/web/src/features/settings/components/provider-settings.test.tsx` |
| SETTINGS-007 | Terminal 分区 | Implemented | `packages/web/src/features/settings/components/terminal-settings-section.tsx` | `packages/web/src/features/settings/components/settings-page.test.tsx` |
| SETTINGS-008 | Appearance 分区 | Implemented | `packages/web/src/features/settings/components/settings-page.tsx` | `packages/web/src/features/settings/components/settings-page.test.tsx` |
| SETTINGS-009 | Shortcuts 分区 | Implemented | `packages/web/src/features/settings/components/shortcuts-settings.tsx` | `packages/web/src/features/settings/components/shortcuts-settings.test.tsx` |
| SETTINGS-010 | Monitoring 嵌入分区 | Implemented | `packages/web/src/features/settings/components/monitoring-settings-subpage.tsx` | `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx` |
| SETTINGS-011 | Analysis / Diagnostics 嵌入入口 | Implemented | `packages/web/src/features/more/page.tsx`、`packages/web/src/features/work-analysis/page.tsx`、`packages/web/src/features/diagnostics/page.tsx` | `packages/web/src/features/more/page.test.tsx` |
| SETTINGS-012 | About / Update Status / Auto Update 分区 | Implemented | `packages/web/src/features/settings/components/about-settings.tsx` | `packages/web/src/features/settings/components/about-settings.test.tsx` |

## 4. 当前页面事实

- 当前没有顶级 `/settings` 路由；用户真实入口是 `/more`。
- `More` 页面按 3 个 category 组织：
  - `settings`
  - `analysis`
  - `about`
- 当前 `/more/settings/*` 的可见设置分区是：
  - `general`
  - `providers`
  - `terminal`
  - `appearance`
  - `shortcuts`
- `monitoring` 不是设置首页可见分区，而是通过 `/more/analysis/monitoring` 嵌入进入。
- `analytics` 与 `diagnostics` 也通过 `/more/analysis/*` 嵌入显示，同时仍保留独立顶级页面。
- `product`、`update-status`、`auto-update` 通过 `/more/about/*` 嵌入显示。

## 5. 功能点规格

### SETTINGS-001 More 页面路由解析与归一化

状态：`Implemented`

用户行为：
- 用户进入 `/more`、`/more/settings`、`/more/analysis` 或任意子路径。

系统响应：
- 桌面端会把空 category 或空 section 归一化到默认 section。
- 移动端可以停留在 category 列表页，再进入具体 section。
- 非法路径会回退到可解析的合法路径。

状态与边界：
- Desktop fallback：默认落到 `/more/settings/general`。
- Mobile fallback：默认落到 `/more` 或对应 category 首页。
- Invalid section：未知 section 不会导致页面崩溃，而是回退到默认 section。

验收标准：
- Given 用户访问 `/more/settings`
- When 桌面壳层完成路由归一化
- Then URL 应变为 `/more/settings/general`

代码索引：
- `packages/web/src/features/more/routes.ts`
- `packages/web/src/features/more/page.tsx`

### SETTINGS-002 常规设置分区嵌入渲染

状态：`Implemented`

用户行为：
- 用户从 `/more/settings/*` 进入某个设置分区。

系统响应：
- `More` 页面通过 `SettingsPage embeddedSection=...` 渲染分区内容。
- 嵌入模式下保留分区内容，不渲染独立设置页的整页 chrome。

状态与边界：
- Embedded sections：当前只接受 `general`、`providers`、`terminal`、`appearance`、`shortcuts`、`monitoring`。
- Unknown section：未知 section 返回空内容并由路由层回退。
- Workspace mode：嵌入分区会根据当前 workspace / session 状态切换布局模式。

验收标准：
- Given 用户进入 `/more/settings/terminal`
- When 页面渲染完成
- Then 应显示嵌入式终端设置内容
- And 不应要求存在顶级 `/settings` 页面入口

代码索引：
- `packages/web/src/features/more/page.tsx`
- `packages/web/src/features/settings/components/settings-page.tsx`

### SETTINGS-003 settings.get / settings.update

状态：`Implemented`

用户行为：
- 用户修改设置项，例如默认 provider、通知、外观、终端、监控或 Supervisor 相关设置。

系统响应：
- `settings.get` 读取非 provider 设置，并与 provider 配置合并返回。
- `settings.update` 校验并写回设置；更新 monitoring 或 updates 相关设置时会触发对应服务 reload。
- provider 配置按 schema 清洗，未知 provider 更新会返回错误。

状态与边界：
- Validation：数值范围与结构由 schema 校验。
- Unknown provider：返回 `unknown_provider`。
- Personalization snapshot：完整覆盖式更新会清理缺失的 override 字段。

验收标准：
- Given 当前 `monitoring.enabled` 为 `false`
- When 调用 `settings.update` 将其改为 `true`
- Then settings repo 应写入新值
- And monitoring service 应重新加载

代码索引：
- `packages/server/src/commands/settings.ts`
- `packages/server/src/storage/settings-repo.ts`

### SETTINGS-004 配置文件读取与写入

状态：`Implemented`

用户行为：
- 用户在 Providers 分区打开 Claude 或 Codex 配置文件编辑器，读取、修改、保存或重置配置。

系统响应：
- `settings.readConfigFile` 返回配置路径、内容和文件存在状态。
- `settings.writeConfigFile` 保存内容，并在可用时返回备份路径。
- 前端在保存成功或失败后展示对应 toast。

状态与边界：
- File missing：文件不存在时仍允许用户新建并保存。
- Dirty：内容有改动时才允许保存。
- Formatting：Claude 配置支持 JSON 格式化；Codex TOML 当前不提供格式化。

验收标准：
- Given Claude 配置文件存在
- When 用户修改后点击保存
- Then 前端应调用 `settings.writeConfigFile`
- And 保存成功后清除 dirty 状态

代码索引：
- `packages/server/src/commands/settings.ts`
- `packages/server/src/config/config-io.ts`
- `packages/web/src/features/settings/components/config-editor.tsx`

### SETTINGS-005 Provider 启动命令预览

状态：`Implemented`

用户行为：
- 用户在 Providers 分区调整 provider 启动参数并查看命令预览。

系统响应：
- 前端调用 `settings.previewCommand`。
- 服务端按 provider 定义构造 argv、cwd、env 和 preview 字符串。
- UI 展示最终命令预览。

状态与边界：
- Unknown provider：返回 `unknown_provider`。
- Workspace fallback：未传 `workspacePath` 时使用当前进程 `cwd`。
- Preview failure：前端展示错误提示，不写入配置。

验收标准：
- Given 用户为 Codex 输入 `--model gpt-5`
- When preview 请求成功
- Then UI 应展示包含该参数的启动命令

代码索引：
- `packages/server/src/commands/settings.ts`
- `packages/web/src/features/settings/components/provider-settings.tsx`

## 6. 模块级验收线索

- 桌面端访问 `/more` 时应自动归一化到 `/more/settings/general`。
- 移动端访问 `/more` 时应先看到 category 列表，再进入具体 section。
- 当前文档不得把 `/settings` 写成用户真实入口。
