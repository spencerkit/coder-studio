# Session → PTY Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `Session → TerminalManager → PTY` 链路中的生命周期断连、职责泄漏、双广播路径、Provider 能力声明不一致等 9 个问题，分 5 个原子 PR 落地。

**Architecture:**
- Phase A（PR-1）只做加法性修补，修三个已经在线上会出问题的点。
- Phase B（PR-2/3/4）做一次"PTY ownership 上移到 SessionManager"的收敛重构，让命令层回归纯翻译，supervisor 从 SessionManager 取数据。
- Phase C（PR-5）收尾：Provider `capability` 改为仅展示、状态机仅依赖 `hooks.events.*`；Topic builder 全量迁移；错误堆栈保留。

**Tech Stack:** TypeScript 5.x · pnpm workspaces · Vitest · node-pty · Fastify + ws · Zod · EventBus (自研，`packages/server/src/bus/event-bus.ts`) · SQLite (better-sqlite3)。

**Repo Layout（相关包）：**
- `packages/core` — 共享 domain 类型、`DomainEvent` 联合、`Topics` builder
- `packages/server` — Session/Terminal manager、PTY host、WsHub、hooks bridge、supervisor
- `packages/providers` — Claude / Codex provider definition & hooks descriptor
- `packages/web` — 前端订阅 topic、xterm 渲染

---

## PR 总览

| PR | Phase | 名称 | 依赖 | 预估 diff |
|----|-------|------|------|-----------|
| 1  | A     | 止血三件套（exit 通知 / hook 日志+重试 / kill 轮询） | – | ~350 行 |
| 2  | B1    | Terminal 事件归并到 EventBus，WsHub 统一翻译 | PR-1 | ~400 行 |
| 3  | B2    | SessionManager 成为 PTY owner（新增 session 级 API，反向索引） | PR-2 | ~500 行 |
| 4  | B3    | 命令层只调 sessionMgr；supervisor 取数据走 sessionMgr；DTO 收敛到 session-repo | PR-3 | ~500 行 |
| 5  | C     | Provider hooks.events 为唯一真源；Topics 全量迁移；错误栈保留 | PR-4 | ~300 行 |

每个 PR 独立可 revert。全程不保留旧 topic（用户确认直接替换）。

---

## 全局验证基线（每个 PR 开工前跑一次、合并前跑一次）

```bash
# 1) 类型
pnpm -w typecheck

# 2) 单元/集成
pnpm -w test

# 3) 相关 e2e（如本地没有 Playwright 机器可跳）
pnpm -w --filter @coder-studio/e2e test -- --grep "session|terminal"
```

任何步骤让 baseline 从 green 变 red，**停下来修，不往后走**。

---

# PR-1 / Phase A — 止血三件套

**目标：** 修三个会在线上明显被感知的点，无架构变动。

**Files:**
- Modify: `packages/server/src/terminal/manager.ts`（A1：pty.onExit 多一个回调）
- Modify: `packages/server/src/session/manager.ts`（A1：让 SessionManager 订阅 terminal exit；A2：pending events 加日志）
- Modify: `packages/server/src/server.ts`（A1：在 wiring 阶段把两个 manager 接起来）
- Modify: `packages/server/src/terminal/types.ts`（A1：`TerminalManagerDeps` 新增 `onTerminalExit?` 回调字段）
- Modify: `packages/server/src/hooks/bridge.ts`（A2：shell 模板增加 3 次退避重试）
- Modify: `packages/server/src/hooks/bridge.test.ts`（A2：验证重试存在）
- Modify: `packages/server/src/terminal/pty-host.ts`（A3：100ms 固定延迟 → `kill -0` 轮询）
- Test: `packages/server/src/__tests__/session-terminal-exit.test.ts`（A1 新增，不改旧文件）
- Test: `packages/server/src/terminal/pty-host.test.ts`（A3 如不存在则新增）

---

## Task 1 (A1): Terminal 退出 → 通过回调通知 SessionManager

**Files:**
- Create: `packages/server/src/__tests__/session-terminal-exit.test.ts`
- Modify: `packages/server/src/terminal/manager.ts`
- Modify: `packages/server/src/server.ts`

选"直接回调"而非"新 domain event"是为了把生命周期修补和 B1 的事件统一解耦 —— B1 会把这条改成 EventBus。

- [ ] **Step 1：写失败测试 `session-terminal-exit.test.ts`**

```ts
// packages/server/src/__tests__/session-terminal-exit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TerminalManager } from '../terminal/manager.js';
import { SessionManager } from '../session/manager.js';
import type { PtyHost, PtyProcess } from '../terminal/types.js';
import type { Broadcaster } from '../ws/hub.js';
import { EventBus } from '../bus/event-bus.js';
import { makeInMemoryTerminalDb, makeInMemorySessionDb, makeStubProvider } from './helpers.js'; // 下面 Step 2 补齐

describe('Terminal exit propagates to SessionManager', () => {
  it('marks session as ended and updates DB when PTY exits', async () => {
    let capturedExit: ((ev: { exitCode: number }) => void) | null = null;
    const pty: PtyProcess = {
      onData: () => {},
      onExit: (cb) => { capturedExit = cb; },
      write: () => {},
      resize: () => {},
      kill: () => {},
    };
    const ptyHost: PtyHost = { spawn: () => pty };
    const broadcaster: Broadcaster = { broadcast: vi.fn() };
    const eventBus = new EventBus();
    const terminalDb = makeInMemoryTerminalDb();
    const sessionDb = makeInMemorySessionDb();

    const terminalMgr = new TerminalManager({ ptyHost, broadcaster, db: terminalDb });
    const sessionMgr = new SessionManager({
      terminalMgr,
      eventBus,
      db: sessionDb,
      broadcaster,
      providerRegistry: [makeStubProvider({ hasSessionStart: false })],
      providerConfigRepo: { get: () => ({}) } as any,
    });

    // Phase A wiring: SessionManager subscribes to TerminalManager exit
    terminalMgr.onTerminalExit((terminalId, exitCode) => {
      sessionMgr.onTerminalExit(terminalId, exitCode);
    });

    const session = await sessionMgr.create({
      workspaceId: 'ws1',
      workspacePath: '/tmp',
      providerId: 'stub',
      provider: makeStubProvider({ hasSessionStart: false }),
    });

    expect(sessionMgr.get(session.id)?.state).toBe('idle');

    // Simulate PTY crash
    capturedExit!({ exitCode: 137 });

    expect(sessionMgr.get(session.id)?.state).toBe('ended');
    expect(sessionDb.rows.get(session.id)?.state).toBe('ended');
    expect(sessionDb.rows.get(session.id)?.ended_at).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2：补齐 `helpers.ts` 辅助**

如果 `packages/server/src/__tests__/helpers.ts` 不存在则创建。若已存在则按需 merge。

```ts
// packages/server/src/__tests__/helpers.ts
import type { ProviderDefinition } from '@coder-studio/core';
import type { SessionRow } from '../session/manager.js';
import type { TerminalDatabase } from '../terminal/types.js';
import type { SessionDatabase } from '../session/types.js';

export function makeInMemoryTerminalDb(): TerminalDatabase {
  const rows = new Map<string, any>();
  return {
    insert: (row) => { rows.set(row.id, row); },
    markEnded: (id, endedAt, exitCode) => {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, ended_at: endedAt, exit_code: exitCode });
    },
  } as any;
}

