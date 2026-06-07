# Settings

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 设置页导航和分区。
- Provider 设置、配置文件读写、命令预览。
- 外观、快捷键、监控设置、关于。

不覆盖：
- Provider runtime 实际执行。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| `/settings` | Both | 设置页入口。 |
| Settings navigation | Both | 切换设置分区或子页。 |
| Provider Settings | Both | 编辑 provider 配置。 |
| Monitoring Settings | Both | 配置监控相关选项。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| SETTINGS-001 | 设置页渲染 | Implemented | `packages/web/src/features/settings/components/settings-page.tsx` | `settings-page.test.tsx` |
| SETTINGS-002 | 设置页导航 | Implemented | `settings-navigation.ts` | `settings-navigation.test.ts` |
| SETTINGS-003 | settings.get/update | Implemented | `packages/server/src/commands/settings.ts` | `packages/server/src/commands/settings.test.ts` |
| SETTINGS-004 | 读取/写入配置文件 | Implemented | `settings.readConfigFile`、`settings.writeConfigFile`、`config-editor.tsx` | `config-editor.test.tsx` |
| SETTINGS-005 | 命令预览 | Implemented | `settings.previewCommand` | `packages/server/src/commands/settings.test.ts` |
| SETTINGS-006 | Provider settings UI | Implemented | `provider-settings.tsx` | `provider-settings.test.tsx` |
| SETTINGS-007 | Shortcuts settings UI | Implemented | `shortcuts-settings.tsx` | `shortcuts-settings.test.tsx` |
| SETTINGS-008 | Monitoring settings UI | Implemented | `monitoring-settings-card.tsx`、`monitoring-settings-subpage.tsx` | `monitoring-settings-subpage.test.tsx` |
| SETTINGS-009 | About settings | Implemented | `about-settings.tsx` | `about-settings.test.tsx` |
| SETTINGS-010 | Session gate dispatch | Internal | `use-session-gate-dispatch.ts` | 设置页手工验收 |

## 4. 模块级验收线索

- 进入设置页后能切换主要设置分区。
- 修改设置后刷新应保留持久化结果。
- 配置文件编辑失败时应展示错误。

## 5. 功能点规格

### SETTINGS-001 设置页渲染

状态：`Implemented`

用户行为：
- 用户进入 `/settings`，在桌面或移动端查看设置页面。

系统响应：
- 设置页加载 server settings、provider 列表、runtime 状态、监控数据和更新状态等上下文。
- 根据当前 section 渲染 General、Providers、Appearance、Shortcuts、Monitoring、Analysis、Diagnostics、About。
- 移动端使用同一 section 定义，但布局适配移动视口。

状态与边界：
- Loading：设置数据未准备好时部分控件使用默认值或禁用态。
- Session gate：部分 dispatch 遇到 `activation_required` 会导航到 `/session-gate`。
- Section fallback：未知 section 应回落到默认 section。

验收标准：
- Given 用户访问 `/settings`
- When settings 数据加载完成
- Then 页面显示设置导航
- And 默认 section 可渲染对应内容

