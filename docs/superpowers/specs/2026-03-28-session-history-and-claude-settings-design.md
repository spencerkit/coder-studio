# Session History And Claude Settings Design

> Status: Approved in chat
> Date: 2026-03-28
> Scope: `apps/web` + `apps/server`
> Related: `docs/PRD.md`, `docs/superpowers/specs/2026-03-26-persistent-workspace-runtime-design.md`

## 背景

当前产品已经具备一部分“归档”底层能力，但仍停留在半成品状态：

- 关闭非草稿 pane 时，`session` 实际上已经会被后端归档。
- `workspace_sessions` 已经通过 `archived_at` 区分活跃与归档记录。
- 前端已有只读 archive 视图状态，但没有正式入口、恢复动作、删除动作和统一历史中心。
- 当前 `archive_session -> agent_stop` 会把已归档会话进一步写成 `Interrupted`，这和“正常关闭/归档”语义冲突。

同时，设置系统也存在明显短板：

- 设置真相源仍是前端 `localStorage`，不支持多端同步。
- 当前设置里的 `Launch Command` 只覆盖 Claude 启动命令，无法表达完整的 Claude 配置。
- Claude 相关配置目前只自动维护 `.claude/settings.local.json` 的 hooks，不足以覆盖用户实际会调整的常用项。

本设计把这两件事一起收口：

1. 把“关闭即归档”升级为完整的 session/workspace 历史中心与恢复链路。
2. 把设置系统迁到后端，并重构为以 Claude 配置为核心的设置模型。

## 目标

1. 提供一个低频但随手可达的全局历史入口，能按 workspace 组织所有 session 记录。
2. 明确“关闭 session/workspace”就是“归档”，并补齐恢复、聚焦、删除等完整行为。
3. 支持在“新建/分屏”时直接从当前 workspace 历史中恢复 session，并决定恢复到哪个 pane 位置。
4. 将应用设置改为后端持久化的全局真相源，支持多端刷新后收敛。
5. 移除旧 `Launch Command` 入口，改为完整 Claude 设置中心。
6. Claude 设置既要有结构化表单，也要允许用户编辑更底层的 `settings.json` / `~/.claude.json` 常用项。

## 非目标

本期不做以下内容：

- 历史记录搜索、筛选、批量删除、批量恢复。
- 跨 workspace 把历史 session 恢复到当前 split pane。
- 复活已经退出的 OS 进程；恢复只保证恢复同一 session identity，并重建 PTY / Claude 上下文。
- 其他客户端在设置变更后的实时推送；本期仅保证保存立即生效，其他端刷新或重连后收敛。
- 多账号、多租户或每用户独立设置空间。

## 已确认的产品规则

1. 关闭 `session` 等价于归档该 `session`。
2. 关闭 `workspace` 等价于归档该 `workspace` 下全部 `session`。
3. 历史记录不是新页面，而是低频使用的“后悔药”入口。
4. 历史入口位于 workspace 标签列表最左侧，点击后从左侧弹出抽屉。
5. 历史按 workspace 分组，但记录粒度是“一个 session 一条记录”，不是按归档动作记日志。
6. 历史里展示所有 session，而不是只展示归档会话。
7. 历史项点击行为：
   - 活跃会话：切换到对应 workspace，并 focus 到该 session 所在 pane。
   - 已归档会话：恢复同一个 session identity，并重新建立 PTY；若存在 `claude_session_id`，优先尝试续到同一个 Claude 会话。
   - 目标 workspace 当前未打开：先自动打开 workspace，再执行聚焦或恢复。
8. 历史项支持硬删除。删除后不保留任何记录，也无法恢复。
9. 如果删除的是某个打开中的 workspace 的最后一个 session，workspace 本身保留，并自动补一个新的 draft pane。
10. 新建 / 分屏时可以在 draft pane 里选择“新建会话”或“从历史恢复”。
11. “从历史恢复”只允许使用当前 workspace 的历史 session，不允许跨 workspace。
12. 在 split 恢复列表里，不展示已经 live 且已经挂载在当前 pane tree 中的 session。
13. Claude 设置要尽可能完整。
14. Claude 设置既包含 CLI 启动参数，也包含常用 `settings.json` / `~/.claude.json` 配置。
15. 所有设置都存到后端。
16. 用户可以自己决定是否为 `Native` / `WSL` 使用覆盖配置。