export function makeInMemorySessionDb(): SessionDatabase & { rows: Map<string, SessionRow> } {
  const rows = new Map<string, SessionRow>();
  return {
    rows,
    insert: (row) => { rows.set(row.id, { ...row }); },
    update: (id, patch) => {
      const r = rows.get(id);
      if (!r) return;
      rows.set(id, { ...r, ...(Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [toSnake(k), v])
      )) });
    },
    delete: (id) => { rows.delete(id); },
    listHydratable: () => [],
  } as any;
}

export function makeStubProvider(opts: { hasSessionStart: boolean }): ProviderDefinition {
  return {
    id: 'stub',
    displayName: 'Stub',
    capability: 'full',
    buildCommand: () => ({ argv: ['echo'], cwd: '/tmp', env: {} }),
    hooks: {
      events: {
        sessionStart: opts.hasSessionStart,
        turnCompleted: true,
        stop: true,
        progress: false,
      },
    },
  } as any;
}

function toSnake(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
```

- [ ] **Step 3：跑测试确认红**

```bash
pnpm -w --filter @coder-studio/server test -- session-terminal-exit
```
预期：FAIL — `terminalMgr.onTerminalExit is not a function`。

- [ ] **Step 4：在 `TerminalManager` 增加 exit 订阅 API**

编辑 `packages/server/src/terminal/manager.ts`：

1) 类字段增加回调列表（放在 `archivedReplayBuffers` 后面，构造函数前）：
```ts
private exitListeners: Array<(terminalId: TerminalId, exitCode: number) => void> = [];
```

2) 新增 public 方法（放在 `shutdown()` 前）：
```ts
/**
 * Subscribe to PTY exit. Listeners fire after `alive` is flipped to false and
 * after the output/exit broadcasts go out.
 */
onTerminalExit(listener: (terminalId: TerminalId, exitCode: number) => void): () => void {
  this.exitListeners.push(listener);
  return () => {
    this.exitListeners = this.exitListeners.filter((l) => l !== listener);
  };
}
```

3) 在 `wireEvents` 的 `pty.onExit` 回调内，`db.markEnded` 调用之后追加：
```ts
for (const listener of this.exitListeners) {
  try {
    listener(id, exitCode);
  } catch (err) {
    // Listener failures must not interfere with terminal teardown
    console.error('TerminalManager exit listener threw:', err);
  }
}
```

- [ ] **Step 5：在 `server.ts` wiring 处接线**

编辑 `packages/server/src/server.ts`，找到 `terminalMgr`、`sessionMgr` 都已实例化之后、`await sessionMgr.hydrate()` 之前的位置，插入：

```ts
// Keep session lifecycle in lockstep with PTY lifecycle: when a terminal dies
// (crash, user exit, kill), drive the session straight to `ended`.
terminalMgr.onTerminalExit((terminalId, exitCode) => {
  sessionMgr.onTerminalExit(terminalId, exitCode);
});
```

如果该文件内当前没有 `hydrate()` 调用，就放在两个 manager 都构造完、WsHub 构造之前。

- [ ] **Step 6：再跑测试确认绿**

```bash
pnpm -w --filter @coder-studio/server test -- session-terminal-exit
```
预期：PASS。

- [ ] **Step 7：全量 baseline 回归**

```bash
pnpm -w typecheck && pnpm -w test
```

- [ ] **Step 8：Commit**

```bash
git add packages/server/src/terminal/manager.ts \
        packages/server/src/server.ts \
        packages/server/src/__tests__/session-terminal-exit.test.ts \
        packages/server/src/__tests__/helpers.ts
git commit -m "fix: propagate PTY exit to SessionManager so sessions transition to ended"
```

---

## Task 2 (A2): Hook 事件 pending 缓冲增加日志 + bridge POST 重试

**Files:**
- Modify: `packages/server/src/session/manager.ts`
- Modify: `packages/server/src/hooks/bridge.ts`
- Modify: `packages/server/src/hooks/bridge.test.ts`

- [ ] **Step 1：给 `onHookEvent` 增加日志测试（红）**

在 `packages/server/src/__tests__/session-integration.test.ts` 里追加（或新建 `hook-pending-events.test.ts`）：

```ts
it('warns and expires pending hook events when session never registers', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const sessionMgr = buildSessionMgr(); // 你的现有 helper
  sessionMgr.onHookEvent('sess_missing', { kind: 'SessionStart', resumeId: 'r1' });
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining('pending hook event'),
    expect.objectContaining({ sessionId: 'sess_missing', kind: 'SessionStart' })
  );
  warnSpy.mockRestore();
});
```

- [ ] **Step 2：运行测试确认红**

```bash
pnpm -w --filter @coder-studio/server test -- hook-pending
```
预期：FAIL — 当前代码里的 `onHookEvent` 完全没有 `console.warn`。

- [ ] **Step 3：改 `onHookEvent` 的 pending 分支**

编辑 `packages/server/src/session/manager.ts`，把原代码（约 287-303 行）改为：

```ts
onHookEvent(sessionId: string, event: ProviderHookEvent): void {
  const session = this.sessions.get(sessionId);

  if (!session) {
    const pending = this.pendingEvents.get(sessionId) ?? {
      events: [],
      expiresAt: Date.now() + 5000,
    };
    pending.events.push(event);
    this.pendingEvents.set(sessionId, pending);
    this.scheduleCleanup();

    console.warn('SessionManager buffering pending hook event', {
      sessionId,
      kind: event.kind,
      bufferSize: pending.events.length,
      expiresInMs: pending.expiresAt - Date.now(),
    });
    return;
  }

  this.applyHookEvent(sessionId, event);
}
```

同时把 `scheduleCleanup()` 私有方法里的 drop 分支也加一行日志：

```ts
private scheduleCleanup(): void {
  const now = Date.now();
  for (const [sessionId, pending] of this.pendingEvents.entries()) {
    if (pending.expiresAt < now) {
      console.warn('SessionManager dropping expired pending hook events', {
        sessionId,
        dropped: pending.events.map((e) => e.kind),
      });
      this.pendingEvents.delete(sessionId);
    }
  }
}
```

- [ ] **Step 4：跑测试确认绿**

```bash
pnpm -w --filter @coder-studio/server test -- hook-pending
```

- [ ] **Step 5：给 bridge 脚本模板加重试 —— 写测试（红）**

打开 `packages/server/src/hooks/bridge.test.ts`，在现有 describe 内加：

```ts
it('generated bridge script retries POST on failure (3 attempts with backoff)', async () => {
  const script = generateBridgeScript({ token: 'tk', port: 12345, providerId: 'claude' });
  // Script 是 shell/node 文本，断言重试关键字存在
  expect(script).toMatch(/for\s+i\s+in\s+1\s+2\s+3/); // bash: 3 次重试 loop
  expect(script).toMatch(/sleep/);                      // 存在退避
  expect(script).toMatch(/curl/);                       // 用 curl 而非单次 fetch
});
```

> 如果 `bridge.ts` 目前生成的是 Node 脚本而非 shell，断言改为对应的 `for ((i=0;i<3;i++))` / `await new Promise(resolve => setTimeout(...))` 等 Node 关键字。**在写测试前先打开 `bridge.ts` 确认生成形态。**

- [ ] **Step 6：实现重试**

编辑 `packages/server/src/hooks/bridge.ts`，把脚本里裸 POST 的那一段替换为退避重试。以 shell 版为例：

```bash
# 原始（伪）: curl -s -X POST -H "X-Bridge-Token: $TOKEN" --data "$PAYLOAD" "http://127.0.0.1:$PORT/internal/hooks/$EVENT"
# 改为：
for i in 1 2 3; do
  if curl -sS -X POST \
       -H "X-Bridge-Token: $TOKEN" \
       -H "Content-Type: application/json" \
       --data-binary "$PAYLOAD" \
       --max-time 2 \
       "http://127.0.0.1:$PORT/internal/hooks/$EVENT"; then
    exit 0
  fi
  sleep $((i))  # 1s, 2s, 3s 退避
