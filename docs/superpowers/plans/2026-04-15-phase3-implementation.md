# Phase 3 Full PRD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 3 features as defined in `docs/superpowers/specs/2026-04-13-coder-studio-design.md`: Supervisor System, Worktree Management, and Multi-tab Concurrency (Controller/Observer model).

**Architecture:** Building on Phase 1 + Phase 2 foundation. Server adds `supervisor/` and `git/worktree.ts` modules. Web adds `features/supervisor/` and updates workspace/git features. WebSocket protocol extends with supervisor topics and fencing tokens.

**Tech Stack:** Existing stack + additional: LLM integration for supervisor evaluation (Claude API), git worktree CLI, BroadcastChannel API for cross-tab communication.

---

## Phase 3 Features

### 1. Supervisor System (PRD §16)
Automated evaluation system for Agent sessions:
- States: Inactive, Idle, Evaluating, Injecting, Paused, Error
- Supervisor Objective Dialog for defining evaluation criteria
- Evaluation cycles: Queued → Evaluating → Completed/Injected/Failed
- Actions: Edit Objective, Pause, Resume, Retry, Trigger, Disable

### 2. Worktree Management (PRD §10.3)
Git worktree inspection modal:
- Header: Worktree name, branch chip, path chip, status chip
- Three tabs: Status Tab, Diff Tab, Tree Tab
- Worktree commands: list, create, remove

### 3. Multi-tab Concurrency (PRD §7.6)
Controller/Observer model:
- One Controller tab with fencing token
- Observer tabs receive updates but can't modify workspace state
- Heartbeats: 10s visible, 20s hidden
- Takeover protocol when controller unresponsive

---

## File Structure

### Server (packages/server/src/)
```
supervisor/
├── scheduler.ts      # Cycle scheduling, debounce
├── evaluator.ts      # LLM-based progress evaluation
├── injector.ts       # Guidance injection into session
├── manager.ts        # Supervisor lifecycle management
└── types.ts          # Supervisor state types

git/
└── worktree.ts       # git worktree CLI wrapper

ws/
└── fencing.ts        # Controller/Observer token management
```

### Web (packages/web/src/)
```
features/
└── supervisor/
    ├── index.tsx
    ├── components/
    │   ├── supervisor-card.tsx
    │   └── objective-dialog.tsx
    └── atoms.ts

features/workspace/
└── components/
    └── worktree-modal.tsx

atoms/
└── fencing.ts        # Controller/Observer state
```

### E2E Tests (e2e/specs/phase3/)
```
supervisor.spec.ts
worktree.spec.ts
multi-tab.spec.ts
```

---

## Implementation Order

1. **Supervisor Core** - Server-side types, manager, scheduler
2. **Supervisor Evaluator** - LLM integration for progress evaluation
3. **Supervisor UI** - Card component, objective dialog
4. **Worktree Backend** - git worktree CLI wrapper
5. **Worktree Modal** - UI for worktree inspection
6. **Multi-tab Fencing** - Controller/Observer protocol
7. **Phase 3 E2E Tests** - Acceptance tests

---

## Task 1: Supervisor Core Types and Manager

**Files:**
- Create: `packages/server/src/supervisor/types.ts`
- Create: `packages/server/src/supervisor/manager.ts`
- Create: `packages/core/src/domain/supervisor.ts`

- [ ] **Step 1: Define supervisor types in core package**

```typescript
// packages/core/src/domain/supervisor.ts
export type SupervisorState =
  | 'inactive'
  | 'idle'
  | 'evaluating'
  | 'injecting'
  | 'paused'
  | 'error';

export type CycleStatus =
  | 'queued'
  | 'evaluating'
  | 'completed'
  | 'injected'
  | 'failed';

export interface SupervisorCycle {
  id: string;
  sessionId: string;
  status: CycleStatus;
  objective: string;
  result?: string;
  injectedGuidance?: string;
  createdAt: number;
  completedAt?: number;
}

export interface Supervisor {
  id: string;
  sessionId: string;
  state: SupervisorState;
  objective: string;
  cycles: SupervisorCycle[];
  lastCycleAt?: number;
  errorReason?: string;
  createdAt: number;
}
```