## 总体方案

### 1. 历史中心

新增一个“全局 session 历史抽屉”：

- 入口固定在 workspace tabs 最左侧，不随 workspace 关闭而消失。
- 抽屉从左侧滑出，覆盖 workspace 主内容左缘，但不跳路由。
- 抽屉采用“固定头部 + 可滚动内容区”结构，长列表时只滚动内容区，不压缩头部、分组头或 session 行。
- 抽屉按 workspace 分组展示 session 记录，组内按最近活动时间倒序。
- workspace 分组使用 accordion 结构，而不是一组独立圆角卡片。
- 默认仅展开当前 workspace；其他 workspace 默认收起，用户可手动展开。
- 空 workspace 分组不显示。
- 每条记录至少展示：
  - 标题
  - 状态标签
  - 最近活动时间
  - 所属 workspace 名称
  - 恢复 / 聚焦语义
  - 删除动作

### 2. 关闭、归档、恢复语义

现有产品里“关闭”已经被理解为归档，本设计明确它的技术语义：

- 归档态的唯一事实来源是 `workspace_sessions.archived_at != null`。
- `status = suspended` 只作为归档后的显示态，不表示异常。
- 归档过程中停止 agent / shell runtime 时，不允许再把已归档 session 写成 `Interrupted`。
- `Interrupted` 只保留给异常中断、崩溃、外部 kill、attach 失败等非正常结束。

恢复时：

1. 清除 `archived_at`。
2. 保留原始 `session_id`、标题、消息、stream、`claude_session_id`、未读数和最后活动时间。
3. 将 session 放回当前 workspace 的 pane layout 中并 focus。
4. 为该 session 重建 PTY。
5. 若已有 `claude_session_id`，尝试用 Claude 的 resume 语义继续；否则按冷启动会话处理。

### 3. 新建 / 分屏恢复

当前分屏会先生成一个 draft pane。本设计保留该主流程，只增强 draft pane 内容：

- 默认 tab 为“新建会话”。
- 旁边新增“从历史恢复”tab。
- “从历史恢复”tab 只展示当前 workspace 可恢复 session。
- 可恢复 session 的判断：
  - 不在当前 pane tree 中挂载。
  - 不是隐藏 draft placeholder。
  - 历史状态允许恢复，如 archived / interrupted / detached。
- 用户选中历史 session 后，当前 draft pane 直接被该 session 替换，不额外产生新 session。

## 信息架构

### 历史抽屉结构

1. 抽屉头部
   - 标题：`History`
   - 当前说明：该抽屉展示所有 session 记录，关闭只是归档
   - 关闭按钮
   - 固定在抽屉顶部，不随长列表滚动

2. Workspace 分组
   - 分组头就是 accordion header
   - 展开箭头
   - workspace 名称
   - 路径或 target 摘要
   - 该组 session 数量
   - 当前状态摘要（如当前 workspace / all archived）
   - 分组头固定行高，不因内容多少被压缩
   - 分组内容展开后直接渲染 session 列表，不额外包一层营销式圆角卡片
   - 默认展开规则：
     - 当前 workspace：展开
     - 其他 workspace：收起
   - 允许同时展开多个分组，但初始态只展开当前 workspace，避免长列表进入时被全部撑开

3. Session 记录行
   - 扁平行式结构，不使用独立悬浮卡片
   - 标题
   - 最近活动时间
   - 状态标签
   - 次要说明：归档 / 活跃 / 中断
   - 主点击区：聚焦或恢复
   - 行尾危险动作：删除
   - 行与行之间通过细分隔线分开，而不是额外卡片容器