done
echo "coder-studio bridge: POST failed after 3 retries" >&2
exit 1
```

Node 版同理。

- [ ] **Step 7：跑测试确认绿**

```bash
pnpm -w --filter @coder-studio/server test -- bridge
```

- [ ] **Step 8：Commit**

```bash
git add packages/server/src/session/manager.ts \
        packages/server/src/hooks/bridge.ts \
        packages/server/src/hooks/bridge.test.ts \
        packages/server/src/__tests__/*.test.ts
git commit -m "fix: log pending hook event buffering and add 3x retry to bridge POST"
```

---

## Task 3 (A3): PTY kill 的固定 100ms 延迟 → 轮询

**Files:**
- Modify: `packages/server/src/terminal/pty-host.ts`
- Test: `packages/server/src/terminal/pty-host.test.ts`（如果没有就创建）

- [ ] **Step 1：写测试（红）**

```ts
// packages/server/src/terminal/pty-host.test.ts
import { describe, it, expect, vi } from 'vitest';
import { NodePtyHost } from './pty-host.js';

describe('NodePtyHost.kill', () => {
  it('escalates SIGTERM → SIGKILL only if process group is still alive after SIGTERM', async () => {
    vi.useFakeTimers();
    // Spy on process.kill; the first call is SIGTERM to the pg, second is the
    // "is it gone yet" probe (signal 0), third is SIGKILL if still alive.
    const kills: Array<{ pid: number; signal: string | number }> = [];
    const origKill = process.kill;
    (process as any).kill = vi.fn((pid: number, signal: string | number) => {
      kills.push({ pid, signal });
      // Simulate the process actually dying on the 2nd probe tick
      if (kills.length >= 3 && signal === 0) {
        const err: NodeJS.ErrnoException = new Error('no such process');
        err.code = 'ESRCH';
        throw err;
      }
    }) as any;

    try {
      const host = new NodePtyHost();
      // Inject a fake ptyProcess by spying require('node-pty') — or use a test double.
      // Simpler: call the inner logic via its exported helper. If not exported, export
      // `escalateKill(pid)` from pty-host.ts just for testing.
      // ...

      // Assert: no SIGKILL fires on the first probe because the process was still alive;
      // a second probe a tick later sees ESRCH and we bail out.
      // ...
    } finally {
      (process as any).kill = origKill;
      vi.useRealTimers();
    }
  });
});
```

> 实际实现要让 `escalateKill(pid)` 可独立测试，所以下一步会从 `pty-host.ts` 导出一个 helper。

- [ ] **Step 2：重构 pty-host.ts 的 kill 逻辑**

把 `packages/server/src/terminal/pty-host.ts` 第 86-101 行（SIGTERM → 100ms setTimeout → SIGKILL 的那段）替换为：

```ts
if (signal === 'SIGTERM') {
  const killed = killProcessGroup(pid, 'SIGTERM');
  if (!killed) return;
  escalateKill(pid, 2000, 50);  // 2s 上限，50ms 轮询
} else {
  killProcessGroup(pid, signal);
}
```

并在文件顶部 `killProcessGroup` 之下新增并导出：

```ts
/**
 * Poll-then-SIGKILL escalation. Re-probes every `intervalMs` up to `maxMs`;
 * stops the moment the process group is gone (ESRCH). If the group is still
 * alive by `maxMs`, issues a final SIGKILL.
 *
 * Exported for testing.
 */
