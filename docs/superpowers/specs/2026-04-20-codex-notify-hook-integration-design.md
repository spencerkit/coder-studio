# Codex Notify Hook 集成 · 设计文档

> **版本：** 1.0
> **日期：** 2026-04-20
> **状态：** Draft (等待评审)
> **关联 PRD：** `docs/PRD.zh-CN.md` §16（Supervisor 前置依赖）
> **后续 spec：** `2026-04-xx-supervisor-system-design.md`（依赖本文档交付的能力）
> **作者：** 技术共同设计 — Spencer + Claude

---

## 0. 文档说明

### 0.1 目的

本文档交付 **Codex provider 的生命周期 hook 集成**，把 Codex 会话从 `capability: 'limited'` 升级到 `'full'`，和 Claude 在"每轮结束信号 + resume 能力 + transcript 路径"三条能力上对等。

### 0.2 动机

- 目前 `packages/providers/src/codex` 以"受限模式"集成：无 hook、无 resume、`hook-bridge/src/codex-bridge.js` 为 `process.exit(0)` 占位。
- 调研发现 Codex CLI 本身提供 `[notify]` 配置（`~/.codex/config.toml`）和 `-c notify=[...]` CLI 覆盖，能在每轮结束时调用外部脚本传 JSON payload。
- 后续 Supervisor 系统（PRD §16）依赖"每轮结束触发"和"transcript 文件路径"两个原语。本 spec 为 Supervisor 铺路，同时独立可验收（Codex 本身的会话能力也受益：完成检测、resume、后续 UI 进度条等）。

### 0.3 非目标

- **不**迁移 Codex 启动方式到 `codex app-server` / `codex mcp-server` 模式——保持现有 PTY + TUI 模型。
- **不**实现 Supervisor 的评估/注入链路（见 Spec 2）。
- **不**删除 `packages/providers/src/codex/stdout-heuristics.ts`——保留作为降级，下个 spec 再评估清理。
- **不**修改用户已有的 `~/.codex/config.toml`——走 `-c` argv 覆盖。

---

## 1. 范围与交付

### 1.1 交付清单

- [ ] Codex 每轮结束时，coder-studio 服务端收到 `TurnCompleted` 事件。
- [ ] Codex 会话的 `resumeId`（= Codex `thread-id` UUID）首次 turn 结束后入库。
- [ ] Codex 会话的 transcript 文件（rollout JSONL）路径写入 `sessions.transcript_path`。
- [ ] Codex provider 的 `capability` 升级到 `'full'`；`buildResumeCommand` 可用。
- [ ] Claude 侧同步把 `transcript_path` 持久化（此前 hook payload 给了但没存）。
- [ ] `~/.codex/config.toml` 保持用户原样不修改。

### 1.2 成功标准

- 手动验收：新建 Codex 会话 → TUI 里跑一轮 → `sessions` 行 `resume_id` 和 `transcript_path` 都非 NULL；重启 server 用 `codex resume <resume_id>` 能拉起同一会话。
- 自动测试：§7 列的用例全绿。
- 回归：Claude 会话不受影响；已在用的 Codex 会话（旧表结构 + 旧 argv）仍能启动（老 session 行 `transcript_path` 为 NULL 无副作用）。

---

## 2. 架构概览

### 2.1 数据流

```
用户开 Codex 会话
  ↓
SessionManager.create(...) 分配 coder-studio sessionId
  ↓
TerminalManager 启动 PTY:
  argv = codex -c 'notify=["node","<~/.coder-studio/hooks/codex-bridge.js>"]' <其余>
  env  += CODER_STUDIO_SESSION_ID=<sessionId>
  DB: resume_id=NULL, transcript_path=NULL
  ↓
用户在 TUI 发消息 → Codex 跑完一轮
  ↓
Codex 调用 notify:
  node <codex-bridge.js> '{"type":"agent-turn-complete","thread-id":"<UUID>","turn-id":"...",...}'
  ↓
codex-bridge.js (由 server/src/hooks/bridge.ts 生成部署):
  - payload = JSON.parse(process.argv.at(-1))
  - event  = payload.type        // "agent-turn-complete"
  - 读 ~/.coder-studio/runtime.json → port + token
  - 读 env.CODER_STUDIO_SESSION_ID
  - POST http://127.0.0.1:<port>/internal/hooks/agent-turn-complete
         ?token=<token>&coder_studio_session_id=<sessionId>
         body = payload
  ↓
registerHooksEndpoint → HooksManager.handleHookEvent(event, payload, query):
  - 从 query.coder_studio_session_id 拿到 coder-studio sessionId
    (Claude 路径保持不变：从 payload.session_id 反查 resumeId→sessionId)
  - codexDefinition.hooks.parseEvent('agent-turn-complete', payload)
    → ProviderEvent { type: 'turn_completed', sessionId: '', payload: { resumeId, turnId } }
  - 转成 ProviderHookEvent { kind:'TurnCompleted', resumeId, turnId }
  - SessionManager.onHookEvent(codeStudioSessionId, hookEvent)
  ↓
SessionManager.applyHookEvent:
  1. session.resumeId 若空则写入（首次 turn 确认会话真的起来了）
  2. session.transcriptPath 若空则异步 resolveTranscriptPath → 写入
  3. EventBus.emit('session.lifecycle', { event:'turn_completed', ... })
  4. WS 广播 session.state 变更
```