4. 长列表行为
   - 抽屉整体高度固定在 viewport 可用高度内
   - 只有内容区滚动
   - accordion header 保持可见和可点击
   - 不允许通过压缩行高或把分组整体缩成小卡片来适配长列表

### 设置导航结构

设置页改为至少三个一级面板：

1. `General`
   - 语言
   - 完成通知
   - 终端兼容模式
   - 默认 idle policy

2. `Claude`
   - 基础配置
   - 高级配置

3. `Appearance`
   - 维持现有深色主题说明，暂不扩展主题体系

`Claude` 面板内部再拆成结构化 section：

1. Launch & Auth
2. Model & Behavior
3. Permissions
4. Sandbox
5. Hooks & Automation
6. Worktree
7. Plugins & MCP
8. Global Preferences
9. Advanced JSON

## 后端设计

### 1. 会话历史模型

`workspace_sessions` 已经具备支撑“一条 session 记录贯穿活跃与归档”的基础能力，本期不再额外引入 archive log 表作为新真相源。

保留现有表结构方向：

- 一条 `workspace_sessions` 行代表一个 session identity。
- `archived_at` 表示当前是否归档。
- payload 中保存 session 快照。

新增或收敛的不是物理表，而是逻辑 DTO：

`SessionHistoryRecord`

- `workspace_id`
- `workspace_title`
- `workspace_path`
- `session_id`
- `title`
- `status`
- `archived`
- `mounted`
- `recoverable`
- `last_active_at`
- `archived_at`
- `claude_session_id`

历史抽屉读取该 DTO，而不是直接消费当前 `archive` 视图。

### 2. 归档命令

新增或调整以下后端命令：

1. `archive_session`
   - 现有命令保留，但改为“先写归档态，再停止 runtime，且停止 runtime 不允许覆盖为 interrupted”
2. `archive_workspace_sessions`
   - 对 workspace 下所有 live session 批量归档
3. `list_session_history`
   - 返回所有 workspace 分组后的 session history DTO
4. `restore_session`
   - 恢复指定 session
5. `delete_session`
   - 硬删除指定 session 及其关联数据

### 3. 恢复命令

`restore_session` 的约束：

- 入参必须带 `workspace_id` 和 `session_id`。
- 允许从历史抽屉恢复，也允许从当前 workspace draft pane 恢复。
- 如果该 session 已经活跃并挂载，命令返回“already_active”，前端走聚焦逻辑，不重复启动。
- 如果 workspace 当前未打开，前端先调用打开 / 激活 workspace，再调用恢复。

### 4. 删除命令

`delete_session` 是硬删除，必须清理：

- `workspace_sessions` 记录
- session stream / transcript 持久化
- Claude lifecycle 历史
- 任何 session 级 runtime attach 索引
- 历史中心可见性

删除后不保留 tombstone，也不支持撤销。

### 5. 关闭 workspace

`close_workspace` 语义调整为：

1. 归档该 workspace 下全部 session。
2. 释放 controller。
3. 关闭 workspace 级 terminal。
4. 停止 watch。
5. 从当前 UI open tabs 中移除 workspace。

注意：关闭 workspace 不是删除 workspace 记录，历史抽屉仍需要能按该 workspace 分组显示其 session 历史。

### 6. 设置存储模型

新增后端全局设置模型，例如 `app_settings` 单例表或等价存储：

- 单机单用户作用域
- 后端作为唯一真相源
- 首次读取时由后端给默认值
- 启动时把旧 localStorage 配置迁移到后端一次

建议数据结构：

```json
{
  "general": {
    "locale": "zh",
    "terminalCompatibilityMode": "standard",
    "completionNotifications": {
      "enabled": true,
      "onlyWhenBackground": true
    },
    "idlePolicy": {
      "enabled": true,
      "idleMinutes": 10,
      "maxActive": 3,
      "pressure": true
    }
  },
  "claude": {
    "global": {
      "executable": "claude",
      "startupArgs": [],
      "env": {},
      "settingsJson": {},
      "globalConfigJson": {}
    },
    "overrides": {
      "native": null,
      "wsl": null
    }
  }
}
```