export function escalateKill(pid: number, maxMs: number, intervalMs: number): void {
  const start = Date.now();
  const tick = (): void => {
    try {
      process.kill(-pid, 0); // probe
    } catch {
      return; // gone
    }
    if (Date.now() - start >= maxMs) {
      killProcessGroup(pid, 'SIGKILL');
      return;
    }
    setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
}
```

- [ ] **Step 3：用这个 helper 重写测试（现在测试文件只 import `escalateKill` + mock `process.kill`）**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escalateKill } from './pty-host.js';

describe('escalateKill', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('bails out as soon as probe throws ESRCH', () => {
    let probeCount = 0;
    const spy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig: any) => {
      if (sig === 0) {
        probeCount++;
        if (probeCount >= 2) {
          const e = new Error('nope') as NodeJS.ErrnoException;
          e.code = 'ESRCH';
          throw e;
        }
        return true;
      }
      return true;
    }) as any);

    escalateKill(12345, 2000, 50);
    vi.advanceTimersByTime(200);

    // Should have probed twice and never sent SIGKILL
    expect(spy.mock.calls.filter((c) => c[1] === 'SIGKILL')).toHaveLength(0);
    spy.mockRestore();
  });

  it('sends SIGKILL once maxMs elapses and probe still succeeds', () => {
    const spy = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);
    escalateKill(12345, 100, 20);
    vi.advanceTimersByTime(500);
    expect(spy.mock.calls.some((c) => c[1] === 'SIGKILL')).toBe(true);
    spy.mockRestore();
  });
});
```

- [ ] **Step 4：测试通过**

```bash
pnpm -w --filter @coder-studio/server test -- pty-host
```

- [ ] **Step 5：Commit**

```bash
git add packages/server/src/terminal/pty-host.ts \
        packages/server/src/terminal/pty-host.test.ts
git commit -m "perf: replace fixed 100ms SIGTERM→SIGKILL delay with bounded polling"
```

---

## PR-1 收尾

- [ ] 全量 baseline：`pnpm -w typecheck && pnpm -w test`
- [ ] 开 PR，标题：`fix: session/PTY lifecycle hardening (Phase A)`
- [ ] PR 描述贴上 A1/A2/A3 各自的"这修什么"一段话

**Rollback：** 每个 task 是独立 commit，单 commit revert 即可。

---

# PR-2 / Phase B1 — Terminal 事件归并到 EventBus

**目标：** 让 Terminal 的 output/exit/created 事件统一走 EventBus，WsHub 作为唯一 broadcaster（订阅 EventBus 翻译成 WS 事件）。TerminalManager 不再直接持有 `Broadcaster`。

**为什么要做：** PR-1 用"回调"桥接了 exit；它是权宜之计。此 PR 统一后：Supervisor 可以订阅 Terminal 事件、替换 broadcast 实现更容易、后续 PR-3 的 reverse index 放在 SessionManager 也更自然。

**Files:**
- Modify: `packages/core/src/domain/events.ts`（新增 3 个事件类型）
- Modify: `packages/server/src/terminal/manager.ts`（去掉 broadcaster，改发 EventBus）
- Modify: `packages/server/src/ws/hub.ts`（subscribe 新事件 → WS topic）
- Modify: `packages/server/src/server.ts`（不再把 broadcaster 传给 TerminalManager；PR-1 的 `onTerminalExit` 回调改为 EventBus subscribe）
- Modify: `packages/server/src/session/manager.ts`（subscribe `terminal.exited` 取代 PR-1 的 callback）
- Modify: `packages/core/src/protocol/topics.ts`（新增 `terminalCreated` topic builder）
- Test: `packages/server/src/__tests__/terminal-events.test.ts`（新增）
- Test: 所有 terminal / session / ws hub 相关测试（迁移 mock）

---

## Task 1：在 core 新增 terminal domain events

- [ ] **Step 1：扩展 `DomainEvent` 联合**

编辑 `packages/core/src/domain/events.ts`：

```ts
import type { Workspace, SessionState } from './types';

export type DomainEvent =
  | { type: 'session.state.changed'; sessionId: string; workspaceId?: string; from: SessionState; to: SessionState; session?: import('./types').Session }
  | { type: 'session.lifecycle'; sessionId: string; workspaceId?: string; event: 'started' | 'turn_completed' | 'stopped' | 'removed' }
  | { type: 'workspace.meta.changed'; workspaceId: string; patch: Partial<Workspace> }
  | { type: 'git.state.changed'; workspaceId: string }
  | { type: 'fs.dirty'; workspaceId: string; reason: string }
  // --- new ---
  | { type: 'terminal.created'; workspaceId: string; terminalId: string; kind: 'agent' | 'shell'; title: string; cwd: string }
  | { type: 'terminal.output'; workspaceId: string; terminalId: string; chunk: Buffer; seq: number }
  | { type: 'terminal.exited'; workspaceId: string; terminalId: string; exitCode: number };
```

> `chunk: Buffer` 保留二进制，翻译 layer 再做 base64。

- [ ] **Step 2：Topic builder 补齐**

编辑 `packages/core/src/protocol/topics.ts`，给现有 `Topics.terminalOutput` / `Topics.terminalExit` 下面加：

```ts
terminalCreated: (workspaceId: string, terminalId: string) =>
  `workspace.${workspaceId}.terminal.${terminalId}.created`,
```

- [ ] **Step 3：`pnpm -w --filter @coder-studio/core test`**

预期 PASS（纯类型扩展）。

- [ ] **Step 4：Commit**

```bash
git add packages/core/src/domain/events.ts packages/core/src/protocol/topics.ts
git commit -m "feat(core): add terminal.created / terminal.output / terminal.exited domain events"
```

---

## Task 2：TerminalManager 改发 EventBus（去掉 broadcaster 依赖）

- [ ] **Step 1：写新测试 `terminal-events.test.ts`**

```ts
// packages/server/src/__tests__/terminal-events.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TerminalManager } from '../terminal/manager.js';
import { EventBus } from '../bus/event-bus.js';
import type { PtyHost, PtyProcess, DomainEvent } from '../terminal/types.js'; // DomainEvent from core

describe('TerminalManager emits domain events via EventBus', () => {
  function makePty(): { pty: PtyProcess; pushData: (s: string) => void; triggerExit: (code: number) => void } {
    let onData: any, onExit: any;
    return {
      pty: {
        onData: (cb) => { onData = cb; },
        onExit: (cb) => { onExit = cb; },
        write: () => {}, resize: () => {}, kill: () => {},
      },
      pushData: (s) => onData(s),
      triggerExit: (code) => onExit({ exitCode: code }),
    };
  }

  it('emits terminal.created on create, terminal.output on data, terminal.exited on exit', () => {
    const { pty, pushData, triggerExit } = makePty();
    const ptyHost: PtyHost = { spawn: () => pty };
    const eventBus = new EventBus();
    const seen: DomainEvent[] = [];
    eventBus.on('terminal.created', (e) => seen.push(e));
    eventBus.on('terminal.output', (e) => seen.push(e));
    eventBus.on('terminal.exited', (e) => seen.push(e));

    const mgr = new TerminalManager({
      ptyHost,
      eventBus,
      db: { insert: () => {}, markEnded: () => {} } as any,
    });
    const t = mgr.create({ workspaceId: 'ws1', kind: 'shell', argv: ['sh'], cwd: '/' });

    expect(seen[0]).toMatchObject({ type: 'terminal.created', terminalId: t.id });

    pushData('hello');
    expect(seen[1]).toMatchObject({ type: 'terminal.output', terminalId: t.id, seq: 1 });

    triggerExit(0);
    expect(seen.at(-1)).toMatchObject({ type: 'terminal.exited', terminalId: t.id, exitCode: 0 });
  });
});
```

- [ ] **Step 2：跑测试确认红**

```bash
pnpm -w --filter @coder-studio/server test -- terminal-events
```
预期：FAIL — 构造函数还在要 broadcaster、不接受 eventBus。

- [ ] **Step 3：改造 `TerminalManager` 依赖**

编辑 `packages/server/src/terminal/manager.ts`：

1) `import type` 行追加 `DomainEvent` from core 及 `EventBus`：
```ts
import type { DomainEvent } from '@coder-studio/core';
import type { EventBus } from '../bus/event-bus.js';
```

2) 删除构造函数里的 `broadcaster` 字段，改为：
```ts
constructor(
  private readonly deps: {
    ptyHost: PtyHost;
    eventBus: EventBus;
    db: TerminalDatabase;
  }
) {}
```

3) `create()` 里原先的 `this.deps.broadcaster.broadcast(...created...)` 替换为：
```ts
this.deps.eventBus.emit({
  type: 'terminal.created',
  workspaceId: spec.workspaceId,
  terminalId: id,
  kind: spec.kind,
  title: spec.title ?? '',
  cwd: spec.cwd,
} satisfies DomainEvent);
```

4) `wireEvents()` 里的 `onData` 分支：
```ts
pty.onData((data: string) => {
  const buffer = Buffer.from(data, 'utf-8');
  const { seq } = ringBuffer.append(buffer);
  this.deps.eventBus.emit({
    type: 'terminal.output',
    workspaceId: spec.workspaceId,
    terminalId: id,
    chunk: buffer,
    seq,
  } satisfies DomainEvent);
});
```

5) `wireEvents()` 里的 `onExit` 分支，去掉 `broadcaster.broadcast(...exit...)` 与 PR-1 的 `exitListeners` 循环，改为：
```ts
pty.onExit(({ exitCode }: { exitCode: number }) => {
  active.alive = false;
  active.exitCode = exitCode;
  this.archivedReplayBuffers.set(id, ringBuffer);

  this.deps.eventBus.emit({
    type: 'terminal.exited',
    workspaceId: spec.workspaceId,
    terminalId: id,
    exitCode,
  } satisfies DomainEvent);

  setTimeout(() => { this.terminals.delete(id); }, 1000);
  this.deps.db.markEnded(id, Date.now(), exitCode);
});
```

6) 删除 PR-1 新增的 `exitListeners` 字段和 `onTerminalExit(...)` 方法（职责转移给 EventBus）。

- [ ] **Step 4：测试通过**

```bash
pnpm -w --filter @coder-studio/server test -- terminal-events
```

- [ ] **Step 5：先只 commit manager 改动**

```bash
git add packages/server/src/terminal/manager.ts \
        packages/server/src/__tests__/terminal-events.test.ts
git commit -m "refactor(terminal): emit terminal.* domain events via EventBus instead of broadcasting directly"
```

---

## Task 3：WsHub 订阅新事件并翻译为 WS topic

- [ ] **Step 1：扩展 `subscribeToEvents()` 的白名单**

编辑 `packages/server/src/ws/hub.ts:178-184`：

```ts
const eventTypes: DomainEvent['type'][] = [
  'session.state.changed',
  'session.lifecycle',
  'workspace.meta.changed',
  'git.state.changed',
  'fs.dirty',
  'terminal.created',
  'terminal.output',
  'terminal.exited',
];
```

- [ ] **Step 2：在 `handleDomainEvent` 增加新 case**

在 `switch (event.type)` 内追加（`Topics` 已经有 builder，用它）：