### 2.2 组件改动总览

| 层 | 文件 | 改动 |
|---|---|---|
| Provider 抽象 | `packages/core/src/provider/definition.ts` | `LaunchContext` 增 `bridgeScriptPath?: string`；`ProviderDefinition` 新增可选 `resolveTranscriptPath` |
| Provider (Claude) | `providers/src/claude/{hooks-template,definition}.ts` | `parseEvent` 的 `SessionStart` 分支带出 `transcriptPath`（payload 里已经有）；definition 加 `resolveTranscriptPath` |
| Provider (Codex) | `providers/src/codex/definition.ts` | `capability: 'full'`；`buildCommand`/`buildResumeCommand` 注入 `-c notify=[...]` 使用 `ctx.bridgeScriptPath`；`hooks` 从 no-op 改为真 descriptor；加 `resolveTranscriptPath` |
| Provider (Codex) | `providers/src/codex/resolve-transcript.ts` | **新建**：递归扫 rollout 文件 |
| Bridge 生成器 | `server/src/hooks/bridge.ts` | `generateBridgeScript(providerId)` 针对 `codex` 输出 argv 读 payload + session-id-from-env 的变体；或拆成 `generateStdinBridge` / `generateArgvBridge` |
| Bridge 参考源 | `hook-bridge/src/codex-bridge.js` | 同步更新为 argv 版（与生成器输出保持一致，方便包/参考） |
| Hook endpoint | `server/src/hooks/endpoint.ts` | 允许 `?coder_studio_session_id=<id>` query 透传给回调 |
| Hooks 路由 | `server/src/hooks/manager.ts` | `handleHookEvent` 从 query 或 `payload.session_id` 还原 coder-studio sessionId，调 `parseEvent` → 转 `ProviderHookEvent` → 路由到 `SessionManager.onHookEvent` |
| Session 领域 | `server/src/session/manager.ts` | `ProviderHookEvent` 加 `TurnCompleted`；`applyHookEvent` 处理；`SessionStart` 分支消费 `transcriptPath` |
| Session 仓储 | `server/src/storage/repositories/session-repo.ts` | `SessionRow`/`NewSession` 加 `transcriptPath`；`create`/`rowToSession` 映射；新增 `updateTranscriptPath` 方法 |
| DB 迁移 | `server/src/storage/migrations/002_transcript_path.sql` | **新建**：`ALTER TABLE sessions ADD COLUMN transcript_path TEXT` |
| 启动装配 | `server/src/server.ts` | `SessionManager.create` 前，按 providerId 取 `getBridgeScriptPath()` 填入 `LaunchContext.bridgeScriptPath` |

---

## 3. 接口契约

### 3.1 `ProviderDefinition` / `LaunchContext` 扩展

```ts
interface LaunchContext {
  sessionId: string;
  workspacePath: string;
  bridgeScriptPath?: string;   // 新增：bridge 脚本绝对路径
}

interface ProviderDefinition {
  // 已有字段省略
  resolveTranscriptPath?(session: Session): Promise<string | null>;
}
```

- `bridgeScriptPath`：由 server 在 `SessionManager.create` 里通过
  `getBridgeScriptPath(provider.id)` 填入，Codex 在 `buildCommand` / `buildResumeCommand`
  中引用；Claude 的注入路径仍走 `settings.json`，不用这个字段（保持可选）。
- `resolveTranscriptPath`：可选方法，不实现则上层跳过。返回绝对路径；未找到返回 `null`，
  调用方自行决定是否下次 turn 再试。不抛错 —— 找不到视为"暂未生成"，不是失败。

### 3.2 事件类型扩展

**Canonical `ProviderEvent`**（`packages/core/src/provider/definition.ts`）