`overrides.native` / `overrides.wsl` 只有在用户显式启用时才生效，否则继承 `global`。

说明：

- `general.idlePolicy` 表示新建 workspace 的默认 idle policy 与全局回填值，不直接覆盖已经存在的 workspace 级 idle policy。
- 历史抽屉数据不应塞进 `workbench_bootstrap` 常驻载荷，建议用单独的按需接口 `list_session_history` 拉取，避免 bootstrap 长期膨胀。

## Claude 设置范围

本设计的 Claude 设置表单需要覆盖“高频可理解项”，并把剩余配置交给高级 JSON 编辑器。下面列出的字段是基于 Claude 官方文档整理出的“首版优先结构化的常见项示例”，不是要在 spec 阶段冻结全部上游 schema；实现前应再次按当时官方文档做一次字段校验。

### 1. Launch & Auth

结构化字段至少包括：

- Claude 可执行文件路径
- 启动参数数组
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_CUSTOM_HEADERS`
- `apiKeyHelper`
- 额外环境变量

### 2. Model & Behavior

优先结构化官方常见配置中的模型与行为项，例如：

- `model`
- `permissionMode`
- `effort`
- `includeGitInstructions`
- `cleanupPeriodDays`
- `fallback model` 类能力
- `language` / locale related behavior
- 其他在实现时仍由官方文档确认存在的常用行为开关

### 3. Permissions

- `permissions.allow`
- `permissions.ask`
- `permissions.deny`
- `additionalDirectories`
- `defaultMode`
- `disableBypassPermissionsMode`
- 对应 CLI flag：
  - `--allowedTools`
  - `--disallowedTools`
  - `--tools`
  - `--dangerously-skip-permissions`
  - `--allow-dangerously-skip-permissions`

### 4. Sandbox

官方常见 sandbox 配置示例：

- `sandbox.enabled`
- `sandbox.failIfUnavailable`
- `sandbox.autoAllowBashIfSandboxed`
- `sandbox.excludedCommands`
- `sandbox.allowUnsandboxedCommands`
- `sandbox.filesystem.*`
- `sandbox.network.*`

### 5. Hooks & Automation

官方 hooks / automation 常见配置示例：

- `hooks`
- `disableAllHooks`
- `allowedHttpHookUrls`
- `httpHookAllowedEnvVars`
- `disableDeepLinkRegistration`
- system prompt related settings / flags
- init / maintenance related flags

### 6. Worktree

- `worktree.symlinkDirectories`
- `worktree.sparsePaths`
- `--add-dir`

### 7. Plugins & MCP

官方插件与 MCP 常见配置示例：

- `enabledPlugins`
- `extraKnownMarketplaces`
- `plugin-dir`
- `mcp-config`
- `strict-mcp-config`
- `setting-sources`

### 8. Global Preferences

当前文档和可见偏好字段里的常见 `~/.claude.json` 类偏好示例：

- `autoConnectIde`
- `autoInstallIdeExtension`
- `editorMode`
- `showTurnDuration`
- `terminalProgressBarEnabled`

### 9. Advanced JSON

保留两个高级编辑器：

1. `settings.json advanced`
2. `~/.claude.json advanced`

原则：

- 结构化表单覆盖高频项。
- 高级编辑器显示合成后的 JSON 草稿。
- 若用户只改高级编辑器，不强制要求结构化表单认识全部字段。
- 保存前做 JSON 校验和 schema 级基础校验。

## 前端设计

### 1. Workspace 顶部

- 在 workspace tabs 最左侧插入历史 icon。
- icon 作为全局入口，不绑定某个具体 workspace。
- 打开抽屉后，不切走当前 workspace，仅叠加抽屉。

### 2. 历史抽屉行为

- 首次打开时按需拉取历史快照。
- 后续对 archive / restore / delete / activate 行为做本地收敛更新。
- 点击历史行的主区域，根据状态决定“聚焦”还是“恢复”。
- 删除动作要求二次确认。
- 抽屉内容采用分组 accordion：
  - 点击 workspace header 切换展开 / 收起
  - 当前 workspace 默认展开
  - 其他 workspace 默认收起
- 长列表时抽屉主体内部滚动，workspace header 和 session row 保持稳定高度，不做压缩布局。
- 视觉风格以“抽屉壳体 + 扁平分组列表”为主，不再采用一组独立圆角卡片叠放的设计语言。

### 3. Draft Pane 恢复选择器

- 只在 draft pane 显示。
- 两个主 tab：
  - `新建会话`
  - `从历史恢复`
- 恢复列表为空时显示当前 workspace 无可恢复历史的空状态。

### 4. Settings 页面

- `Claude` 成为一级导航项。
- 删除旧 `Launch Command` UI 与其可用性检测逻辑。
- 结构化表单和高级 JSON 分层呈现：
  - 上半区：常用字段
  - 下半区：高级 JSON
- `Native` / `WSL` override 使用显式开关控制，关闭时界面展示“继承全局”。

## 数据同步与迁移

### 1. 历史数据

不需要重建 archive 数据；已有 `workspace_sessions.archived_at` 可以直接作为历史基础。

需要的迁移与修复：

- 修正 archive 时的状态写入顺序，避免已归档 session 被 stop 流程改写为 `Interrupted`。
- 历史接口默认过滤隐藏 draft placeholder。

### 2. 设置迁移

首次读取后端设置时：

1. 若后端为空，写入默认值。
2. 若前端 localStorage 中存在旧设置，则做一次迁移：
   - `agentCommand` -> `claude.global.executable` 或启动参数草稿
   - 现有通知、idle policy、terminal compatibility、locale -> 后端
3. 迁移完成后，前端停止把 localStorage 当真相源。

## 错误处理

1. 恢复失败
   - session 记录保留
   - 显示错误 toast
   - 保持在历史中可再次尝试

2. 删除失败
   - 不从 UI 乐观移除
   - 返回原始错误

3. Claude 设置保存失败
   - 结构化表单与高级编辑器都保留草稿
   - 明确标出失败字段或 JSON 校验错误

4. 目标环境缺少 Claude 可执行文件
   - 在 Claude 面板里给出运行时校验状态
   - 该校验按 `global` / `Native override` / `WSL override` 分别展示

## 测试策略

### 后端

- `archive_session` 不再把已归档 session 写成 `Interrupted`
- `archive_workspace_sessions` 覆盖多 session
- `restore_session` 覆盖 archived / active / missing 三种分支
- `delete_session` 覆盖最后一个 session、已归档 session、活跃 session
- settings CRUD 与 target override merge 规则

### 前端

- 历史 icon 与抽屉显隐
- 历史列表分组与排序
- 活跃 session 点击聚焦
- 归档 session 点击恢复
- draft pane 从当前 workspace 历史恢复
- 删除最后一个 session 后自动补 draft pane
- Claude 设置的结构化字段、override 开关、高级 JSON 校验

### 集成

- 关闭 session -> 历史出现 -> 恢复 -> 重新 attach Claude
- 关闭 workspace -> 所有 session 进入历史 -> 再次打开其中一条
- A 端改设置，B 端刷新后可见

## 风险与约束

1. 归档/恢复会显著拉高 session 生命周期复杂度，必须明确 archive、interrupted、mounted 三个维度是不同概念。
2. 关闭 workspace 当前会直接 stop agents / terminals；实现时需要先 archive 再 stop，避免丢失历史语义。
3. Claude 配置字段很多，结构化表单不能追求 100% 全覆盖，否则首版会失控；必须坚持“高频结构化 + 高级 JSON 补齐”。
4. 当前环境没有 Stitch MCP，因此本次只产出 Stitch-ready 设计系统和 prompt，不直接生成 screen 文件。

## 外部参考

Claude 官方文档用于 Claude 配置项选型：

- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/env-vars
- https://code.claude.com/docs/en/model-config
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/hooks