```ts
import { Topics } from '@coder-studio/core';

// ... existing cases ...

case 'terminal.created':
  topic = Topics.terminalCreated(event.workspaceId, event.terminalId);
  data = {
    id: event.terminalId,
    kind: event.kind,
    title: event.title,
    cwd: event.cwd,
    workspaceId: event.workspaceId,
  };
  break;

case 'terminal.output':
  topic = Topics.terminalOutput(event.workspaceId, event.terminalId);
  data = {
    chunk: event.chunk.toString('base64'),
    size: event.chunk.length,
    seq: event.seq,
  };
  break;

case 'terminal.exited':
  topic = Topics.terminalExit(event.workspaceId, event.terminalId);
  data = { code: event.exitCode };
  break;
```

- [ ] **Step 3：写测试 `packages/server/src/__tests__/ws-hub.test.ts`**（如不存在则创建，已存在则 append）

```ts
it('translates terminal.output DomainEvent to WS topic with base64 chunk', () => {
  const eventBus = new EventBus();
  const sent: Array<{ topic: string; data: any }> = [];
  const client = makeFakeClient({
    subscribes: ['workspace.ws1.terminal.t1.output'],
    capture: sent,
  });
  const hub = new WsHub({ eventBus, /* ... */ } as any);
  hub.addClient(client);

  eventBus.emit({
    type: 'terminal.output',
    workspaceId: 'ws1',
    terminalId: 't1',
    chunk: Buffer.from('hi'),
    seq: 42,
  });

  expect(sent[0]).toEqual({
    topic: 'workspace.ws1.terminal.t1.output',
    data: { chunk: Buffer.from('hi').toString('base64'), size: 2, seq: 42 },
  });
});
```

- [ ] **Step 4：测试绿**

- [ ] **Step 5：Commit**

```bash
git add packages/server/src/ws/hub.ts packages/server/src/__tests__/ws-hub.test.ts
git commit -m "refactor(ws): translate terminal.* domain events to legacy WS topics inside WsHub"
```

---

## Task 4：server.ts wiring + SessionManager 改订阅 EventBus（替换 PR-1 的回调）

- [ ] **Step 1：server.ts wiring**

编辑 `packages/server/src/server.ts`：

- `TerminalManager` 的构造去掉 `broadcaster`，新增 `eventBus`（已经可用）。
- 删除 PR-1 加的 `terminalMgr.onTerminalExit(...)` 调用。
- 新增：
```ts
// Session lifecycle mirrors PTY lifecycle: when the PTY dies, session ends.
// Subscription is implicit — SessionManager constructor wires it internally.
```

- [ ] **Step 2：SessionManager 在构造函数订阅 `terminal.exited`**

编辑 `packages/server/src/session/manager.ts`：

构造函数正文追加：
```ts
constructor(private readonly deps: SessionManagerDeps) {
  this.deps.eventBus.on('terminal.exited', (event) => {
    this.onTerminalExit(event.terminalId, event.exitCode);
  });
}
```

`onTerminalExit` 方法本身保持不变（PR-1 已经能用）。

- [ ] **Step 3：改其它被 broadcaster 打破的测试**

`pnpm -w --filter @coder-studio/server test` 里会有一些测试 mock 了旧的 broadcaster；把它们改为 mock EventBus。典型改法：

```ts
// before
const broadcaster = { broadcast: vi.fn() };
const mgr = new TerminalManager({ ptyHost, broadcaster, db });

// after
const eventBus = new EventBus();
const seen: any[] = [];
eventBus.on('terminal.output', (e) => seen.push(e));
const mgr = new TerminalManager({ ptyHost, eventBus, db });
```

逐个文件改直到 green。涉及的文件至少包含：
- `packages/server/src/__tests__/session-integration.test.ts`
- `packages/server/src/__tests__/session-manager-delete.test.ts`
- `packages/server/src/__tests__/terminal-commands.test.ts`
- `packages/server/src/__tests__/codex-hook-integration.test.ts`

- [ ] **Step 4：e2e 回归**

```bash
pnpm -w typecheck
pnpm -w test
pnpm -w --filter @coder-studio/e2e test -- --grep "terminal"
```

前端在 PR-2 不用改：topic 名字、payload shape 都保持向后兼容。

- [ ] **Step 5：Commit**

```bash
git add packages/server/src/server.ts \
        packages/server/src/session/manager.ts \
        packages/server/src/__tests__/
git commit -m "refactor(session): subscribe to terminal.exited DomainEvent (replaces PR-1 callback)"
```

---

## PR-2 收尾

- [ ] 开 PR，标题：`refactor: unify terminal lifecycle events through EventBus (Phase B1)`
- [ ] PR 描述明确列出新 DomainEvent 类型、向前端的 topic 完全兼容。

**Rollback：** 因为 topic 名字没变，回滚只改服务端代码就好，不会影响已经上线的前端。

---

# PR-3 / Phase B2 — SessionManager 成为 PTY owner

**目标：**
1. SessionManager 维护 `terminalId → sessionId` 反向索引，替换掉多处 O(n) 的 `for (const session of this.sessions.values())` 扫描；
2. SessionManager 暴露 session 粒度的 API：`sendInput(sessionId, bytes, activity?)`、`resize(sessionId, cols, rows)`、`stop(sessionId)`、`getOutputTail(sessionId, bytes?)`；
3. `TerminalManager.writeToSession` / `getSessionOutput` 两个"假装自己认识 session"的方法**删除**（在 PR-4 改 supervisor 后）。

本 PR 只做**加法**（加 API + 加索引），不改任何 caller，保持可独立发布/回滚。

**Files:**
- Modify: `packages/server/src/session/manager.ts`
- Modify: `packages/server/src/terminal/manager.ts`（暴露 `getRingBufferTail(id, bytes)`，给 SessionManager 用）
- Test: `packages/server/src/__tests__/session-manager-api.test.ts`（新增）

---

## Task 1：TerminalManager 暴露 ring buffer tail

- [ ] **Step 1：红测试**

```ts
// packages/server/src/__tests__/terminal-ring-buffer-tail.test.ts
it('returns the last N bytes of the ring buffer', () => {
  const { pty, pushData } = makePty();
  const mgr = new TerminalManager({ ptyHost: { spawn: () => pty }, eventBus: new EventBus(), db: fakeDb });
  const t = mgr.create({ workspaceId: 'w', kind: 'shell', argv: ['sh'], cwd: '/' });
  pushData('abcdefghij');
  expect(mgr.getRingBufferTail(t.id, 4).toString()).toBe('ghij');
});
```

- [ ] **Step 2：实现**

在 `TerminalManager`（`packages/server/src/terminal/manager.ts`）类内加：

```ts
/**
 * Read the last `bytes` bytes of the terminal's ring buffer. Returns empty
 * Buffer if the terminal is unknown. Used by Supervisor / Session for
 * lightweight output sampling — heavy reads should use replay().
 */
getRingBufferTail(terminalId: TerminalId, bytes: number): Buffer {
  const terminal = this.terminals.get(terminalId) ??
    ({ ringBuffer: this.archivedReplayBuffers.get(terminalId) } as any);
  if (!terminal.ringBuffer) return Buffer.alloc(0);
  return terminal.ringBuffer.tail(bytes);
}
```

然后确保 `RingBuffer` 有 `tail(bytes: number): Buffer` 方法。如果没有就在 `packages/server/src/terminal/ring-buffer.ts` 加上（纯 slice）并补单测。

- [ ] **Step 3：测试绿 → commit**

```bash
git add packages/server/src/terminal/manager.ts \
        packages/server/src/terminal/ring-buffer.ts \
        packages/server/src/__tests__/terminal-ring-buffer-tail.test.ts
git commit -m "feat(terminal): expose ring buffer tail accessor for session-level reads"
```

---

