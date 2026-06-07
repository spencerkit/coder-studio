# Agent Instructions

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- workspace agent instructions 读取、生成、写入、健康状态。
- system agent instructions 读取、写入和状态。
- token 趋势展示。

不覆盖：
- Agent session 创建和 provider 运行。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Workspace shared panel | Desktop | Agent instructions section。 |
| Generate dialog | Desktop | 触发生成或重生成。 |
| System agent section | Desktop | 管理系统级 agent instructions。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| INSTR-001 | 读取 workspace agent instructions | Implemented | `agentInstructions.read`、`use-agent-instructions-actions.ts` | `packages/server/src/__tests__/agent-instructions-command.test.ts` |
| INSTR-002 | 写入 workspace agent instructions | Implemented | `agentInstructions.write` | `packages/server/src/__tests__/agent-instructions-command.test.ts` |
| INSTR-003 | 生成 agent instructions | Implemented | `agentInstructions.generate`、`packages/server/src/agent-instructions/agent-generator.ts` | `packages/server/src/__tests__/agent-instructions/generator.test.ts` |
| INSTR-004 | regenerate / generate by agent | Implemented | `agentInstructions.regenerate`、`generateByAgent`、`generateAndWriteByAgent` | `packages/server/src/__tests__/agent-instructions-command.test.ts` |
| INSTR-005 | instructions status / health | Implemented | `agentInstructions.status`、`agentInstructions.health` | `packages/server/src/__tests__/agent-instructions/health.test.ts` |
| INSTR-006 | attach instructions to session | Internal | `agentInstructions.attachToSession` | `packages/server/src/__tests__/agent-instructions-command.test.ts` |
| INSTR-007 | system instructions read/write/status | Implemented | `agentInstructions.system.*`、`agent-instructions-section.tsx` | `packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx` |
| INSTR-008 | token 趋势展示 | Implemented | `agent-instructions-token-trend.tsx`、`agent-token-trend-section.tsx` | `packages/web/src/features/workspace/views/shared/agent-instructions-token-trend.test.tsx` |

## 4. 模块级验收线索

- 读取已有 instructions 时应显示内容和状态。
- 生成成功后应能写入并重新读取。
- system instructions 修改后应保持独立于 workspace instructions。

## 5. 功能点规格

### INSTR-001 读取 workspace agent instructions

状态：`Implemented`

用户行为：
- 用户打开 workspace shared panel 中的 Agent Instructions 区域，或点击查看自定义 instructions。

系统响应：
- 前端调用 `agentInstructions.status` 获取文档存在状态、路径和 system 状态。
- 需要读取内容时调用 `agentInstructions.read`。
- 服务端先校验 workspace，再读取 `.coder-studio/agent.md`。
- 前端监听 workspace 的 `fs.dirty` 事件，文件变化后刷新 status。

状态与边界：
- Exists：显示文档路径和可查看/编辑入口。
- Missing：允许创建草稿或生成。
- Workspace missing：服务端按 workspace 查询失败返回错误。
- Dirty：写入或外部修改后通过 dirty 事件触发刷新。

验收标准：
- Given workspace 中存在 `.coder-studio/agent.md`
- When 用户打开 Agent Instructions 区域
- Then UI 显示该文档存在
- And 查看操作打开该路径

代码索引：
- `packages/server/src/commands/agent-instructions.ts`
- `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts`

### INSTR-002 写入 workspace agent instructions

状态：`Implemented`

用户行为：
- 用户保存 workspace agent instructions 内容。

系统响应：
- 前端或编辑器调用 `agentInstructions.write`，传入 content，以及可选 overwrite/baseHash。
- 服务端写入 `.coder-studio/agent.md`。
- 写入成功后发出 `fs.dirty`，reason 为 `file_content`。

状态与边界：
- Success：返回写入后的 document。
- Conflict：baseHash 不匹配时由写入 helper 返回冲突或失败。
- Overwrite：设置 overwrite 时允许覆盖当前文档。

验收标准：
- Given workspace 没有自定义 agent instructions
- When 写入内容 `# Agent Instructions`
- Then `.coder-studio/agent.md` 被创建
- And workspace 收到 `fs.dirty` 事件

代码索引：
- `packages/server/src/commands/agent-instructions.ts`

### INSTR-003 生成 agent instructions 草稿

状态：`Implemented`

用户行为：
- 用户请求生成 workspace agent instructions 草稿，但不直接覆盖自定义文件。

系统响应：
- `agentInstructions.generate` 基于 workspace intelligence 生成内容。
- 返回路径为默认 agent instructions path，`exists` 为 false，包含 content。
- 该命令不写入文件。

状态与边界：
- Success：返回可供预览或后续保存的内容。
- Workspace missing：workspace 不存在时失败。
- Source of truth：生成内容来自当前 workspace 代码分析，不应依赖旧 PRD。

验收标准：
- Given workspace 可读取
- When 调用 `agentInstructions.generate`
- Then 返回生成内容
- And 不创建或覆盖 `.coder-studio/agent.md`

代码索引：
- `packages/server/src/commands/agent-instructions.ts`
- `packages/server/src/agent-instructions/prompt.ts`
- `packages/server/src/workspace/intelligence.ts`

