# Supervisor 无头模式直切迁移方案（无灰度）

## 目标

将 Supervisor 的 turn-scoped 调用从“复用 `build_start` 交互命令 + stdin 喂 prompt”迁移为“Provider 原生无头命令”，并直接下线旧路径。

- 不做灰度开关
- 不保留交互 one-shot 回退分支
- Claude/Codex 同步切换

## 当前实现（基线）

- Supervisor 在 `handle_supervisor_turn_completed` 中调用 `adapter.build_supervisor_invoke(...)`，随后执行 `run_one_shot_prompt(...)`。
- 目前 `build_supervisor_invoke` 在 Claude/Codex 均直接 `self.build_start(...)`。
- `run_one_shot_prompt` 通过子进程 stdin 写入 prompt，等待 stdout/stderr。

## 目标实现

### 1. Provider 层：为 Supervisor 定义专用无头调用

改造 `ProviderAdapter::build_supervisor_invoke` 语义：必须返回无头模式命令，不再允许复用交互启动命令。

实施点：

1. `apps/server/src/services/claude.rs`
- `build_supervisor_invoke` 改为构造 Claude 无头命令（按你们当前 CLI 能力使用对应参数）。
- 仅保留 Supervisor 所需最小参数，避免继承交互态参数。

2. `apps/server/src/services/codex.rs`
- `build_supervisor_invoke` 改为构造 Codex 无头命令。
- 与 Claude 对齐输入/输出约束。

3. `apps/server/src/services/provider_registry.rs`
- 在 trait 注释与命名语义上明确：`build_supervisor_invoke` 是无头 one-shot 合约。

### 2. Agent Client 层：替换旧 one-shot 执行路径

将 `run_one_shot_prompt` 升级为“无头调用执行器”，并下线旧交互式 one-shot 假设。

实施点：

1. `apps/server/src/services/agent_client.rs`
- 保留统一入口函数（可沿用函数名），但内部逻辑围绕“无头命令”实现。
- 处理输入模式：
  - 若 provider 无头命令需要 stdin：继续写 stdin。
  - 若需要参数传入：由 provider 在 launch spec 中封装完成。
- 强化错误分型：
  - command not found
  - auth failure
  - timeout
  - non-zero exit + stderr

2. 超时控制（必须加）
- 为 Supervisor 调用增加硬超时，避免周期卡死。
- 超时一律记为 cycle failed，沿用现有 `persist_failed_cycle`。

### 3. Supervisor 编排层：收紧输出契约

`apps/server/src/services/supervisor.rs`

- 保持当前状态机与注入逻辑不变。
- 增加回复清洗规则：
  - 去除无关前后缀（如 provider banner）。
  - 空结果仍按 `supervisor_reply_empty` 失败。
- 保证写回 terminal 内容是“仅下一条给业务 agent 的消息”。

### 4. 删除旧路径（直接下线）

下线范围：

1. 删除/改写所有“Supervisor 复用 `build_start`”实现。
2. 删除任何为交互式 one-shot 保留的兼容代码、注释与测试 fixture。
3. 更新 docs，声明 Supervisor 只支持无头调用链路。

## 测试改造清单

### 单元测试

1. `services/supervisor.rs`
- 成功路径：无头返回正常文本 -> injected。
- 失败路径：超时、非零退出、空回复 -> failed/error。

2. `services/claude.rs` / `services/codex.rs`
- `build_supervisor_invoke` 断言无头参数正确。
- 不再等同 `build_start`。

3. `services/agent_client.rs`
- stdin/args 两类输入模式测试。
- timeout 与 stderr 提取测试。

### 集成测试

1. provider hook 触发 `turn_completed` 后：
- 正常生成 cycle、调用无头命令、注入 terminal。

2. terminal 注入保留来源标记：
- `TerminalWriteOrigin::Supervisor` + `# [supervisor]` 前缀不变。

## 落地步骤（建议顺序）

1. 先改 Provider `build_supervisor_invoke` 为无头命令。
2. 再改 `agent_client` 执行器，补 timeout 和错误分型。
3. 最后收敛 `supervisor.rs` 输出清洗与测试。
4. 全量跑 server/web 测试并修复。
5. 更新文档并合并。

## 验收标准

1. 代码中不存在 Supervisor 复用 `build_start` 的实现。
2. 每次 supervisor cycle 仅通过无头命令调用 provider。
3. 失败可观测性不下降（cycle error 与状态流转完整）。
4. 终端注入行为与 UI 展示保持兼容。

## 风险与前置条件

1. 前置：本地 Claude/Codex CLI 的无头模式参数与认证已验证可用。
2. 风险：无头输出格式漂移可能污染注入文本，需要清洗策略。
3. 风险：超时阈值设置不当会导致误失败或阻塞。