## Task 2：SessionManager 反向索引 + session 级 API

- [ ] **Step 1：红测试（`session-manager-api.test.ts`）**

```ts
import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../session/manager.js';
import { EventBus } from '../bus/event-bus.js';
import { TerminalManager } from '../terminal/manager.js';
import type { PtyHost } from '../terminal/types.js';
import { makeInMemoryTerminalDb, makeInMemorySessionDb, makeStubProvider } from './helpers.js';

describe('SessionManager session-level API', () => {
  function setup() {
    const ptyWrites: Buffer[] = [];
    const ptyResizes: Array<[number, number]> = [];
    const pty = {
      onData: () => {}, onExit: () => {},
      write: (b: Buffer) => ptyWrites.push(Buffer.isBuffer(b) ? b : Buffer.from(b)),
      resize: (c: number, r: number) => ptyResizes.push([c, r]),
      kill: vi.fn(),
    };
    const ptyHost: PtyHost = { spawn: () => pty as any };
    const eventBus = new EventBus();
    const terminalMgr = new TerminalManager({ ptyHost, eventBus, db: makeInMemoryTerminalDb() });
    const sessionMgr = new SessionManager({
      terminalMgr, eventBus,
      db: makeInMemorySessionDb(),
      broadcaster: { broadcast: () => {} },
      providerRegistry: [makeStubProvider({ hasSessionStart: false })],
      providerConfigRepo: { get: () => ({}) } as any,
    });
    return { sessionMgr, terminalMgr, pty, ptyWrites, ptyResizes };
  }

  it('sendInput writes to PTY and updates session activity (submit)', async () => {
    const { sessionMgr, ptyWrites } = setup();
    const s = await sessionMgr.create({
      workspaceId: 'w', workspacePath: '/', providerId: 'stub',
      provider: makeStubProvider({ hasSessionStart: false }),
    });

    sessionMgr.sendInput(s.id, Buffer.from('hello\r'), 'submit');

    expect(ptyWrites[0].toString()).toBe('hello\r');
    expect(sessionMgr.get(s.id)?.state).toBe('running');
  });

  it('resize forwards to PTY', async () => {
    const { sessionMgr, ptyResizes } = setup();
    const s = await sessionMgr.create({ /* ... */ } as any);
    sessionMgr.resize(s.id, 100, 40);
    expect(ptyResizes[0]).toEqual([100, 40]);
  });

  it('getOutputTail returns last N bytes from ring buffer', async () => {
    const { sessionMgr } = setup();
    // Simulate PTY output, then assert sessionMgr.getOutputTail(...)
  });

  it('throws friendly error on unknown sessionId', () => {
    const { sessionMgr } = setup();
    expect(() => sessionMgr.sendInput('sess_nope', Buffer.from('x'))).toThrow(/Session not found/);
  });
});
```

- [ ] **Step 2：跑测试确认红**

- [ ] **Step 3：实现反向索引与 API**

编辑 `packages/server/src/session/manager.ts`：

1) 类字段追加：
```ts
private terminalToSession = new Map<string, string>();
```

2) `create()` 内，拿到 `terminal.id` 之后（现在 `active.terminalId = terminal.id` 那行之后）追加：
```ts
this.terminalToSession.set(terminal.id, sessionId);
```

3) `resume()` 内，新 terminal 创建后：
```ts
// 旧 terminal 解绑
if (existing.terminalId) this.terminalToSession.delete(existing.terminalId);
this.terminalToSession.set(terminal.id, sessionId);
```

4) `delete()` / `onTerminalExit` 内清理：
```ts
this.terminalToSession.delete(session.terminalId); // delete 里，session.terminalId 还在
```

5) 新增公开 API（放在 `onTerminalInput` 下面）：

```ts
/**
 * Session-level input: writes to the underlying PTY and drives the session
 * state machine. This is the single entry point — commands/ should never
 * reach into terminalMgr directly.
 */
sendInput(
  sessionId: string,
  bytes: Buffer,
  activity: 'typing' | 'submit' | 'system' = 'typing'
): void {
  const session = this.sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  this.deps.terminalMgr.write(session.terminalId, bytes);
  const text = activity === 'submit' ? bytes.toString('utf-8') : undefined;
  this.onTerminalInput(session.terminalId, activity, text);
}

/**
 * Session-level resize.
 */
resize(sessionId: string, cols: number, rows: number): void {
  const session = this.sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  this.deps.terminalMgr.resize(session.terminalId, cols, rows);
}

/**
 * Read last N bytes of the session's terminal output. Supervisors use this
 * to sample state without subscribing to the full output stream.
 */
getOutputTail(sessionId: string, bytes: number = 4096): Buffer {
  const session = this.sessions.get(sessionId);
  if (!session) return Buffer.alloc(0);
  return this.deps.terminalMgr.getRingBufferTail(session.terminalId, bytes);
}
```

6) 把 `onTerminalInput` 和 `onTerminalExit` 的 for 循环替换成反向索引查询：

```ts
onTerminalInput(terminalId: string, activity = 'typing', text?: string): void {
  const sessionId = this.terminalToSession.get(terminalId);
  if (!sessionId) return;
  const session = this.sessions.get(sessionId);
  if (!session) return;
  // ... 原有逻辑不变，只是不再 for-loop ...
}

onTerminalExit(terminalId: string, exitCode: number): void {
  const sessionId = this.terminalToSession.get(terminalId);
  if (!sessionId) return;
  const session = this.sessions.get(sessionId);
  if (!session) return;
  // ... 原有逻辑 ...
  this.terminalToSession.delete(terminalId);
}
```

7) `hydrate()` 时恢复反向索引：
```ts
this.terminalToSession.set(session.terminalId, session.id);
```

- [ ] **Step 4：测试绿**

```bash
pnpm -w --filter @coder-studio/server test -- session-manager-api
```

- [ ] **Step 5：Commit**

```bash
git add packages/server/src/session/manager.ts \
        packages/server/src/__tests__/session-manager-api.test.ts
git commit -m "feat(session): add sendInput/resize/getOutputTail + reverse terminalId index"
```

---

## PR-3 收尾

- [ ] baseline 跑通。不会有 caller 改变行为（没人调新 API 也不影响）。
- [ ] 开 PR，标题：`feat: SessionManager owns PTY — session-level API (Phase B2)`

**Rollback：** 纯加法。直接 revert。

---

# PR-4 / Phase B3 — 命令层瘦身 + supervisor 改接 SessionManager + DTO 收敛

**目标：**
1. `commands/terminal.ts` 的 `terminal.input` / `terminal.resize` 改成只调 `sessionMgr.sendInput` / `sessionMgr.resize`；
2. supervisor 的 `writeToSession` / `getSessionOutput` 调用点全部切到 SessionManager；
3. 删除 `TerminalManager.writeToSession` / `getSessionOutput`；
4. 把 `server.ts` 内散落的 `rowToSession` 和 `session/manager.ts` 内的 `SessionRow` 转换集中到 `packages/server/src/storage/repositories/session-repo.ts`。

**为什么 1+2+3+4 一起：** 1/2/3 是同一件事（删 TerminalManager 的"假装认识 session"表面）；4 独立但小，合并省一次 PR 审视。

**Files:**
- Modify: `packages/server/src/commands/terminal.ts`
- Modify: `packages/server/src/supervisor/*.ts`（查 `writeToSession` / `getSessionOutput` 调用点）
- Modify: `packages/server/src/terminal/manager.ts`（删两个 supervisor helper 方法）
- Modify: `packages/server/src/storage/repositories/session-repo.ts`（集中 mapper）
- Modify: `packages/server/src/server.ts`（删除自己写的 `rowToSession`）
- Modify: `packages/server/src/session/manager.ts`（`ActiveSession.toRow()` 借用 mapper；可选）
- Modify: `packages/server/src/ws/dispatch.ts`（command ctx 里 terminalMgr 的使用面会缩小，评估是否仍需注入）