```ts
export interface ProviderEvent {
  type: 'session_start' | 'stop' | 'turn_completed' | 'progress' | 'error';
  //                               ^^^^^^^^^^^^^^^^ 已存在枚举值，首次真正被使用
  sessionId: string;
  payload: Record<string, unknown>;
}
```

不改动类型定义；`codexDefinition.hooks.parseEvent` 开始真正发射 `turn_completed`。

**Server 内部 `ProviderHookEvent`**（`server/src/session/manager.ts`）

```ts
export type ProviderHookEvent =
  | { kind: 'SessionStart'; resumeId: string; transcriptPath?: string }  // 扩字段
  | { kind: 'Stop' }                                                      // 保留（Claude 现用）
  | { kind: 'TurnCompleted'; resumeId: string; turnId: string }           // 新增
  | { kind: 'Progress'; percent: number };
```

- `Stop` 与 `TurnCompleted` 在 `SessionManager.applyHookEvent` 里共用同一处理分支（都代表"一轮结束"）。`Stop` 不携带 resumeId，因此只做 `turn_completed` 事件广播，不更新 resumeId。
- `HooksManager.handleHookEvent` 负责 `ProviderEvent → ProviderHookEvent` 的转换。
- 未来是否把 Claude 的 Stop 也改造成带 resumeId 的 TurnCompleted，由 Supervisor spec 决定；本 spec 不动。

### 3.3 Codex notify 命令注入

`codex/definition.ts` `buildCommand` / `buildResumeCommand` 产出的 argv：

```ts
// 启动
['codex',
 '-c', `notify=${JSON.stringify([ 'node', ctx.bridgeScriptPath ])}`,
 ...cfg.additionalArgs]

// 恢复
['codex', 'resume', session.resumeId,
 '-c', `notify=${JSON.stringify([ 'node', ctx.bridgeScriptPath ])}`,
 ...cfg.additionalArgs]
```

- `JSON.stringify` 保证路径含空格、引号时正确转义。JSON 字符串数组是合法的行内 TOML 数组。
- `ctx.bridgeScriptPath` 来自 `LaunchContext`（复用 Claude 现有解析路径；见 §6 开放项 #1 验证实现细节）。
- `env` 仍追加 `CODER_STUDIO_SESSION_ID`，bridge 通过环境变量定位 coder-studio session。

### 3.4 codex-bridge.js 协议

**调用方式**（Codex 发起）：

```
node <~/.coder-studio/hooks/codex-bridge.js> '<json-payload>'
```

- payload 是命令行**最后一个** argv token（Codex 约定）。
- bridge 不从 stdin 读（与 Claude 路径不同）。

**bridge 的行为**：

1. `payload = JSON.parse(process.argv.at(-1))`，解析失败 → 静默 exit 0。
2. `event = payload.type`（如 `"agent-turn-complete"`），缺失 → 静默 exit 0。
3. `sessionId = process.env.CODER_STUDIO_SESSION_ID`，不存在 → 静默 exit 0。
4. 读 `~/.coder-studio/runtime.json` 拿 `port` + `token`，不存在 → 静默 exit 0。
5. POST `http://127.0.0.1:<port>/internal/hooks/<event>?token=<token>&coder_studio_session_id=<sessionId>`
   - body：原 payload JSON 直接转发（与 Claude bridge 语义一致）。
6. 500ms timeout；网络错误 / 超时 → 静默 exit 0。
7. 零三方依赖，纯 `http` + `fs`。和 `claude-bridge.js` 同套防御写法。

**注意**：此脚本由 `generateBridgeScript('codex')` 生成并部署到
`~/.coder-studio/hooks/codex-bridge.js`。现有 Claude 版本读 stdin，所以本 spec 把
`generateBridgeScript` 按 providerId 分支为 stdin（Claude）/ argv（Codex）两种输出。

### 3.5 Hook endpoint + HooksManager 路由

**endpoint 协议**（`server/src/hooks/endpoint.ts`）

- 维持 `POST /internal/hooks/:event?token=<token>`；**新增**可选 query
  `coder_studio_session_id`。
- 回调签名由 `(event, payload) => void` 扩展为 `(event, payload, ctx)`，其中
  `ctx = { coderStudioSessionId?: string }` —— 透传给 `HooksManager.handleHookEvent`。

**HooksManager.handleHookEvent**

现有代码是占位 `console.log`，本 spec 首次落地真实实现：