- [ ] **Step 2: Create SupervisorManager**

```typescript
// packages/server/src/supervisor/manager.ts
import type { Supervisor, SupervisorCycle, SupervisorState } from '@coder-studio/core';

export class SupervisorManager {
  private supervisors = new Map<string, Supervisor>();

  async create(sessionId: string, objective: string): Promise<Supervisor>;
  async update(id: string, objective: string): Promise<Supervisor>;
  async delete(id: string): Promise<void>;
  async pause(id: string): Promise<void>;
  async resume(id: string): Promise<void>;
  async triggerEvaluation(id: string): Promise<SupervisorCycle>;
  getBySession(sessionId: string): Supervisor | undefined;
}
```

- [ ] **Step 3: Add supervisor WebSocket commands**

Extend command handlers in `packages/server/src/ws/dispatch.ts`:
- `supervisor.create`
- `supervisor.update`
- `supervisor.delete`
- `supervisor.pause`
- `supervisor.resume`
- `supervisor.trigger`

- [ ] **Step 4: Add supervisor topics**

```typescript
// packages/core/src/protocol/topics.ts
workspace.<id>.session.<sid>.supervisor.cycle
```

---

## Task 2: Supervisor Evaluator (LLM Integration)

**Files:**
- Create: `packages/server/src/supervisor/evaluator.ts`
- Create: `packages/server/src/supervisor/injector.ts`
- Create: `packages/server/src/supervisor/scheduler.ts`

- [ ] **Step 1: Create evaluator with Claude API**

```typescript
// packages/server/src/supervisor/evaluator.ts
export interface EvaluationResult {
  progress: number; // 0-100
  summary: string;
  guidance?: string; // Optional guidance to inject
  shouldInject: boolean;
}

export async function evaluateProgress(
  objective: string,
  sessionTerminal: string, // Last N lines of terminal output
  gitDiff?: string
): Promise<EvaluationResult>;
```

- [ ] **Step 2: Create injector for guidance injection**

```typescript
// packages/server/src/supervisor/injector.ts
export async function injectGuidance(
  sessionId: string,
  guidance: string
): Promise<void>;
```

- [ ] **Step 3: Create scheduler for periodic evaluation**

```typescript
// packages/server/src/supervisor/scheduler.ts
export class SupervisorScheduler {
  scheduleEvaluation(supervisorId: string, intervalMs: number): void;
  cancelSchedule(supervisorId: string): void;
}
```

---

## Task 3: Supervisor UI

**Files:**
- Create: `packages/web/src/features/supervisor/index.tsx`
- Create: `packages/web/src/features/supervisor/components/supervisor-card.tsx`
- Create: `packages/web/src/features/supervisor/components/objective-dialog.tsx`
- Create: `packages/web/src/features/supervisor/atoms.ts`

- [ ] **Step 1: Create supervisor atoms**

```typescript
// packages/web/src/features/supervisor/atoms.ts
export const supervisorsAtom = atom<Map<string, Supervisor>>(new Map());
export const supervisorCyclesAtom = atom<Map<string, SupervisorCycle[]>>(new Map());
```

- [ ] **Step 2: Create SupervisorCard component**

Display in agent pane when supervisor is active:
- State tag (evaluating, injecting, paused, error, off)
- Action buttons (edit, pause/resume, retry, trigger, disable)

- [ ] **Step 3: Create ObjectiveDialog component**

Modal for defining/editing supervisor objective:
- Objective textarea (5 rows, autofocus)
- Preview section
- Cancel/Confirm buttons

- [ ] **Step 4: Add "Enable Supervisor" button in agent pane**

Shows when session is active and no supervisor configured.

---

## Task 4: Worktree Management

**Files:**
- Create: `packages/server/src/git/worktree.ts`
- Create: `packages/web/src/features/workspace/components/worktree-modal.tsx`
- Add command: `worktree.list`, `worktree.inspect`

- [ ] **Step 1: Create worktree CLI wrapper**

```typescript
// packages/server/src/git/worktree.ts
export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  status: 'clean' | 'dirty';
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]>;
export async function getWorktreeStatus(worktreePath: string): Promise<GitStatus>;
export async function getWorktreeDiff(worktreePath: string): Promise<string>;
```