---

## Task 1：命令层 `terminal.input` / `terminal.resize` 切换到 sessionMgr

- [ ] **Step 1：红测试改造**

看 `packages/server/src/__tests__/terminal-commands.test.ts`，针对 `terminal.input` 的测试：原来 assert `terminalMgr.write` 被调用；改为 assert `sessionMgr.sendInput` 被调用。

```ts
it('terminal.input delegates to sessionMgr.sendInput', async () => {
  const sendInput = vi.fn();
  const ctx = makeCtx({ sessionMgr: { sendInput } as any });
  await runCommand('terminal.input', { terminalId: 't1', bytes: Buffer.from('hi').toString('base64'), activity: 'submit' }, ctx);
  expect(sendInput).toHaveBeenCalledTimes(1);
  // 注意：命令参数还是 terminalId（前端不变），但内部要 resolve 到 sessionId
  // 如果决定把前端命令重命名为 session.input 请在同一 PR 做，但更稳妥是保持向后兼容
});
```

由于前端以 `terminalId` 为 key，本 PR **不改前端合约**。命令层先做 terminalId → sessionId 的 lookup。方法：

- [ ] **Step 2：在 SessionManager 增加 lookup（如果 PR-3 没暴露公开 getter 就加一个）**

```ts
findSessionIdByTerminal(terminalId: string): string | undefined {
  return this.terminalToSession.get(terminalId);
}
```

- [ ] **Step 3：改 `commands/terminal.ts` 的 `terminal.input` handler**

```ts
registerCommand(
  'terminal.input',
  z.object({
    terminalId: z.string(),
    bytes: z.string(),
    activity: z.enum(['typing', 'submit', 'system']).optional(),
  }),
  async (args, ctx) => {
    const buffer = Buffer.from(args.bytes, 'base64');
    const sessionId = ctx.sessionMgr.findSessionIdByTerminal(args.terminalId);
    if (sessionId) {
      ctx.sessionMgr.sendInput(sessionId, buffer, args.activity);
    } else {
      // Shell terminals (kind='shell') have no session wrapper — bypass to PTY.
      // This is the only remaining case where commands reach terminalMgr.
      ctx.terminalMgr.write(args.terminalId, buffer);
    }
  }
);
```

`terminal.resize` 同样改：

```ts
registerCommand(
  'terminal.resize',
  z.object({ terminalId: z.string(), cols: z.number().int().positive(), rows: z.number().int().positive() }),
  async (args, ctx) => {
    const sessionId = ctx.sessionMgr.findSessionIdByTerminal(args.terminalId);
    if (sessionId) ctx.sessionMgr.resize(sessionId, args.cols, args.rows);
    else ctx.terminalMgr.resize(args.terminalId, args.cols, args.rows);
  }
);
```

- [ ] **Step 4：测试绿** `pnpm -w --filter @coder-studio/server test -- terminal-commands`

- [ ] **Step 5：Commit**

```bash
git add packages/server/src/commands/terminal.ts \
        packages/server/src/session/manager.ts \
        packages/server/src/__tests__/terminal-commands.test.ts
git commit -m "refactor(commands): route terminal.input/resize through SessionManager when a session owns the terminal"
```

---

## Task 2：Supervisor 改调 SessionManager；删除 TerminalManager 的 writeToSession / getSessionOutput

- [ ] **Step 1：找调用点**

```bash
grep -rn 'writeToSession\|getSessionOutput' packages/server/src
```
预期命中 supervisor（`supervisor/context-builder.ts` 或 `supervisor/manager.ts`）和 `terminal/manager.ts` 的定义。

- [ ] **Step 2：改 supervisor**

典型改法（把 ctx 里的 `terminalMgr` 换成 `sessionMgr`）：

```ts
// before
const output = this.deps.terminalMgr.getSessionOutput(sessionId);
this.deps.terminalMgr.writeToSession(sessionId, instruction);

// after
const output = this.deps.sessionMgr.getOutputTail(sessionId, 8192).toString('utf-8');
this.deps.sessionMgr.sendInput(sessionId, Buffer.from(instruction), 'system');
```

- [ ] **Step 3：删掉 TerminalManager 的两个方法**

`packages/server/src/terminal/manager.ts` 的 `writeToSession` 和 `getSessionOutput` 整段删除。

- [ ] **Step 4：跑测试 → 绿**

`pnpm -w test` 如果 supervisor 相关 test 挂了，对应调整。

- [ ] **Step 5：Commit**

```bash
git add packages/server/src/supervisor/ \
        packages/server/src/terminal/manager.ts
git commit -m "refactor(supervisor): read/write through SessionManager; drop TerminalManager.writeToSession/getSessionOutput"
```

---

## Task 3：DTO / SessionRow 映射集中到 session-repo

- [ ] **Step 1：找 `rowToSession`**

```bash
grep -rn 'rowToSession\b' packages/server/src
```
预期在 `server.ts:287-329` 有一处手写实现。

- [ ] **Step 2：把 mapper 搬到 `storage/repositories/session-repo.ts`**

```ts
// packages/server/src/storage/repositories/session-repo.ts
import type { Session, SessionState } from '@coder-studio/core';
import type { SessionRow } from '../../session/manager.js';

export function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    terminalId: row.terminal_id,
    providerId: row.provider_id,
    state: row.state as SessionState,
    resumeId: row.resume_id ?? undefined,
    capability: row.capability as Session['capability'],
    startedAt: row.started_at ?? row.last_active_at,
    lastActiveAt: row.last_active_at,
    endedAt: row.ended_at ?? undefined,
    completionPercent: row.completion_percent ?? undefined,
    errorReason: row.error_reason ?? undefined,
    transcriptPath: row.transcript_path ?? undefined,
    title: row.title ?? undefined,
  };
}

export function sessionToRow(session: Session & { draft?: string }): SessionRow {
  return {
    id: session.id,
    workspace_id: session.workspaceId,
    terminal_id: session.terminalId,
    provider_id: session.providerId,
    state: session.state,
    resume_id: session.resumeId ?? null,
    capability: session.capability,
    started_at: session.startedAt ?? null,
    last_active_at: session.lastActiveAt,
    ended_at: session.endedAt ?? null,
    completion_percent: session.completionPercent ?? null,
    error_reason: session.errorReason ?? null,
    draft: session.draft ?? null,
    transcript_path: session.transcriptPath ?? null,
    title: session.title ?? null,
  };
}
```

- [ ] **Step 3：在 `server.ts` 里 import 替代**

```ts
import { rowToSession } from './storage/repositories/session-repo.js';
```
删除 `server.ts` 里原有的 `rowToSession` 本地定义。

- [ ] **Step 4：ActiveSession.toRow() 用 `sessionToRow`（可选）**

如果愿意把 `session/manager.ts` 里的 `toRow()` 实现换成调用 mapper，就 import 使用。保持 `toDTO()` 和 `toRow()` 语义，但内部只有一处真实映射逻辑。

- [ ] **Step 5：测试绿，commit**

```bash
git add packages/server/src/storage/repositories/session-repo.ts \
        packages/server/src/server.ts \
        packages/server/src/session/manager.ts
git commit -m "refactor(storage): centralize SessionRow ↔ Session mapping in session-repo"
```

---

## PR-4 收尾