```ts
handleHookEvent(event: string, payload: unknown, ctx: HookContext): void {
  // 1. 选 provider：按 providerId 尝试 parseEvent，第一个返回非 null 的即为匹配
  //    （MVP 够用；后续如需扩展可加显式 providerId query 参数）
  const matched = this.tryParse(event, payload);
  if (!matched) return;

  // 2. 还原 coder-studio sessionId
  //    - Codex: ctx.coderStudioSessionId（query 带入）
  //    - Claude: 暂从 payload.session_id 反查 sessions 表（resume_id → id）
  const sessionId = ctx.coderStudioSessionId
    ?? this.resolveClaudeSessionId(matched.providerEvent);
  if (!sessionId) return;

  // 3. ProviderEvent → ProviderHookEvent
  const hookEvent = toHookEvent(matched.providerEvent);

  // 4. 路由
  this.sessionMgr.onHookEvent(sessionId, hookEvent);
}
```

- `resolveClaudeSessionId`：`SELECT id FROM sessions WHERE resume_id = ?` + 最近 lastActiveAt。
- Codex 路径始终走 query，避免 Codex payload 里的 `thread-id` 和用户其他 session 混淆。

### 3.6 Codex rollout 路径定位

`packages/providers/src/codex/resolve-transcript.ts`：

```ts
export async function resolveCodexTranscriptPath(
  resumeId: string,
  homeDir = os.homedir()
): Promise<string | null> {
  const base = path.join(homeDir, '.codex', 'sessions');
  // 文件名形如: rollout-<ISO-date>-<UUID>.jsonl
  // 用 fs.readdir 递归而非依赖 glob 库；目录按 yyyy/mm/dd 分层
  const matches: { path: string; mtime: number }[] = [];
  for await (const entry of walkRolloutFiles(base)) {
    if (entry.name.includes(resumeId) && entry.name.startsWith('rollout-')) {
      matches.push({ path: entry.path, mtime: entry.stat.mtimeMs });
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0].path;
}
```

- `walkRolloutFiles` 是本地小工具（不引入 glob 依赖），从 `~/.codex/sessions/<year>/<month>/<day>/` 三级目录下扫文件。
- 同 resumeId 多命中时取最新 mtime（实际只该有一个，但防御）。
- `homeDir` 注入，便于测试用临时目录 fixture。

---

## 4. 数据模型变更

### 4.1 迁移 `002_transcript_path.sql`

```sql
ALTER TABLE sessions ADD COLUMN transcript_path TEXT;
```

- 无索引：查询都是 `WHERE id = ?`，线性访问。
- nullable：老行默认 NULL；未定位成功的新行也 NULL。

### 4.2 `SessionRow` / `Session`

```ts
interface SessionRow {
  // 已有字段略
  transcript_path: string | null;  // 新增
}

interface Session {
  // 已有字段略
  transcriptPath?: string;  // 新增
}
```

`SessionRepo` 的 `create` / `rowToSession` 都要映射 `transcript_path` ↔ `transcriptPath`，并新增 `updateTranscriptPath(id, path)` 方法供 `applyHookEvent` 调用。

---

## 5. Session 生命周期状态变化

会话状态枚举（`packages/core/src/domain/types.ts`）：`draft | starting | running | idle | ended | unavailable`。`SessionManager.create` 默认把新会话写成 `starting`；首个生命周期 hook 到达前一直停留在该状态。

### 5.1 Codex 首轮 TurnCompleted

```
starting → running （resumeId 首次填入）
         → 发射 turn_completed domain event
         → 异步 resolveTranscriptPath，命中则写 transcript_path
         → WS 广播 session.state 变更
```

### 5.2 后续 TurnCompleted

```
running/idle → idle
             → 发射 turn_completed domain event
             → 若 transcript_path 仍为空，重试 resolveTranscriptPath
             → WS 广播（如有状态变化）
```

### 5.3 Claude SessionStart 同步调整

`SessionManager.applyHookEvent` 的 `SessionStart` 分支现在同时写 `transcriptPath`：

```ts
case 'SessionStart':
  session.resumeId = event.resumeId;
  session.transcriptPath = event.transcriptPath;
  session.state = 'running';
  // ...
  this.deps.db.update(sessionId, {
    resumeId: event.resumeId,
    transcriptPath: event.transcriptPath,
    // ...
  });
```

---

## 6. 开放项