### INSTR-004 使用 agent 生成并写入

状态：`Implemented`

用户行为：
- 用户打开生成弹窗，选择支持生成的 provider，可选填写 model，然后提交。

系统响应：
- 前端先加载 `provider.list` 和 `provider.runtimeStatus`。
- 仅展示支持 agent instructions generation 且 runtime available 的 provider。
- 提交后调用 `agentInstructions.generateAndWriteByAgent`，超时为 120 秒。
- 服务端通过 `AgentInstructionsGenerator` 运行 provider，生成内容后覆盖写入 workspace 自定义文档。
- 成功后刷新 status。

状态与边界：
- No provider：没有可用生成 provider 时显示无 provider 错误。
- Timeout：生成超时映射为生成失败提示。
- No output：生成无输出时映射为生成失败提示。
- Runtime：不可用 provider 不应出现在可选列表中。

验收标准：
- Given Codex 支持生成且 runtime available
- When 用户选择 Codex 并提交生成
- Then 前端调用 `agentInstructions.generateAndWriteByAgent`
- And 成功后 `.coder-studio/agent.md` 更新为生成内容
- And Agent Instructions status 被刷新

代码索引：
- `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts`
- `packages/server/src/commands/agent-instructions.ts`
- `packages/server/src/agent-instructions/agent-generator.ts`

### INSTR-005 instructions status / health

状态：`Implemented`

用户行为：
- 用户查看 workspace agent instructions 的存在状态和健康检查结果。

系统响应：
- `agentInstructions.status` 返回 project/system/document 三组状态。
- `agentInstructions.health` 读取 workspace 自定义文档并运行 markdown 健康评估。
- UI 可根据 status 决定是否允许 view、edit、generate 或 attach。

状态与边界：
- Project：当前 workspace 自定义文档存在与否。
- System：按 provider 返回系统级 instructions 状态。
- Health：评估的是当前自定义文档内容。

验收标准：
- Given workspace 自定义文档存在
- When 调用 `agentInstructions.health`
- Then 返回该 markdown 的健康评估结果

代码索引：
- `packages/server/src/commands/agent-instructions.ts`
- `packages/server/src/agent-instructions/health.ts`

### INSTR-006 attach instructions to session

状态：`Internal`

用户行为：
- 用户或内部操作把当前有效 agent instructions 注入到正在运行的 session。

系统响应：
- `agentInstructions.attachToSession` 接收 workspaceId 和可选 sessionId。
- sessionId 省略时使用 workspace UI state 的 active session。
- 服务端校验 session 存在且处于可注入状态。
- 解析有效 instructions 后，通过 session manager 向 session 发送输入。

状态与边界：
- Missing session：没有 active session 或 session 不存在时返回 `session_not_found`。
- Non-injectable：目标 session 不可注入时返回 `inject_target_unavailable`。
- Missing instructions：没有可用 instructions 时返回 `agent_instructions_missing`。

验收标准：
- Given workspace 有 active session 且存在有效 agent instructions
- When 调用 `agentInstructions.attachToSession` 且不传 sessionId
- Then 服务端向 active session 发送 instructions 内容

代码索引：
- `packages/server/src/commands/agent-instructions.ts`
- `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts`

### INSTR-007 system instructions read/write/status

状态：`Implemented`

用户行为：
- 用户在 system agent section 中查看或编辑某个 provider 的系统级 agent instructions。

系统响应：
- `agentInstructions.system.status` 返回各 provider 系统文档状态。
- `agentInstructions.system.read` 读取指定 provider 的系统文档。
- `agentInstructions.system.write` 写入指定 provider 的系统文档，并支持 baseHash。
- 前端编辑不存在的系统文档时，先在编辑器中创建 unsaved draft scaffold。

状态与边界：
- Editable：只有标记 editable 的 entry 才允许打开编辑。
- Provider scoped：system instructions 按 providerId 独立。
- Missing：不存在时可创建草稿，不应误写 workspace 自定义文档。

验收标准：
- Given Claude system instructions 不存在且 entry editable
- When 用户点击编辑 Claude system instructions
- Then 编辑器打开 Claude system path 的 unsaved draft
- And 保存后只影响 Claude system instructions

代码索引：
- `packages/server/src/commands/agent-instructions.ts`
- `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts`
- `packages/web/src/features/workspace/views/shared/agent-instructions-section.tsx`

### INSTR-008 token 趋势展示

状态：`Implemented`

用户行为：
- 用户在 Agent Instructions 区域查看 token 趋势或摘要。

系统响应：
- 前端组件读取 agent token trend 数据并渲染趋势段。
- 趋势展示独立于文档写入命令。

状态与边界：
- Empty：没有 token 数据时显示空态或不渲染趋势内容。
- Display only：趋势组件不负责生成、读取或写入 instructions 文档。

验收标准：
- Given token trend 数据包含多个时间点
- When Agent Instructions 区域渲染
- Then 用户能看到趋势摘要

代码索引：
- `packages/web/src/features/workspace/views/shared/agent-instructions-token-trend.tsx`
- `packages/web/src/features/workspace/views/shared/agent-token-trend-section.tsx`

## 6. 未确认项

- `attachToSession` 的产品入口需在 session 规格轮确认。