- [ ] baseline 跑通。
- [ ] 开 PR，标题：`refactor: command layer routes through SessionManager; supervisor reads via SessionManager (Phase B3)`

**Rollback：** Task 1 和 Task 2 有依赖（删 `writeToSession` 之后才能回收；如果要回滚只到 Task 1，要先恢复 supervisor 的旧调用）。最干净的回滚是整个 PR revert。

---

# PR-5 / Phase C — Provider capability 定语化 + Topics 全量迁移 + 错误栈保留

**目标：**
1. `ProviderDefinition.capability` 仅作为 UI 展示标签，状态机只看 `hooks.events.*`；
2. 所有前后端 topic 字符串改用 `Topics` builder；
3. Supervisor 的错误处理保留 `err.stack`、改走 logger。

---

## Task 1：状态机只依赖 `hooks.events`

`session/manager.ts:133-134` 已经这样做了，但注释提到"capability"还在作为保险。此任务扫清其它可能间接依赖的地方。

- [ ] **Step 1：搜索 capability 在 session/supervisor 代码的使用**

```bash
grep -rn "\.capability\b" packages/server/src packages/providers/src | grep -v '\.test\.'
```

对每个命中位置评估：是否在做"决定某段行为要不要走"的判断？如果是，改为判断对应的 `hooks.events.X`。

- [ ] **Step 2：给 ProviderDefinition.capability 加 JSDoc**

在 `packages/core/src/provider/definition.ts`，给 `capability` 字段注释：

```ts
/**
 * Declarative label used only for UI badges and docs. State-machine behavior
 * MUST read `hooks.events.*` directly — `capability: 'full'` does not imply
 * any specific hook being present.
 */
capability: 'full' | 'limited' | 'unsupported';
```

- [ ] **Step 3：Session 状态机测试：Codex 和 Claude 在同一测试表格下的期望**

新增 `packages/server/src/__tests__/session-state-machine.test.ts`：

```ts
describe.each([
  { name: 'claude-like', hooks: { sessionStart: true, turnCompleted: true, stop: true } },
  { name: 'codex-like',  hooks: { sessionStart: false, turnCompleted: true, stop: true } },
])('Session state machine — $name', ({ name, hooks }) => {
  it(`creates in starting, then ${hooks.sessionStart ? 'waits for SessionStart hook' : 'optimistically lands in idle'}`, async () => {
    // ...
  });
  it('transitions to ended when PTY exits', async () => { /* ... */ });
  it('transitions to running on submit from idle', async () => { /* ... */ });
  it('transitions back to idle on TurnCompleted/Stop', async () => { /* ... */ });
});
```

全部 PASS 即证明状态机纯由 `hooks.events` 驱动。

- [ ] **Step 4：Commit**

```bash
git add packages/core/src/provider/definition.ts \
        packages/server/src/__tests__/session-state-machine.test.ts
git commit -m "docs: mark ProviderDefinition.capability as UI-only; add state-machine parity tests"
```

---

## Task 2：Topics 全量迁移

- [ ] **Step 1：清点硬编码 topic**

```bash
grep -rn "'workspace\." packages/ | grep -v 'node_modules\|dist\|\.test\.'
grep -rn '`workspace\.' packages/ | grep -v 'node_modules\|dist\|\.test\.'
```

- [ ] **Step 2：逐处替换**

典型替换：

```ts
// before
broadcaster.broadcast(`workspace.${ws}.terminal.${id}.output`, payload);

// after
import { Topics } from '@coder-studio/core';
broadcaster.broadcast(Topics.terminalOutput(ws, id), payload);
```

前端同理（`packages/web/src/features/...`）。

- [ ] **Step 3：增加 ESLint 规则 "no raw workspace topic"**

在 `.eslintrc.cjs` 或对应的 eslint config 添加：

```js
{
  files: ['packages/**/*.{ts,tsx}'],
  excludedFiles: ['packages/core/src/protocol/topics.ts'],
  rules: {
    'no-restricted-syntax': [
      'warn',
      {
        selector: "Literal[value=/^workspace\\./]",
        message: 'Use Topics.* builders from @coder-studio/core instead of raw topic strings.',
      },
      {
        selector: "TemplateLiteral[quasis.0.value.raw=/^workspace\\./]",
        message: 'Use Topics.* builders from @coder-studio/core instead of raw topic strings.',
      },
    ],
  },
}
```

- [ ] **Step 4：`pnpm -w lint` 保持 green**

- [ ] **Step 5：Commit**

```bash
git add .
git commit -m "refactor: migrate all 'workspace.*' topic strings to Topics builder; lint guards raw strings"
```

---

## Task 3：Supervisor 错误处理保留 stack

- [ ] **Step 1：找 supervisor 里 try/catch**

`packages/server/src/supervisor/manager.ts:485-510` 附近那段捕获只保留 message 的代码。

- [ ] **Step 2：替换错误转换**

```ts
// before
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return { status: 'failed', reason: message };
}

// after
} catch (err) {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error('Supervisor cycle failed', { sessionId, err: e.stack ?? e.message });
  return { status: 'failed', reason: e.message };
}
```

对整个 supervisor 模块做同样的扫描。

- [ ] **Step 3：加一条测试断言 console.error 被调用（用 spy）**

在相关 test 里：

```ts
const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
// trigger failure path
expect(errSpy).toHaveBeenCalledWith(
  expect.stringContaining('Supervisor cycle failed'),
  expect.objectContaining({ err: expect.stringContaining('at ') })  // stack
);
```

- [ ] **Step 4：Commit**

```bash
git add packages/server/src/supervisor/
git commit -m "fix(supervisor): preserve error stack in logs; keep user-facing reason terse"
```

---

## PR-5 收尾

- [ ] 全量 baseline + e2e。
- [ ] 开 PR：`chore: tighten provider capability semantics, topic safety, and supervisor error handling (Phase C)`。

---

# 全局 Self-Review 清单（写完/执行中对照）

- [ ] **Spec 覆盖**：问题 1/2/3/4/5/6/7/8/9 的每一条能指到具体 PR 的具体 Task？
  - 1 → PR-1 Task1 + PR-2 Task4
  - 2 → PR-3 Task2
  - 3 → PR-4 Task1
  - 4 → PR-2 Task2+Task3
  - 5 → PR-1 Task2
  - 6 → PR-5 Task1
  - 7 → PR-5 Task2
  - 8（SessionRow/DTO）→ PR-4 Task3；supervisor stack → PR-5 Task3
  - 9（kill 固定延迟）→ PR-1 Task3；supervisor getSessionOutput 返回空 → PR-3 Task1 + PR-4 Task2
- [ ] **没有占位符**：每个 Task 要么给完整代码、要么给完整 grep/replace 指令。
- [ ] **类型一致**：`SessionManager.sendInput(sessionId, bytes, activity?)` 在 PR-3 声明、在 PR-4 被 commands 调用、在 PR-4 被 supervisor 调用，签名全对齐。
- [ ] **提交范围**：按用户 memory 要求，每个 PR 的提交要把对应的 docs 更新/验收报告也带上（如果有）。
- [ ] **最终交付物**：5 个 PR、每个 1-4 个 commit、总计 ~2000 行 diff。

---

# 执行选择

落盘完成，两条路：

1. **Subagent-Driven（推荐）**：我每个 Task 起一个新的 subagent，做完我审，再起下一个。能保持 main context 干净、单 Task 失败时易回退。
2. **Inline Execution**：这个会话直接顺着 Task 1 → Task N 执行，遇到 checkpoint 我停下来让你审。

你说哪个。