| # | 项 | 方案 |
|---|---|---|
| 1 | `stdout-heuristics.ts` 留退 | 保留；Codex provider 主路径不再使用，作为降级。三个月内无触发记录后在独立 spec 中清理。 |
| 2 | `TurnCompleted` 事件是否顺手带 `lastAssistantMessage` / `inputMessages` | 本 spec 不带。Supervisor (Spec 2) 评估器从 transcript 读。若后续发现 I/O 成为瓶颈再加字段。 |
| 3 | Codex `failed` turn 是否触发 notify | 文档未明说；本 spec 假设触发，`applyHookEvent` 对成功/失败走同一路径。Supervisor 会看 `turn.status` 再决定要不要评估。 |
| 4 | 多 Codex 会话并发 | 每个 session 的 `CODER_STUDIO_SESSION_ID` 独立注入 env 并作为 query 回传；rollout UUID 唯一；无冲突。集成测试覆盖双会话场景。 |
| 5 | `endpoint.onHookEvent` 回调签名变更的向后兼容 | 已有实现没有对外暴露回调类型；扩展只影响内部装配。`manager.ts` 回调若保持旧签名，在启动时用 adapter 包一层即可。 |

---

## 7. 测试计划

### 7.1 单元测试

| 用例 | 位置 |
|---|---|
| `generateBridgeScript('codex')` 输出脚本：argv.at(-1) 取 payload、env 缺失静默退出、POST URL 带 token + session-id query | `server/src/hooks/bridge.test.ts`（扩） |
| `codexDefinition.hooks.parseEvent('agent-turn-complete', payload)` 返回 `ProviderEvent { type:'turn_completed', payload:{ resumeId, turnId } }` | `providers/src/codex/definition.test.ts`（扩） |
| `HooksManager.handleHookEvent`：query 里有 sessionId 时直走 Codex 路径；没有则走 Claude 反查；parse 失败 no-op | `server/src/hooks/manager.test.ts`（扩） |
| `buildCommand` 注入 `-c notify=[...]`；`buildResumeCommand` 同样；bridge 路径含空格时 JSON.stringify 正确转义 | 同上 |
| `resolveCodexTranscriptPath`：命中唯一 / 未命中 / 多命中按 mtime 取最新 | `providers/src/codex/resolve-transcript.test.ts`（新建） |
| Claude `parseEvent` SessionStart 携带 `transcriptPath`（回归） | `providers/src/claude/hooks-template.test.ts`（扩） |

### 7.2 集成测试

| 用例 | 位置 |
|---|---|
| 端到端 Codex 首轮：fake-codex shell 脚本接受 `-c notify=[...]`、写 rollout fixture、spawn bridge → server 收事件 → DB 行 `resume_id` + `transcript_path` 均落盘 | `server/src/__tests__/codex-hook-integration.test.ts`（新建） |
| 两个并发 Codex 会话：各自 resumeId/transcriptPath 独立 | 同上 |
| `applyHookEvent(TurnCompleted)`：首次填 resumeId；重复调用不覆盖；发射 `turn_completed` domain event | `server/src/__tests__/session-integration.test.ts`（扩） |
| Claude `SessionStart` 后 `transcript_path` 入库（回归） | 同上 |
| 迁移 002 执行后 `sessions.transcript_path` 列存在 | 现有 migration 测试（扩） |

### 7.3 手动验收

1. 新建 Codex 会话，在 TUI 发一条消息 → 服务端日志显示收到 `agent-turn-complete`；DB `sessions` 表对应行 `resume_id` 非空、`transcript_path` 指向 `~/.codex/sessions/.../rollout-*-<resume_id>.jsonl`、文件确实存在。
2. 重启 server，从 UI 恢复同一 session → PTY 执行 `codex resume <resume_id> -c 'notify=[...]'`，TUI 显示历史对话。
3. 检查 `~/.codex/config.toml`：未被修改。
4. Claude 会话新开一轮 → DB `transcript_path` 指向 `~/.claude/projects/...` 的 JSONL，文件存在。

---

## 8. 回滚策略

- 代码层：本 spec 的改动全部在新增文件 + 可选字段上，回滚只需 `git revert`。
- 数据层：`ALTER TABLE ADD COLUMN` 是 SQLite 原生安全 DDL；如需回滚可忽略列（SQLite 不支持 `DROP COLUMN` 但列空置无副作用），或 dump/reimport。
- 运行时：若 Codex 启动失败，短期降级手段 = 在 `CodexConfig` 里加一个 `disableHooks: boolean` 开关跳过 `-c notify` 注入（不在本 spec 交付，作为应急）。

---

## 9. 后续工作（非本 spec 范围）

- **Spec 2《Supervisor 系统》**：基于 `session.transcript_path` + Provider 无头模式（`claude -p` / `codex exec`）实现目标评估 + 指导注入。
- 清理 `stdout-heuristics.ts`（独立清理 spec）。
- 监测：为 `resolveTranscriptPath` 未命中、notify POST 失败加结构化日志 + 指标。