代码索引：
- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/settings/components/settings-sections.tsx`

### SETTINGS-002 设置页导航

状态：`Implemented`

用户行为：
- 用户点击设置导航中的分区或通过 URL 进入某个分区。

系统响应：
- `SETTINGS_SECTIONS` 定义所有分区 id、i18n label 和 icon semantic。
- navigation 工具解析和生成设置路径。
- 页面根据 section id 切换内容。

状态与边界：
- Sections：当前分区包括 `general`、`providers`、`appearance`、`shortcuts`、`monitoring`、`analysis`、`diagnostics`、`about`。
- Mobile：移动端 section 集合与桌面相同。
- Unknown：未知 id 不应导致页面崩溃。

验收标准：
- Given 用户在 Settings 页面
- When 点击 Providers 分区
- Then URL 和内容切换到 providers
- And Provider Settings 被渲染

代码索引：
- `packages/web/src/features/settings/components/settings-sections.tsx`
- `packages/web/src/features/settings/components/settings-navigation.ts`
- `packages/web/src/features/settings/components/settings-page.tsx`

### SETTINGS-003 settings.get/update

状态：`Implemented`

用户行为：
- 用户修改设置项，例如默认 provider、通知、外观、LSP、更新、监控、Supervisor 或 provider 配置。

系统响应：
- `settings.get` 从 settings repo 读取非 provider 设置，并从 provider config repo 合并 provider 配置。
- provider config 会按 provider schema sanitize，非法配置回退到默认值。
- Supervisor 设置通过 resolver 归一化默认值和范围。
- `settings.update` 校验 schema、flatten 非 provider 设置、合并 provider config，并写入 repo。
- 更新 updates 或 monitoring 设置时触发对应服务 reload。

状态与边界：
- Provider keys：`settings.get` 不直接暴露原始 `providers.*` settingsRepo 条目，而是来自 providerConfigRepo。
- Unknown provider：更新未知 provider 配置返回 `unknown_provider`。
- Personalization snapshot：完整 personalization snapshot 中缺失的 override 字段会删除旧 override key。
- Validation：数值范围由 zod schema 和 core validator 限制。

验收标准：
- Given settings 中已配置 monitoring.enabled 为 false
- When 调用 `settings.update` 设置 monitoring.enabled 为 true
- Then settings repo 写入该值
- And monitoring service reload 被触发

代码索引：
- `packages/server/src/commands/settings.ts`
- `packages/server/src/storage/settings-repo.ts`

### SETTINGS-004 读取/写入配置文件

状态：`Implemented`

用户行为：
- 用户在 Provider Settings 中打开 Claude 或 Codex 配置文件编辑器，编辑内容、格式化、保存或重置。

系统响应：
- `settings.readConfigFile` 读取 `codex` 或 `claude` 配置文件，返回 configPath、content、exists。
- 编辑器显示文件路径、存在状态、Monaco 编辑区和保存状态。
- Claude 配置支持 JSON 格式化；Codex TOML 格式化当前不实现。
- `settings.writeConfigFile` 写入内容，并在可能时返回 backupPath。
- 保存成功后 toast 展示成功，带 backup 信息；失败后展示错误状态和 error toast。

状态与边界：
- File missing：文件不存在时显示空态提示，但仍允许编辑保存。
- Dirty：content 与 originalContent 不同即为 dirty，启用保存和重置。
- Saving：保存中禁用重复保存。
- Load error：读取失败且没有 configPath 时只显示错误卡片。

验收标准：
- Given Claude 配置文件存在
- When 用户修改内容并点击保存
- Then 前端调用 `settings.writeConfigFile`
- And 保存成功后 dirty 状态清除
- And 如果有 backupPath，toast 中展示备份路径

代码索引：
- `packages/server/src/commands/settings.ts`
- `packages/server/src/config/config-io.ts`
- `packages/web/src/features/settings/components/config-editor.tsx`

### SETTINGS-005 命令预览

状态：`Implemented`

用户行为：
- 用户在 Provider Settings 中编辑 provider 启动参数并查看命令预览。

系统响应：
- 前端调用 `settings.previewCommand`，传入 providerId、临时 config 和可选 workspacePath。
- 服务端将临时 config 与默认/现有 provider config 合并，通过 provider `buildCommand` 生成 argv、cwd、env 和 preview 字符串。
- UI 展示 preview 字符串。

状态与边界：
- Unknown provider：providerId 不存在时返回 `unknown_provider`。
- Workspace fallback：workspacePath 未传时使用当前进程 cwd。
- Preview failure：前端展示 `Error loading preview`。

验收标准：
- Given 用户在 Codex 启动参数输入 `--model gpt-5`
- When preview 请求完成
- Then UI 展示包含该参数的启动命令预览

代码索引：
- `packages/server/src/commands/settings.ts`
- `packages/web/src/features/settings/components/provider-settings.tsx`

### SETTINGS-006 Provider settings UI

状态：`Implemented`

用户行为：
- 用户在 Providers 分区查看 provider 概览、能力、runtime 状态、启动参数和配置文件入口。

系统响应：
- Provider tabs 来自 provider 列表。
- provider badge、capability、stability 和 supported capabilities 作为摘要展示。
- runtime 状态可用时显示 success，不可用时显示 warning、手工说明、文档和诊断入口。
- 启动参数保存到 provider config。
- Claude/Codex 允许切换到 config file 子视图。

状态与边界：
- Runtime loading：runtime 未返回时不展示状态块。
- Mobile：移动端使用单独入口进入 config file 编辑器，再返回 base。
- Unsupported config：非 Claude/Codex provider 不显示 config file 入口。

验收标准：
- Given Provider Settings 打开并选中不可用的 Claude
- When runtime status 返回 missing CLI
- Then 页面显示 warning
- And 用户可以跳转诊断页

代码索引：
- `packages/web/src/features/settings/components/provider-settings.tsx`

### SETTINGS-007 Shortcuts settings UI

状态：`Implemented`

用户行为：
- 用户查看快捷键分类、点击某个快捷键进入录制、按键设置自定义绑定，或重置单个/全部快捷键。

系统响应：
- UI 按 global、workspace、editor、terminal 分类展示默认快捷键。
- 进入编辑后输入框捕获 keydown，生成 binding 字符串。
- 保存自定义 binding 到 `customShortcutsAtom`，并调用 `settings.update` 写入 `shortcuts.<id>`。
- Escape 取消录制。
- 重置单个快捷键写入 null；重置全部写入空 shortcuts 对象。

状态与边界：
- Platform：Mac 上 Meta 映射为 Mod，非 Mac 上 Ctrl 映射为 Mod。
- Arrow：Ctrl+Arrow 会保留 Ctrl。
- UI state：失焦退出编辑态。

验收标准：
- Given 用户打开 Shortcuts 的 editor 分类
- When 点击某个快捷键并按 `Mod+Shift+P`
- Then 该快捷键显示新绑定
- And 前端调用 `settings.update`

代码索引：
- `packages/web/src/features/settings/components/shortcuts-settings.tsx`
- `packages/web/src/lib/shortcuts.ts`

### SETTINGS-008 Monitoring settings UI

状态：`Implemented`

用户行为：
- 用户在 Monitoring 分区启用/关闭监控，调整监控设置，并查看主机和 runtime 指标。

系统响应：
- Monitoring subpage 渲染 hero、状态卡、设置卡、KPI 和 MonitoringDashboard。
- 启用开关调用 `onChange` 更新 settings。
- 设置卡可刷新监控数据并切换 time window。
- 如果 optimistic settings 已启用但最新监控 response 仍是 disabled，页面用空 response 合成等待态。

状态与边界：
- Disabled：监控关闭时显示 disabled 摘要和空 KPI。
- Degraded/error：telemetry degraded 或 error 时状态显示 attention。
- Not ready：monitoring settings 未 ready 时开关禁用。
- Mobile：subpage 根据 viewport 添加移动/桌面 class。

验收标准：
- Given monitoring settings ready 且 enabled 为 false
- When 用户打开开关
- Then onChange 收到 enabled 为 true 的 settings
- And 页面状态进入 enabled 或 waiting 展示

代码索引：
- `packages/web/src/features/settings/components/monitoring-settings-subpage.tsx`
- `packages/web/src/features/settings/components/monitoring-settings-card.tsx`
- `packages/server/src/commands/settings.ts`

### SETTINGS-009 About settings

状态：`Implemented`

用户行为：
- 用户查看版本、server instance、安装支持、更新状态，并手动检查或安装更新。

系统响应：
- About 展示产品名、当前版本、serverInstanceId、安装支持状态、最新版本、上次检查时间、可用性和更新状态。
- 用户可开关自动检查，并选择更新检查间隔。
- 手动检查调用 `updates.check`。
- 准备安装调用 `updates.prepareInstall`；如果存在 active work，显示确认框。
- 安装调用 `updates.startInstall`，可传 force。

状态与边界：
- Unsupported：不支持安装时展示 unsupported reason。
- Manual required：更新状态为 manual_required 时显示 manual command。
- Failure：检查或安装失败时推送 error toast。
- Confirmation：有 active work 时必须确认后才 force install。

验收标准：
- Given updateState 表示有新版本且支持安装
- When 用户点击更新并 prepareInstall 返回 active work
- Then About 显示确认对话框
- When 用户确认
- Then 前端调用 `updates.startInstall` 且 force 为 true

代码索引：
- `packages/web/src/features/settings/components/about-settings.tsx`

### SETTINGS-010 外观和终端偏好

状态：`Implemented`

用户行为：
- 用户在 Appearance 或 General 中切换主题、语言、LSP runtime mode、终端 renderer、复制选择、终端字号，以及背景/玻璃个性化设置。

系统响应：
- 主题切换立即更新 document `data-theme`，并保存 `appearance.themeId`。
- 语言写入 `appearance.locale`。
- LSP mode 写入 `lsp.mode`。
- 终端 renderer/copy/font size 写入 `appearance` 对应字段。
- 背景图片上传后保存 assetId；删除时先删除 asset，再清空 personalization 字段。
- personalization 支持 common、desktop override、mobile override。

状态与边界：
- Terminal font：字号必须在 10-18，保存节流。
- Bounded personalization：dimness 0-100，blur 0-40，glass/surface 0-100。
- Override clearing：关闭 desktop/mobile override 时保存空 override。
- Asset failure：上传或删除失败时显示 appearance asset 错误。

验收标准：
- Given 当前桌面终端字号为 13
- When 用户输入 20 并提交
- Then UI 恢复为 13
- And 显示字号范围错误
- When 用户输入 14
- Then 调用 `settings.update` 保存 desktopTerminalFontSize 为 14

代码索引：
- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/server/src/commands/settings.ts`

## 6. 未确认项

- Diagnostics 分区在本模块只记录入口，详细诊断流程放到 Diagnostics 模块展开。