- [ ] **Step 2: Create WorktreeModal component**

Three tabs:
- Status Tab: path, branch, status, file changes
- Diff Tab: text-based diff
- Tree Tab: file tree view

- [ ] **Step 3: Add worktree trigger in git panel**

Button to open worktree modal when multiple worktrees exist.

---

## Task 5: Multi-tab Concurrency (Controller/Observer)

**Files:**
- Create: `packages/server/src/ws/fencing.ts`
- Create: `packages/web/src/atoms/fencing.ts`
- Update: `packages/server/src/ws/hub.ts`

- [ ] **Step 1: Implement fencing token in WsHub**

```typescript
// packages/server/src/ws/fencing.ts
export interface FencingToken {
  clientId: string;
  issuedAt: number;
  expiresAt: number;
}

export class FencingManager {
  issueToken(workspaceId: string, clientId: string): FencingToken;
  validateToken(workspaceId: string, token: FencingToken): boolean;
  revokeToken(workspaceId: string): void;
}
```

- [ ] **Step 2: Add heartbeat protocol**

Client sends heartbeat, server tracks:
- 10s interval when tab visible
- 20s interval when tab hidden

- [ ] **Step 3: Implement takeover protocol**

When controller doesn't heartbeat within deadline:
1. Server marks controller as unresponsive
2. Observer can request takeover
3. Old controller demoted to observer

- [ ] **Step 4: Add observer mode UI**

When not controller:
- Show "Read-only mode" indicator
- Disable write actions (start session, file edit, git operations)

---

## Task 6: Phase 3 E2E Tests

**Files:**
- Create: `e2e/specs/phase3/supervisor.spec.ts`
- Create: `e2e/specs/phase3/worktree.spec.ts`
- Create: `e2e/specs/phase3/multi-tab.spec.ts`

- [ ] **Step 1: Supervisor acceptance tests**
  - P3S-01: Enable supervisor on session
  - P3S-02: Edit objective
  - P3S-03: Pause/resume supervisor
  - P3S-04: Trigger manual evaluation
  - P3S-05: View evaluation cycle result
  - P3S-06: Disable supervisor

- [ ] **Step 2: Worktree acceptance tests**
  - P3W-01: Open worktree modal
  - P3W-02: View worktree status tab
  - P3W-03: View worktree diff tab
  - P3W-04: View worktree tree tab

- [ ] **Step 3: Multi-tab concurrency tests**
  - P3M-01: First tab becomes controller
  - P3M-02: Second tab is observer
  - P3M-03: Observer cannot modify workspace
  - P3M-04: Controller takeover when original unresponsive
  - P3M-05: Tab refresh maintains controller role

---

## Self-Review Checklist

Before marking this plan complete, verify:

- [ ] **Placeholder scan** — No "TBD", "TODO", or incomplete sections
- [ ] **Internal consistency** — File paths, package names, and architecture decisions are consistent
- [ ] **Scope check** — Plan covers all Phase 3 features from design spec
- [ ] **Ambiguity check** — All technical decisions are explicit
- [ ] **TDD compliance** — Every code task starts with a failing test
- [ ] **Backward compatibility** — Phase 1 and Phase 2 tests remain passing
- [ ] **Extension points** — New code uses reserved slots from earlier phases

---

## Estimated Timeline

| Task | Duration |
|------|----------|
| Supervisor Core | 1 week |
| Supervisor Evaluator | 1.5 weeks |
| Supervisor UI | 1 week |
| Worktree Management | 1 week |
| Multi-tab Concurrency | 1.5 weeks |
| E2E Tests & Polish | 1 week |
| **Total** | **7 weeks** |

---

## Dependencies

- Phase 1 & Phase 2 must be complete (✓)
- Claude API access for supervisor evaluation
- Git worktree CLI (included in git 2.5+)

---

## Next Steps

1. User reviews this plan
2. Execute via subagent-driven-development
3. Run Phase 3 acceptance after implementation
4. Manual verification
5. Commit and tag `v0.3.0-phase3`
