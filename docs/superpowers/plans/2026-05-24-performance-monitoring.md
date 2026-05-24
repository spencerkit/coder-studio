# Performance Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class `/monitoring` experience that shows host CPU and memory pressure, Coder Studio runtime footprint, and `workspace -> session/agent -> subprocess` attribution with configurable sampling, explicit degradation states, and a settings-driven enable switch.

**Architecture:** Add a shared `monitoring` domain in `@coder-studio/core`, a server-owned `MonitoringService` that samples host and managed-process data on a configurable interval, and a routed web page that loads the current snapshot once and stays updated via `monitoring.snapshot.updated`. Sampling remains disabled by default, settings own all mutability, and the UI is read-only, with clear disabled and partial-collection empty states instead of ambiguous failures.

**Tech Stack:** TypeScript, React 19, Jotai, Vitest, Testing Library, Node `os`, existing websocket command dispatch, existing server settings storage, existing `node-pty` PTY host, and shared styles in `packages/web/src/styles/components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-24-monitoring-design.md`

**Git hygiene:** The main worktree already contains unrelated user edits. Stage only the files listed in each task, do not revert user changes, and commit the plan file before creating the implementation worktree so the execution branch can consume it directly.

---

## File Structure

**New files:**
- `packages/core/src/domain/monitoring.ts` — shared monitoring types, settings helpers, interval validation, mode derivation, and empty-state factories
- `packages/core/src/domain/monitoring.test.ts` — shared monitoring helper coverage and topic contract assertions
- `packages/server/src/monitoring/types.ts` — server-only collector, registry, and telemetry contracts
- `packages/server/src/monitoring/managed-process-registry.ts` — internal registry for server, terminal, and background process roots plus late session binding
- `packages/server/src/monitoring/host-collector.ts` — host metrics sampling with CPU deltas, memory, uptime, and load average capability handling
- `packages/server/src/monitoring/process-table/darwin.ts` — macOS `ps` adapter
- `packages/server/src/monitoring/process-table/linux.ts` — Linux `ps` adapter
- `packages/server/src/monitoring/process-table/win32.ts` — Windows PowerShell adapter
- `packages/server/src/monitoring/process-table/index.ts` — platform adapter selection and process-row parsing orchestration
- `packages/server/src/monitoring/aggregation.ts` — tree indexing, host pressure derivation, runtime summary, workspace/session grouping, and subprocess truncation
- `packages/server/src/monitoring/history-store.ts` — bounded in-memory history retention for host/runtime/workspace/session/subprocess series
- `packages/server/src/monitoring/service.ts` — settings-driven lifecycle, sampling scheduler, broadcasting, immediate recheck, and runtime synchronization
- `packages/server/src/commands/monitoring.ts` — websocket commands for `monitoring.get` and `monitoring.recheck`
- `packages/server/src/__tests__/monitoring/managed-process-registry.test.ts` — registry behavior and late session binding tests
- `packages/server/src/__tests__/monitoring/host-collector.test.ts` — host metric delta, load average capability, and pressure calculation tests
- `packages/server/src/__tests__/monitoring/process-table.test.ts` — parser and platform adapter normalization tests
- `packages/server/src/__tests__/monitoring/aggregation.test.ts` — runtime/workspace/session/subprocess aggregation and degradation tests
- `packages/server/src/__tests__/monitoring/service.test.ts` — service scheduling, history trimming, broadcasting, and partial-failure tests
- `packages/server/src/__tests__/monitoring/commands.test.ts` — command dispatch coverage for `monitoring.get` and `monitoring.recheck`
- `packages/server/src/__tests__/server-monitoring-hydration.test.ts` — persisted settings, server startup wiring, and stop cleanup verification
- `packages/web/src/features/monitoring/index.ts` — feature exports
- `packages/web/src/features/monitoring/page.tsx` — routed monitoring page with desktop/mobile variants, disabled and degraded states, refresh, sorting, and time-window controls
- `packages/web/src/features/monitoring/sparkline.tsx` — lightweight SVG sparkline renderer for short-term history
- `packages/web/src/features/monitoring/formatters.ts` — byte, percent, uptime, load-average, and timestamp format helpers
- `packages/web/src/features/monitoring/page.test.tsx` — page rendering, subscription, refresh, disabled state, partial-collection, and mobile behavior tests
- `packages/web/src/features/settings/components/monitoring-settings-card.tsx` — reusable `Settings > General` monitoring configuration block

**Modified files:**
- `packages/core/src/domain/types.ts` — add optional `pid` to the shared `Terminal` DTO
- `packages/core/src/index.ts` — export monitoring domain types
- `packages/core/src/protocol/topics.ts` — add `monitoring.snapshot.updated`
- `packages/server/src/terminal/types.ts` — expose PTY `pid` as a first-class runtime property
- `packages/server/src/terminal/active-terminal.ts` — persist `pid` into terminal DTOs
- `packages/server/src/terminal/pty-host.ts` — forward `node-pty` process PID through the abstraction
- `packages/server/src/terminal/manager.ts` — keep terminal DTOs PID-aware and ensure active terminals stay queryable for monitoring sync
- `packages/server/src/storage/repositories/terminal-repo.ts` — persist and hydrate terminal `pid`
- `packages/server/src/terminal/active-terminal.test.ts` — assert `pid` is preserved in DTOs
- `packages/server/src/terminal/manager.test.ts` — update PTY fakes for `pid` and assert DTO persistence
- `packages/server/src/__tests__/terminal-events.test.ts` — update PTY fakes for `pid`
- `packages/server/src/__tests__/session-manager-api.test.ts` — update PTY fakes for `pid`
- `packages/server/src/__tests__/session-integration.test.ts` — update PTY fakes for `pid`
- `packages/server/src/__tests__/session-terminal-exit.test.ts` — update PTY fakes for `pid`
- `packages/server/src/__tests__/terminal-ring-buffer-tail.test.ts` — update PTY fakes for `pid`
- `packages/server/src/commands/settings.ts` — extend settings schema with monitoring keys and trigger monitoring reloads on relevant updates
- `packages/server/src/commands/settings.test.ts` — cover monitoring settings persistence and reload hooks
- `packages/server/src/commands/index.ts` — register monitoring commands
- `packages/server/src/server.ts` — construct `ManagedProcessRegistry` and `MonitoringService`, hydrate them from persisted settings, and stop them cleanly
- `packages/server/src/ws/dispatch.ts` — inject `monitoringService` into command context
- `packages/web/src/shells/desktop-shell.tsx` — route `/monitoring` and bypass auth-loading for it
- `packages/web/src/shells/mobile-shell/index.tsx` — route `/monitoring` and bypass auth-loading for it
- `packages/web/src/shells/desktop-shell.test.tsx` — auth-bypass and route assertions for `/monitoring`
- `packages/web/src/shells/mobile-shell/index.test.tsx` — auth-bypass and route assertions for `/monitoring`
- `packages/web/src/features/command-palette/components/command-palette.tsx` — add `Open Monitoring`
- `packages/web/src/features/command-palette/components/command-palette.test.tsx` — verify `Open Monitoring` command on desktop and mobile
- `packages/web/src/features/settings/components/settings-page.tsx` — hydrate monitoring settings, persist updates, and mount the monitoring settings card inside `General`
- `packages/web/src/features/settings/components/settings-page.test.tsx` — verify monitoring settings interactions, dependency rules, and disabled-state controls
- `packages/web/src/locales/en.json` — monitoring page, settings, and command-palette copy
- `packages/web/src/locales/zh.json` — Chinese monitoring copy
- `packages/web/src/styles/components.css` — monitoring page, settings card, sparklines, tree/detail layout, empty states, and mobile tabs
- `packages/web/src/styles/components.theme.test.ts` — lock monitoring surfaces to theme tokens

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/core exec vitest run src/domain/monitoring.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/terminal/active-terminal.test.ts src/terminal/manager.test.ts src/__tests__/terminal-events.test.ts src/__tests__/session-manager-api.test.ts src/__tests__/session-integration.test.ts src/__tests__/session-terminal-exit.test.ts src/__tests__/terminal-ring-buffer-tail.test.ts`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/monitoring/managed-process-registry.test.ts src/__tests__/monitoring/host-collector.test.ts src/__tests__/monitoring/process-table.test.ts src/__tests__/monitoring/aggregation.test.ts src/__tests__/monitoring/service.test.ts src/__tests__/monitoring/commands.test.ts src/__tests__/server-monitoring-hydration.test.ts src/commands/settings.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/monitoring/page.test.tsx src/features/settings/components/settings-page.test.tsx src/features/command-palette/components/command-palette.test.tsx src/shells/desktop-shell.test.tsx src/shells/mobile-shell/index.test.tsx src/styles/components.theme.test.ts`
- `pnpm ci:typecheck`

---

### Task 1: Add The Shared Monitoring Domain And Topic Contract

**Files:**
- Create: `packages/core/src/domain/monitoring.ts`
- Create: `packages/core/src/domain/monitoring.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/protocol/topics.ts`

- [ ] **Step 1: Write the failing shared-domain test**

Add `packages/core/src/domain/monitoring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Topics } from "../protocol/topics";
import {
  MONITORING_SAMPLE_INTERVAL_OPTIONS,
  createDefaultMonitoringSettings,
  deriveMonitoringMode,
  isMonitoringSampleIntervalMs,
  resolveMonitoringSettings,
} from "./monitoring";

describe("monitoring domain helpers", () => {
  it("creates the default monitoring settings shape", () => {
    expect(createDefaultMonitoringSettings()).toEqual({
      enabled: false,
      hostMetricsEnabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
      subprocessDrilldownEnabled: false,
      sampleIntervalMs: 2000,
    });
  });

  it("exposes the supported sample intervals", () => {
    expect(MONITORING_SAMPLE_INTERVAL_OPTIONS).toEqual([1000, 2000, 5000, 10000]);
    expect(isMonitoringSampleIntervalMs(2000)).toBe(true);
    expect(isMonitoringSampleIntervalMs(3000)).toBe(false);
  });

  it("derives mode labels after applying dependency normalization", () => {
    expect(
      deriveMonitoringMode(
        resolveMonitoringSettings({
          "monitoring.enabled": false,
        })
      )
    ).toBe("disabled");

    expect(
      deriveMonitoringMode(
        resolveMonitoringSettings({
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": false,
          "monitoring.workspaceAttributionEnabled": false,
          "monitoring.subprocessDrilldownEnabled": false,
        })
      )
    ).toBe("light");

    expect(
      deriveMonitoringMode(
        resolveMonitoringSettings({
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": true,
          "monitoring.workspaceAttributionEnabled": true,
          "monitoring.subprocessDrilldownEnabled": false,
        })
      )
    ).toBe("standard");

    expect(
      deriveMonitoringMode(
        resolveMonitoringSettings({
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": true,
          "monitoring.workspaceAttributionEnabled": true,
          "monitoring.subprocessDrilldownEnabled": true,
        })
      )
    ).toBe("deep");
  });

  it("defines the websocket topic for monitoring snapshot broadcasts", () => {
    expect(Topics.monitoringSnapshotUpdated).toBe("monitoring.snapshot.updated");
  });
});
```

- [ ] **Step 2: Run the core test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/monitoring.test.ts
```

Expected: FAIL because `monitoring.ts` and `Topics.monitoringSnapshotUpdated` do not exist yet.

- [ ] **Step 3: Add the shared monitoring types, helpers, and topic**

Create `packages/core/src/domain/monitoring.ts`:

```ts
export const MONITORING_SAMPLE_INTERVAL_OPTIONS = [1000, 2000, 5000, 10000] as const;
export const DEFAULT_MONITORING_SAMPLE_INTERVAL_MS = 2000;

export type MonitoringSampleIntervalMs = (typeof MONITORING_SAMPLE_INTERVAL_OPTIONS)[number];
export type MonitoringMode = "disabled" | "light" | "standard" | "deep";
export type MonitoringPressure = "normal" | "elevated" | "hot" | "unknown";

export interface MonitoringSettings {
  enabled: boolean;
  hostMetricsEnabled: boolean;
  runtimeSummaryEnabled: boolean;
  workspaceAttributionEnabled: boolean;
  subprocessDrilldownEnabled: boolean;
  sampleIntervalMs: MonitoringSampleIntervalMs;
}

export interface MonitoringSeriesPoint {
  sampledAt: number;
  cpuPercent: number | null;
  memoryBytes: number | null;
  processCount?: number;
}

export interface MonitoringHostSummary {
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  loadAverage: [number, number, number] | null;
  uptimeSec: number | null;
  pressure: MonitoringPressure;
}

export interface MonitoringRuntimeSummary {
  serverCpuPercent: number | null;
  serverMemoryBytes: number | null;
  totalManagedCpuPercent: number | null;
  totalManagedMemoryBytes: number | null;
  managedProcessCount: number;
  cpuShareOfHostPercent: number | null;
  memoryShareOfHostPercent: number | null;
}

export interface MonitoringEntitySummary {
  id: string;
  kind: "workspace" | "session" | "subprocess_group" | "background_group";
  parentId?: string;
  workspaceId?: string;
  sessionId?: string;
  terminalId?: string;
  label: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  processCount: number;
  uptimeSec: number | null;
  trend: "rising" | "steady" | "falling" | "unknown";
  childCount?: number;
}

export interface MonitoringSnapshot {
  sampledAt: number;
  mode: MonitoringMode;
  host: MonitoringHostSummary | null;
  runtime: MonitoringRuntimeSummary | null;
  workspaces: MonitoringEntitySummary[];
  sessions: MonitoringEntitySummary[];
  subprocessGroups: MonitoringEntitySummary[];
  backgroundGroups: MonitoringEntitySummary[];
}

export interface MonitoringSeriesBundle {
  points: MonitoringSeriesPoint[];
}

export interface MonitoringHistoryBundle {
  host: MonitoringSeriesBundle;
  runtime: MonitoringSeriesBundle | null;
  workspaces: Record<string, MonitoringSeriesBundle>;
  sessions: Record<string, MonitoringSeriesBundle>;
  subprocessGroups: Record<string, MonitoringSeriesBundle>;
}

export interface MonitoringCapabilities {
  loadAverageAvailable: boolean;
  processMetricsAvailable: boolean;
  subprocessHistoryLimited: boolean;
}

export interface MonitoringSamplingTelemetry {
  durationMs: number;
  processRowCount: number;
  subprocessGroupCount: number;
  historyTrimmed: boolean;
  degraded: boolean;
  failureReason?: string;
}

export interface MonitoringResponse {
  settings: MonitoringSettings;
  snapshot: MonitoringSnapshot;
  history: MonitoringHistoryBundle;
  capabilities: MonitoringCapabilities;
  telemetry: MonitoringSamplingTelemetry | null;
}

export function isMonitoringSampleIntervalMs(
  value: unknown
): value is MonitoringSampleIntervalMs {
  return (
    typeof value === "number" &&
    MONITORING_SAMPLE_INTERVAL_OPTIONS.includes(value as MonitoringSampleIntervalMs)
  );
}

export function createDefaultMonitoringSettings(): MonitoringSettings {
  return {
    enabled: false,
    hostMetricsEnabled: true,
    runtimeSummaryEnabled: true,
    workspaceAttributionEnabled: true,
    subprocessDrilldownEnabled: false,
    sampleIntervalMs: DEFAULT_MONITORING_SAMPLE_INTERVAL_MS,
  };
}

function normalizeMonitoringDependencies(settings: MonitoringSettings): MonitoringSettings {
  if (!settings.workspaceAttributionEnabled) {
    settings.subprocessDrilldownEnabled = false;
  }
  if (!settings.runtimeSummaryEnabled) {
    settings.workspaceAttributionEnabled = false;
    settings.subprocessDrilldownEnabled = false;
  }
  return settings;
}

export function resolveMonitoringSettings(
  values:
    | Record<string, unknown>
    | {
        get: <T = unknown>(key: string) => T | undefined;
      }
    | undefined
): MonitoringSettings {
  const defaults = createDefaultMonitoringSettings();
  const read = (key: string) =>
    values && "get" in values ? values.get(key) : values?.[key];

  return normalizeMonitoringDependencies({
    enabled: typeof read("monitoring.enabled") === "boolean" ? Boolean(read("monitoring.enabled")) : defaults.enabled,
    hostMetricsEnabled:
      typeof read("monitoring.hostMetricsEnabled") === "boolean"
        ? Boolean(read("monitoring.hostMetricsEnabled"))
        : defaults.hostMetricsEnabled,
    runtimeSummaryEnabled:
      typeof read("monitoring.runtimeSummaryEnabled") === "boolean"
        ? Boolean(read("monitoring.runtimeSummaryEnabled"))
        : defaults.runtimeSummaryEnabled,
    workspaceAttributionEnabled:
      typeof read("monitoring.workspaceAttributionEnabled") === "boolean"
        ? Boolean(read("monitoring.workspaceAttributionEnabled"))
        : defaults.workspaceAttributionEnabled,
    subprocessDrilldownEnabled:
      typeof read("monitoring.subprocessDrilldownEnabled") === "boolean"
        ? Boolean(read("monitoring.subprocessDrilldownEnabled"))
        : defaults.subprocessDrilldownEnabled,
    sampleIntervalMs: isMonitoringSampleIntervalMs(read("monitoring.sampleIntervalMs"))
      ? (read("monitoring.sampleIntervalMs") as MonitoringSampleIntervalMs)
      : defaults.sampleIntervalMs,
  });
}

export function deriveMonitoringMode(settings: MonitoringSettings): MonitoringMode {
  if (!settings.enabled) {
    return "disabled";
  }
  if (settings.subprocessDrilldownEnabled) {
    return "deep";
  }
  if (settings.workspaceAttributionEnabled) {
    return "standard";
  }
  return "light";
}

export function createEmptyMonitoringResponse(settings = createDefaultMonitoringSettings()): MonitoringResponse {
  return {
    settings,
    snapshot: {
      sampledAt: 0,
      mode: deriveMonitoringMode(settings),
      host: null,
      runtime: null,
      workspaces: [],
      sessions: [],
      subprocessGroups: [],
      backgroundGroups: [],
    },
    history: {
      host: { points: [] },
      runtime: null,
      workspaces: {},
      sessions: {},
      subprocessGroups: {},
    },
    capabilities: {
      loadAverageAvailable: process.platform !== "win32",
      processMetricsAvailable: false,
      subprocessHistoryLimited: false,
    },
    telemetry: null,
  };
}
```

Update `packages/core/src/protocol/topics.ts`:

```ts
  updateStateChanged: "update.state.changed",
  monitoringSnapshotUpdated: "monitoring.snapshot.updated",
```

Update `packages/core/src/index.ts`:

```ts
export * from "./domain/monitoring";
```

- [ ] **Step 4: Run the core test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/monitoring.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the shared monitoring contract**

```bash
git add packages/core/src/domain/monitoring.ts \
  packages/core/src/domain/monitoring.test.ts \
  packages/core/src/protocol/topics.ts \
  packages/core/src/index.ts
git commit -m "feat(core): add monitoring domain contracts"
```

### Task 2: Promote PTY PID To A First-Class Terminal Capability

**Files:**
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/server/src/terminal/types.ts`
- Modify: `packages/server/src/terminal/pty-host.ts`
- Modify: `packages/server/src/terminal/active-terminal.ts`
- Modify: `packages/server/src/storage/repositories/terminal-repo.ts`
- Modify: `packages/server/src/terminal/active-terminal.test.ts`
- Modify: `packages/server/src/terminal/manager.test.ts`
- Modify: `packages/server/src/__tests__/terminal-events.test.ts`
- Modify: `packages/server/src/__tests__/session-manager-api.test.ts`
- Modify: `packages/server/src/__tests__/session-integration.test.ts`
- Modify: `packages/server/src/__tests__/session-terminal-exit.test.ts`
- Modify: `packages/server/src/__tests__/terminal-ring-buffer-tail.test.ts`

- [ ] **Step 1: Write the failing PID persistence tests**

Update `packages/server/src/terminal/active-terminal.test.ts` with PID expectations:

```ts
const mockPty: PtyProcess = {
  pid: 43210,
  onData: () => {},
  onExit: () => {},
  write: () => {},
  resize: () => {},
  kill: async () => {},
};

it("should convert to DTO correctly", () => {
  const dto = active.toDTO();

  expect(dto).toEqual({
    id,
    workspaceId: spec.workspaceId,
    kind: spec.kind,
    title: spec.title,
    cwd: spec.cwd,
    argv: spec.argv,
    cols: spec.cols,
    rows: spec.rows,
    pid: 43210,
    alive: true,
    createdAt,
    endedAt: undefined,
    exitCode: undefined,
  });
});
```

Update `packages/server/src/terminal/manager.test.ts`:

```ts
mockPty = {
  pid: 43210,
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn().mockResolvedValue(undefined),
};

it("should create terminal with PTY process", () => {
  const terminal = manager.create(spec);
  expect(terminal.pid).toBe(43210);
});
```

Update every other PTY fake listed in this task to add `pid: 43210` so the type-level break shows the full blast radius immediately.

- [ ] **Step 2: Run the terminal-focused server tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/terminal/active-terminal.test.ts \
  src/terminal/manager.test.ts \
  src/__tests__/terminal-events.test.ts \
  src/__tests__/session-manager-api.test.ts \
  src/__tests__/session-integration.test.ts \
  src/__tests__/session-terminal-exit.test.ts \
  src/__tests__/terminal-ring-buffer-tail.test.ts
```

Expected: FAIL because `PtyProcess.pid` and `Terminal.pid` do not exist yet.

- [ ] **Step 3: Add PID to the terminal DTO, PTY abstraction, and persistence**

Update `packages/core/src/domain/types.ts`:

```ts
export interface Terminal {
  id: string;
  workspaceId: string;
  kind: "agent" | "shell";
  title: string;
  cwd: string;
  argv: string[];
  env?: Record<string, string>;
  cols: number;
  rows: number;
  pid?: number;
  alive: boolean;
  createdAt: number;
  endedAt?: number;
  exitCode?: number;
}
```

Update `packages/server/src/terminal/types.ts`:

```ts
export interface PtyProcess {
  readonly pid: number;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: { exitCode: number }) => void): void;
  write(data: Buffer | string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): Promise<void>;
}
```

Update `packages/server/src/terminal/pty-host.ts`:

```ts
    return {
      pid: ptyProcess.pid,
      onData: (callback) => {
        ptyProcess.onData(callback);
      },
      onExit: (callback) => {
        ptyProcess.onExit(({ exitCode }: { exitCode: number }) => callback({ exitCode }));
      },
      write: (data) => {
        if (Buffer.isBuffer(data)) {
          ptyProcess.write(data.toString("utf-8"));
        } else {
          ptyProcess.write(data);
        }
      },
      resize: (cols, rows) => {
        ptyProcess.resize(cols, rows);
      },
      kill: async (signal: NodeJS.Signals = "SIGTERM") => {
        const pid = ptyProcess.pid;
        // existing kill logic remains here
      },
    };
```

Update `packages/server/src/terminal/active-terminal.ts`:

```ts
      cols: this.spec.cols ?? 120,
      rows: this.spec.rows ?? 30,
      pid: this.pty.pid > 0 ? this.pty.pid : undefined,
      alive: this.alive,
      createdAt: this.createdAt,
      endedAt: this.alive ? undefined : Date.now(),
      exitCode: this.exitCode,
```

Update `packages/server/src/storage/repositories/terminal-repo.ts`:

```ts
  return (
    typeof value.id === "string" &&
    typeof value.workspaceId === "string" &&
    (value.kind === "agent" || value.kind === "shell") &&
    typeof value.cwd === "string" &&
    Array.isArray(value.argv) &&
    typeof value.cols === "number" &&
    typeof value.rows === "number" &&
    (value.pid === undefined || typeof value.pid === "number") &&
    typeof value.alive === "boolean" &&
    typeof value.createdAt === "number"
  );
```

and in `create()` / `insert()`:

```ts
      pid: terminal.pid,
```

Keep the test fake updates minimal: add `pid: 43210` to each `PtyProcess` literal and keep the rest of the test body unchanged except for the new DTO assertions.

- [ ] **Step 4: Run the terminal-focused server tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/terminal/active-terminal.test.ts \
  src/terminal/manager.test.ts \
  src/__tests__/terminal-events.test.ts \
  src/__tests__/session-manager-api.test.ts \
  src/__tests__/session-integration.test.ts \
  src/__tests__/session-terminal-exit.test.ts \
  src/__tests__/terminal-ring-buffer-tail.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the PID promotion**

```bash
git add packages/core/src/domain/types.ts \
  packages/server/src/terminal/types.ts \
  packages/server/src/terminal/pty-host.ts \
  packages/server/src/terminal/active-terminal.ts \
  packages/server/src/storage/repositories/terminal-repo.ts \
  packages/server/src/terminal/active-terminal.test.ts \
  packages/server/src/terminal/manager.test.ts \
  packages/server/src/__tests__/terminal-events.test.ts \
  packages/server/src/__tests__/session-manager-api.test.ts \
  packages/server/src/__tests__/session-integration.test.ts \
  packages/server/src/__tests__/session-terminal-exit.test.ts \
  packages/server/src/__tests__/terminal-ring-buffer-tail.test.ts
git commit -m "feat(server): expose managed terminal pids"
```

### Task 3: Build The Managed Process Registry

**Files:**
- Create: `packages/server/src/monitoring/types.ts`
- Create: `packages/server/src/monitoring/managed-process-registry.ts`
- Create: `packages/server/src/__tests__/monitoring/managed-process-registry.test.ts`

- [ ] **Step 1: Write the failing registry tests**

Create `packages/server/src/__tests__/monitoring/managed-process-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ManagedProcessRegistry } from "../../monitoring/managed-process-registry.js";

describe("ManagedProcessRegistry", () => {
  it("registers the server process only once", () => {
    const registry = new ManagedProcessRegistry({ now: () => 10 });

    registry.registerServerProcess(9001);
    registry.registerServerProcess(9001);

    expect(registry.listRoots()).toEqual([
      expect.objectContaining({
        ownerId: "server:9001",
        rootPid: 9001,
        kind: "server",
        label: "Coder Studio server",
      }),
    ]);
  });

  it("stores terminal roots before a session binding exists and patches them later", () => {
    const registry = new ManagedProcessRegistry({ now: () => 20 });

    registry.upsertTerminalRoot({
      terminalId: "term-1",
      workspaceId: "ws-1",
      pid: 43210,
      kind: "agent",
      title: "Claude",
    });

    registry.bindSessionToTerminal("term-1", {
      sessionId: "sess-1",
      providerId: "claude",
      label: "Claude",
    });

    expect(registry.listRoots()).toEqual([
      expect.objectContaining({
        ownerId: "terminal:term-1",
        rootPid: 43210,
        workspaceId: "ws-1",
        sessionId: "sess-1",
        providerId: "claude",
      }),
    ]);
  });

  it("unregisters terminal roots cleanly", () => {
    const registry = new ManagedProcessRegistry({ now: () => 30 });

    registry.upsertTerminalRoot({
      terminalId: "term-1",
      workspaceId: "ws-1",
      pid: 43210,
      kind: "shell",
      title: "bash",
    });

    registry.unregisterByOwner("terminal:term-1");

    expect(registry.listRoots()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the registry test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/monitoring/managed-process-registry.test.ts
```

Expected: FAIL because the registry does not exist yet.

- [ ] **Step 3: Implement the registry and its server-only contracts**

Create `packages/server/src/monitoring/types.ts`:

```ts
export interface ManagedProcessRoot {
  ownerId: string;
  rootPid: number;
  kind: "server" | "terminal" | "session_helper" | "lsp" | "installer" | "background";
  label: string;
  workspaceId?: string;
  sessionId?: string;
  terminalId?: string;
  providerId?: string;
  startedAt: number;
}

export interface MonitoringCollectorTelemetry {
  processRowCount: number;
  subprocessGroupCount: number;
  historyTrimmed: boolean;
  degraded: boolean;
  failureReason?: string;
}

export interface ProcessStatRow {
  pid: number;
  ppid: number;
  cpuPercent: number | null;
  rssBytes: number | null;
  elapsedSec?: number;
  command?: string;
  executable?: string;
}
```

Create `packages/server/src/monitoring/managed-process-registry.ts`:

```ts
import type { ManagedProcessRoot } from "./types.js";

export class ManagedProcessRegistry {
  private readonly roots = new Map<string, ManagedProcessRoot>();

  constructor(private readonly deps: { now?: () => number } = {}) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  registerServerProcess(pid: number): void {
    this.roots.set(`server:${pid}`, {
      ownerId: `server:${pid}`,
      rootPid: pid,
      kind: "server",
      label: "Coder Studio server",
      startedAt: this.now(),
    });
  }

  upsertTerminalRoot(input: {
    terminalId: string;
    workspaceId: string;
    pid?: number;
    kind: "agent" | "shell";
    title: string;
  }): void {
    if (!input.pid || input.pid <= 0) {
      return;
    }

    const ownerId = `terminal:${input.terminalId}`;
    const existing = this.roots.get(ownerId);
    this.roots.set(ownerId, {
      ownerId,
      rootPid: input.pid,
      kind: "terminal",
      label: input.kind === "shell" ? input.title || "Standalone terminal" : input.title || "Agent terminal",
      workspaceId: input.workspaceId,
      terminalId: input.terminalId,
      sessionId: existing?.sessionId,
      providerId: existing?.providerId,
      startedAt: existing?.startedAt ?? this.now(),
    });
  }

  bindSessionToTerminal(
    terminalId: string,
    input: { sessionId: string; providerId?: string; label: string }
  ): void {
    const ownerId = `terminal:${terminalId}`;
    const existing = this.roots.get(ownerId);
    if (!existing) {
      return;
    }

    this.roots.set(ownerId, {
      ...existing,
      sessionId: input.sessionId,
      providerId: input.providerId,
      label: input.label || existing.label,
    });
  }

  registerBackgroundRoot(root: ManagedProcessRoot): void {
    this.roots.set(root.ownerId, root);
  }

  unregisterByOwner(ownerId: string): void {
    this.roots.delete(ownerId);
  }

  listRoots(): ManagedProcessRoot[] {
    return [...this.roots.values()].sort((left, right) => left.startedAt - right.startedAt);
  }
}
```

- [ ] **Step 4: Run the registry test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/monitoring/managed-process-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the managed process registry**

```bash
git add packages/server/src/monitoring/types.ts \
  packages/server/src/monitoring/managed-process-registry.ts \
  packages/server/src/__tests__/monitoring/managed-process-registry.test.ts
git commit -m "feat(server): add managed process registry"
```

### Task 4: Add Host And Process Table Collectors

**Files:**
- Create: `packages/server/src/monitoring/host-collector.ts`
- Create: `packages/server/src/monitoring/process-table/darwin.ts`
- Create: `packages/server/src/monitoring/process-table/linux.ts`
- Create: `packages/server/src/monitoring/process-table/win32.ts`
- Create: `packages/server/src/monitoring/process-table/index.ts`
- Create: `packages/server/src/__tests__/monitoring/host-collector.test.ts`
- Create: `packages/server/src/__tests__/monitoring/process-table.test.ts`

- [ ] **Step 1: Write the failing collector tests**

Create `packages/server/src/__tests__/monitoring/host-collector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HostCollector } from "../../monitoring/host-collector.js";

describe("HostCollector", () => {
  it("computes cpu deltas and host pressure", () => {
    const collector = new HostCollector({
      platform: "linux",
      cpus: () => [
        { times: { user: 100, nice: 0, sys: 0, idle: 900, irq: 0 } },
        { times: { user: 100, nice: 0, sys: 0, idle: 900, irq: 0 } },
      ] as NodeJS.CpuInfo[],
      totalmem: () => 1000,
      freemem: () => 300,
      uptime: () => 120,
      loadavg: () => [0.4, 0.3, 0.2],
    });

    collector.collect();
    const summary = collector.collect({
      cpus: [
        { times: { user: 160, nice: 0, sys: 0, idle: 940, irq: 0 } },
        { times: { user: 160, nice: 0, sys: 0, idle: 940, irq: 0 } },
      ] as NodeJS.CpuInfo[],
    });

    expect(summary.cpuPercent).toBe(75);
    expect(summary.memoryUsedBytes).toBe(700);
    expect(summary.pressure).toBe("elevated");
  });

  it("marks load average unavailable on windows without failing the snapshot", () => {
    const collector = new HostCollector({
      platform: "win32",
      cpus: () => [{ times: { user: 10, nice: 0, sys: 0, idle: 90, irq: 0 } }] as NodeJS.CpuInfo[],
      totalmem: () => 1000,
      freemem: () => 600,
      uptime: () => 60,
      loadavg: () => [0, 0, 0],
    });

    const summary = collector.collect();

    expect(summary.loadAverage).toBeNull();
    expect(summary.pressure).toBe("unknown");
  });
});
```

Create `packages/server/src/__tests__/monitoring/process-table.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseDarwinPsRows,
  parseLinuxPsRows,
  parseWindowsProcessRows,
} from "../../monitoring/process-table/index.js";

describe("process table adapters", () => {
  it("parses macOS ps output into normalized rows", () => {
    const rows = parseDarwinPsRows(
      "  101   1   6.5  2048   42 /usr/bin/node node server.js\n  202 101   1.5  1024   20 /bin/bash bash"
    );

    expect(rows).toEqual([
      {
        pid: 101,
        ppid: 1,
        cpuPercent: 6.5,
        rssBytes: 2048 * 1024,
        elapsedSec: 42,
        executable: "/usr/bin/node",
        command: "node server.js",
      },
      {
        pid: 202,
        ppid: 101,
        cpuPercent: 1.5,
        rssBytes: 1024 * 1024,
        elapsedSec: 20,
        executable: "/bin/bash",
        command: "bash",
      },
    ]);
  });

  it("parses linux ps output into normalized rows", () => {
    const rows = parseLinuxPsRows(
      "101 1 12.0 8096 99 /usr/bin/node node server.js\n202 101 0.8 2048 12 /usr/bin/python python worker.py"
    );

    expect(rows[0]?.pid).toBe(101);
    expect(rows[0]?.rssBytes).toBe(8096 * 1024);
    expect(rows[1]?.ppid).toBe(101);
  });

  it("parses windows powershell json rows into normalized rows", () => {
    const rows = parseWindowsProcessRows([
      {
        Id: 500,
        ParentProcessId: 1,
        CpuPercent: 4.25,
        WorkingSet64: 4096,
        ElapsedSec: 30,
        Path: "C:\\\\node.exe",
        CommandLine: "node server.js",
      },
    ]);

    expect(rows).toEqual([
      {
        pid: 500,
        ppid: 1,
        cpuPercent: 4.25,
        rssBytes: 4096,
        elapsedSec: 30,
        executable: "C:\\\\node.exe",
        command: "node server.js",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the collector tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/monitoring/host-collector.test.ts \
  src/__tests__/monitoring/process-table.test.ts
```

Expected: FAIL because the collectors and parsers do not exist yet.

- [ ] **Step 3: Implement host and process table collection**

Create `packages/server/src/monitoring/host-collector.ts`:

```ts
import os from "node:os";
import type { MonitoringHostSummary } from "@coder-studio/core";

type CpuTimes = Pick<NodeJS.CpuInfo["times"], "user" | "nice" | "sys" | "idle" | "irq">;

function sumCpuTimes(cpus: NodeJS.CpuInfo[]): CpuTimes {
  return cpus.reduce<CpuTimes>(
    (acc, cpu) => ({
      user: acc.user + cpu.times.user,
      nice: acc.nice + cpu.times.nice,
      sys: acc.sys + cpu.times.sys,
      idle: acc.idle + cpu.times.idle,
      irq: acc.irq + cpu.times.irq,
    }),
    { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
  );
}

export class HostCollector {
  private previousCpu: CpuTimes | null = null;

  constructor(
    private readonly deps: {
      platform?: NodeJS.Platform;
      cpus?: () => NodeJS.CpuInfo[];
      totalmem?: () => number;
      freemem?: () => number;
      uptime?: () => number;
      loadavg?: () => number[];
    } = {}
  ) {}

  collect(overrides: { cpus?: NodeJS.CpuInfo[] } = {}): MonitoringHostSummary {
    const cpus = overrides.cpus ?? this.deps.cpus?.() ?? os.cpus();
    const currentCpu = sumCpuTimes(cpus);
    const previousCpu = this.previousCpu;
    this.previousCpu = currentCpu;

    let cpuPercent: number | null = null;
    if (previousCpu) {
      const totalDelta =
        currentCpu.user +
        currentCpu.nice +
        currentCpu.sys +
        currentCpu.idle +
        currentCpu.irq -
        (previousCpu.user +
          previousCpu.nice +
          previousCpu.sys +
          previousCpu.idle +
          previousCpu.irq);
      const busyDelta =
        currentCpu.user +
        currentCpu.nice +
        currentCpu.sys +
        currentCpu.irq -
        (previousCpu.user + previousCpu.nice + previousCpu.sys + previousCpu.irq);

      if (totalDelta > 0) {
        cpuPercent = Number(((busyDelta / totalDelta) * 100).toFixed(2));
      }
    }

    const total = this.deps.totalmem?.() ?? os.totalmem();
    const free = this.deps.freemem?.() ?? os.freemem();
    const used = total - free;
    const loadAverage =
      (this.deps.platform ?? process.platform) === "win32"
        ? null
        : ((this.deps.loadavg?.() ?? os.loadavg()).slice(0, 3) as [number, number, number]);

    const memoryRatio = total > 0 ? used / total : null;
    const pressure =
      cpuPercent == null || memoryRatio == null
        ? "unknown"
        : cpuPercent >= 90 || memoryRatio >= 0.9
          ? "hot"
          : cpuPercent >= 70 || memoryRatio >= 0.75
            ? "elevated"
            : "normal";

    return {
      cpuPercent,
      memoryUsedBytes: used,
      memoryTotalBytes: total,
      memoryAvailableBytes: free,
      loadAverage,
      uptimeSec: this.deps.uptime?.() ?? os.uptime(),
      pressure,
    };
  }
}
```

Create `packages/server/src/monitoring/process-table/index.ts`:

```ts
import { runCommandAsString, type CommandRunner } from "../../provider-runtime/command-runner.js";
import type { ProcessStatRow } from "../types.js";
import { collectDarwinProcessRows, parseDarwinPsRows } from "./darwin.js";
import { collectLinuxProcessRows, parseLinuxPsRows } from "./linux.js";
import { collectWindowsProcessRows, parseWindowsProcessRows } from "./win32.js";

export { parseDarwinPsRows, parseLinuxPsRows, parseWindowsProcessRows };

export interface ProcessTableCollector {
  collect(): Promise<ProcessStatRow[]>;
}

export function createProcessTableCollector(
  platform: NodeJS.Platform = process.platform,
  runCommand: CommandRunner = runCommandAsString
): ProcessTableCollector {
  if (platform === "darwin") {
    return { collect: () => collectDarwinProcessRows(runCommand) };
  }
  if (platform === "linux") {
    return { collect: () => collectLinuxProcessRows(runCommand) };
  }
  return { collect: () => collectWindowsProcessRows(runCommand) };
}
```

Create `packages/server/src/monitoring/process-table/darwin.ts`:

```ts
import type { CommandRunner } from "../../provider-runtime/command-runner.js";
import type { ProcessStatRow } from "../types.js";

const DARWIN_PS_ARGS = ["-Ao", "pid=,ppid=,%cpu=,rss=,etimes=,comm=,args="];

export function parseDarwinPsRows(stdout: string): ProcessStatRow[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+([0-9.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!match) {
        return null;
      }

      const [, pid, ppid, cpu, rss, elapsedSec, executable, command] = match;
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        cpuPercent: Number(cpu),
        rssBytes: Number(rss) * 1024,
        elapsedSec: Number(elapsedSec),
        executable,
        command,
      } satisfies ProcessStatRow;
    })
    .filter((row): row is ProcessStatRow => row !== null);
}

export async function collectDarwinProcessRows(runCommand: CommandRunner): Promise<ProcessStatRow[]> {
  const result = await runCommand("ps", DARWIN_PS_ARGS);
  return parseDarwinPsRows(result.stdout);
}
```

Create `packages/server/src/monitoring/process-table/linux.ts`:

```ts
import type { CommandRunner } from "../../provider-runtime/command-runner.js";
import type { ProcessStatRow } from "../types.js";

const LINUX_PS_ARGS = ["-eo", "pid=,ppid=,%cpu=,rss=,etimes=,comm=,args="];

export function parseLinuxPsRows(stdout: string): ProcessStatRow[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+([0-9.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!match) {
        return null;
      }

      const [, pid, ppid, cpu, rss, elapsedSec, executable, command] = match;
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        cpuPercent: Number(cpu),
        rssBytes: Number(rss) * 1024,
        elapsedSec: Number(elapsedSec),
        executable,
        command,
      } satisfies ProcessStatRow;
    })
    .filter((row): row is ProcessStatRow => row !== null);
}

export async function collectLinuxProcessRows(runCommand: CommandRunner): Promise<ProcessStatRow[]> {
  const result = await runCommand("ps", LINUX_PS_ARGS);
  return parseLinuxPsRows(result.stdout);
}
```

Create `packages/server/src/monitoring/process-table/win32.ts`:

```ts
import type { CommandRunner } from "../../provider-runtime/command-runner.js";
import type { ProcessStatRow } from "../types.js";

const WINDOWS_SCRIPT = [
  "$processes = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine, ExecutablePath, CreationDate;",
  "$cpuByPid = @{};",
  "Get-Counter '\\Process(*)\\% Processor Time' | Select-Object -ExpandProperty CounterSamples | ForEach-Object {",
  "  if ($_.InstanceName -match '^(?!_Total|Idle)') {",
  "    $pid = [int]$_.CookedValue.ToString().Split('.')[0];",
  "  }",
  "};",
  "$payload = $processes | ForEach-Object {",
  "  [pscustomobject]@{",
  "    Id = $_.ProcessId;",
  "    ParentProcessId = $_.ParentProcessId;",
  "    CpuPercent = $null;",
  "    WorkingSet64 = $null;",
  "    ElapsedSec = $null;",
  "    Path = $_.ExecutablePath;",
  "    CommandLine = $_.CommandLine;",
  "  }",
  "};",
  "$payload | ConvertTo-Json -Compress",
].join(" ");

export function parseWindowsProcessRows(rows: unknown[]): ProcessStatRow[] {
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const candidate = row as Record<string, unknown>;
      if (typeof candidate.Id !== "number" || typeof candidate.ParentProcessId !== "number") {
        return null;
      }

      return {
        pid: candidate.Id,
        ppid: candidate.ParentProcessId,
        cpuPercent: typeof candidate.CpuPercent === "number" ? candidate.CpuPercent : null,
        rssBytes: typeof candidate.WorkingSet64 === "number" ? candidate.WorkingSet64 : null,
        elapsedSec: typeof candidate.ElapsedSec === "number" ? candidate.ElapsedSec : undefined,
        executable: typeof candidate.Path === "string" ? candidate.Path : undefined,
        command: typeof candidate.CommandLine === "string" ? candidate.CommandLine : undefined,
      } satisfies ProcessStatRow;
    })
    .filter((row): row is ProcessStatRow => row !== null);
}

export async function collectWindowsProcessRows(
  runCommand: CommandRunner
): Promise<ProcessStatRow[]> {
  const result = await runCommand("powershell", ["-NoProfile", "-Command", WINDOWS_SCRIPT]);
  const parsed = JSON.parse(result.stdout) as unknown;
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return parseWindowsProcessRows(rows);
}
```

The Windows adapter is allowed to emit `cpuPercent: null` in the first implementation pass; later aggregation must treat `null` as unavailable instead of failing the entire snapshot.

- [ ] **Step 4: Run the collector tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/monitoring/host-collector.test.ts \
  src/__tests__/monitoring/process-table.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the collectors**

```bash
git add packages/server/src/monitoring/host-collector.ts \
  packages/server/src/monitoring/process-table/darwin.ts \
  packages/server/src/monitoring/process-table/linux.ts \
  packages/server/src/monitoring/process-table/win32.ts \
  packages/server/src/monitoring/process-table/index.ts \
  packages/server/src/__tests__/monitoring/host-collector.test.ts \
  packages/server/src/__tests__/monitoring/process-table.test.ts
git commit -m "feat(server): add monitoring collectors"
```

### Task 5: Build Aggregation, History Retention, And MonitoringService

**Files:**
- Create: `packages/server/src/monitoring/aggregation.ts`
- Create: `packages/server/src/monitoring/history-store.ts`
- Create: `packages/server/src/monitoring/service.ts`
- Create: `packages/server/src/__tests__/monitoring/aggregation.test.ts`
- Create: `packages/server/src/__tests__/monitoring/service.test.ts`

- [ ] **Step 1: Write the failing aggregation and service tests**

Create `packages/server/src/__tests__/monitoring/aggregation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDefaultMonitoringSettings } from "@coder-studio/core";
import { buildMonitoringSnapshot } from "../../monitoring/aggregation.js";

describe("buildMonitoringSnapshot", () => {
  it("aggregates managed roots into runtime, workspace, session, and subprocess views", () => {
    const response = buildMonitoringSnapshot({
      settings: {
        ...createDefaultMonitoringSettings(),
        enabled: true,
        subprocessDrilldownEnabled: true,
      },
      sampledAt: 100,
      host: {
        cpuPercent: 80,
        memoryUsedBytes: 800,
        memoryTotalBytes: 1000,
        memoryAvailableBytes: 200,
        loadAverage: [1, 1, 1],
        uptimeSec: 300,
        pressure: "elevated",
      },
      roots: [
        {
          ownerId: "server:1",
          rootPid: 1,
          kind: "server",
          label: "Coder Studio server",
          startedAt: 1,
        },
        {
          ownerId: "terminal:term-1",
          rootPid: 100,
          kind: "terminal",
          label: "Claude",
          workspaceId: "ws-1",
          sessionId: "sess-1",
          terminalId: "term-1",
          providerId: "claude",
          startedAt: 2,
        },
      ],
      processRows: [
        { pid: 1, ppid: 0, cpuPercent: 10, rssBytes: 100, elapsedSec: 400, command: "node server.js" },
        { pid: 100, ppid: 1, cpuPercent: 20, rssBytes: 200, elapsedSec: 90, command: "claude" },
        { pid: 101, ppid: 100, cpuPercent: 5, rssBytes: 50, elapsedSec: 30, command: "python tool.py" },
      ],
      previousSnapshot: null,
    });

    expect(response.snapshot.runtime?.totalManagedCpuPercent).toBe(35);
    expect(response.snapshot.runtime?.managedProcessCount).toBe(3);
    expect(response.snapshot.workspaces[0]).toEqual(
      expect.objectContaining({
        id: "workspace:ws-1",
        cpuPercent: 25,
        memoryBytes: 250,
      })
    );
    expect(response.snapshot.sessions[0]).toEqual(
      expect.objectContaining({
        id: "session:sess-1",
        cpuPercent: 25,
        processCount: 2,
      })
    );
    expect(response.snapshot.subprocessGroups[0]?.parentId).toBe("session:sess-1");
  });

  it("keeps host data when process collection fails", () => {
    const response = buildMonitoringSnapshot({
      settings: {
        ...createDefaultMonitoringSettings(),
        enabled: true,
      },
      sampledAt: 100,
      host: {
        cpuPercent: 50,
        memoryUsedBytes: 400,
        memoryTotalBytes: 1000,
        memoryAvailableBytes: 600,
        loadAverage: [0.5, 0.4, 0.3],
        uptimeSec: 300,
        pressure: "normal",
      },
      roots: [],
      processRows: null,
      previousSnapshot: null,
      failureReason: "ps failed",
    });

    expect(response.snapshot.host?.cpuPercent).toBe(50);
    expect(response.snapshot.runtime).toBeNull();
    expect(response.telemetry.degraded).toBe(true);
  });
});
```

Create `packages/server/src/__tests__/monitoring/service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createDefaultMonitoringSettings } from "@coder-studio/core";
import { ManagedProcessRegistry } from "../../monitoring/managed-process-registry.js";
import { MonitoringService } from "../../monitoring/service.js";

describe("MonitoringService", () => {
  it("does not schedule sampling when monitoring is disabled", () => {
    const broadcaster = { broadcast: vi.fn() };
    const setIntervalSpy = vi.fn();

    const service = new MonitoringService({
      broadcaster,
      settingsRepo: {
        get: (key: string) => (key === "monitoring.enabled" ? false : undefined),
      },
      registry: new ManagedProcessRegistry({ now: () => 1 }),
      sessionMgr: { getAll: () => [], findSessionIdByTerminal: () => undefined },
      terminalMgr: { getAll: () => [] },
      hostCollector: { collect: vi.fn() },
      processCollector: { collect: vi.fn() },
      setInterval: setIntervalSpy,
      clearInterval: vi.fn(),
      now: () => 1,
    });

    service.start();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(service.getResponse().settings.enabled).toBe(false);
  });

  it("reloads the schedule and broadcasts snapshots when monitoring is enabled", async () => {
    const broadcaster = { broadcast: vi.fn() };
    const setIntervalSpy = vi.fn(() => ({ unref: vi.fn() }));

    const service = new MonitoringService({
      broadcaster,
      settingsRepo: {
        get: (key: string) => {
          const settings = {
            "monitoring.enabled": true,
            "monitoring.hostMetricsEnabled": true,
            "monitoring.runtimeSummaryEnabled": true,
            "monitoring.workspaceAttributionEnabled": true,
            "monitoring.subprocessDrilldownEnabled": false,
            "monitoring.sampleIntervalMs": 2000,
          } as Record<string, unknown>;
          return settings[key];
        },
      },
      registry: new ManagedProcessRegistry({ now: () => 10 }),
      sessionMgr: {
        getAll: () => [{ id: "sess-1", workspaceId: "ws-1", terminalId: "term-1", providerId: "claude" }],
        findSessionIdByTerminal: () => "sess-1",
      },
      terminalMgr: {
        getAll: () => [
          {
            id: "term-1",
            spec: { workspaceId: "ws-1", kind: "agent", title: "Claude" },
            toDTO: () => ({
              id: "term-1",
              workspaceId: "ws-1",
              kind: "agent",
              title: "Claude",
              cwd: "/tmp",
              argv: ["claude"],
              cols: 120,
              rows: 30,
              pid: 100,
              alive: true,
              createdAt: 1,
            }),
          },
        ],
      },
      hostCollector: {
        collect: () => ({
          cpuPercent: 40,
          memoryUsedBytes: 400,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 600,
          loadAverage: [0.2, 0.2, 0.1],
          uptimeSec: 10,
          pressure: "normal",
        }),
      },
      processCollector: {
        collect: async () => [
          { pid: 100, ppid: 1, cpuPercent: 10, rssBytes: 100, elapsedSec: 5, command: "claude" },
        ],
      },
      setInterval: setIntervalSpy,
      clearInterval: vi.fn(),
      now: () => 10,
    });

    service.start();
    await service.recheck();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      "monitoring.snapshot.updated",
      expect.objectContaining({
        snapshot: expect.objectContaining({
          mode: "standard",
        }),
      })
    );
  });
});
```

- [ ] **Step 2: Run the aggregation and service tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/monitoring/aggregation.test.ts \
  src/__tests__/monitoring/service.test.ts
```

Expected: FAIL because aggregation, history, and service code do not exist yet.

- [ ] **Step 3: Implement aggregation, history, and the monitoring service**

Create `packages/server/src/monitoring/history-store.ts`:

```ts
import type {
  MonitoringHistoryBundle,
  MonitoringSeriesBundle,
  MonitoringSeriesPoint,
  MonitoringSnapshot,
} from "@coder-studio/core";

const DEFAULT_RETENTION_MS = 30 * 60 * 1000;
const MAX_SUBPROCESS_HISTORY_GROUPS = 24;

function trimPoints(points: MonitoringSeriesPoint[], minSampledAt: number): MonitoringSeriesPoint[] {
  return points.filter((point) => point.sampledAt >= minSampledAt);
}

function appendPoint(bundle: MonitoringSeriesBundle, point: MonitoringSeriesPoint, minSampledAt: number) {
  bundle.points = trimPoints([...bundle.points, point], minSampledAt);
}

export class MonitoringHistoryStore {
  private readonly history: MonitoringHistoryBundle = {
    host: { points: [] },
    runtime: null,
    workspaces: {},
    sessions: {},
    subprocessGroups: {},
  };

  constructor(private readonly deps: { retentionMs?: number } = {}) {}

  clear(): void {
    this.history.host = { points: [] };
    this.history.runtime = null;
    this.history.workspaces = {};
    this.history.sessions = {};
    this.history.subprocessGroups = {};
  }

  record(snapshot: MonitoringSnapshot): { trimmed: boolean; subprocessHistoryLimited: boolean } {
    const minSampledAt = snapshot.sampledAt - (this.deps.retentionMs ?? DEFAULT_RETENTION_MS);
    let trimmed = false;

    if (snapshot.host) {
      appendPoint(this.history.host, {
        sampledAt: snapshot.sampledAt,
        cpuPercent: snapshot.host.cpuPercent,
        memoryBytes: snapshot.host.memoryUsedBytes,
      }, minSampledAt);
    }

    if (snapshot.runtime) {
      this.history.runtime ??= { points: [] };
      appendPoint(this.history.runtime, {
        sampledAt: snapshot.sampledAt,
        cpuPercent: snapshot.runtime.totalManagedCpuPercent,
        memoryBytes: snapshot.runtime.totalManagedMemoryBytes,
        processCount: snapshot.runtime.managedProcessCount,
      }, minSampledAt);
    }

    for (const entity of snapshot.workspaces) {
      const bundle = (this.history.workspaces[entity.id] ??= { points: [] });
      appendPoint(bundle, {
        sampledAt: snapshot.sampledAt,
        cpuPercent: entity.cpuPercent,
        memoryBytes: entity.memoryBytes,
        processCount: entity.processCount,
      }, minSampledAt);
    }

    for (const entity of snapshot.sessions) {
      const bundle = (this.history.sessions[entity.id] ??= { points: [] });
      appendPoint(bundle, {
        sampledAt: snapshot.sampledAt,
        cpuPercent: entity.cpuPercent,
        memoryBytes: entity.memoryBytes,
        processCount: entity.processCount,
      }, minSampledAt);
    }

    const hottestSubprocessIds = [...snapshot.subprocessGroups]
      .sort((left, right) => (right.cpuPercent ?? 0) - (left.cpuPercent ?? 0))
      .slice(0, MAX_SUBPROCESS_HISTORY_GROUPS)
      .map((entity) => entity.id);

    const allowedSubprocessIds = new Set(hottestSubprocessIds);
    for (const entity of snapshot.subprocessGroups) {
      if (!allowedSubprocessIds.has(entity.id)) {
        trimmed = true;
        continue;
      }

      const bundle = (this.history.subprocessGroups[entity.id] ??= { points: [] });
      appendPoint(bundle, {
        sampledAt: snapshot.sampledAt,
        cpuPercent: entity.cpuPercent,
        memoryBytes: entity.memoryBytes,
        processCount: entity.processCount,
      }, minSampledAt);
    }

    for (const id of Object.keys(this.history.subprocessGroups)) {
      if (!allowedSubprocessIds.has(id)) {
        delete this.history.subprocessGroups[id];
        trimmed = true;
      }
    }

    return {
      trimmed,
      subprocessHistoryLimited: trimmed,
    };
  }

  snapshot(): MonitoringHistoryBundle {
    return {
      host: { points: [...this.history.host.points] },
      runtime: this.history.runtime ? { points: [...this.history.runtime.points] } : null,
      workspaces: Object.fromEntries(
        Object.entries(this.history.workspaces).map(([id, bundle]) => [id, { points: [...bundle.points] }])
      ),
      sessions: Object.fromEntries(
        Object.entries(this.history.sessions).map(([id, bundle]) => [id, { points: [...bundle.points] }])
      ),
      subprocessGroups: Object.fromEntries(
        Object.entries(this.history.subprocessGroups).map(([id, bundle]) => [id, { points: [...bundle.points] }])
      ),
    };
  }
}
```

Create `packages/server/src/monitoring/aggregation.ts`:

```ts
import {
  createEmptyMonitoringResponse,
  deriveMonitoringMode,
  type MonitoringEntitySummary,
  type MonitoringHostSummary,
  type MonitoringResponse,
  type MonitoringSettings,
  type MonitoringSnapshot,
} from "@coder-studio/core";
import type { ManagedProcessRoot, ProcessStatRow } from "./types.js";

function createTrend(
  current: number | null,
  previous: number | null
): MonitoringEntitySummary["trend"] {
  if (current == null || previous == null) {
    return "unknown";
  }
  if (current > previous + 1) {
    return "rising";
  }
  if (current < previous - 1) {
    return "falling";
  }
  return "steady";
}

function buildIndexes(rows: ProcessStatRow[]) {
  const byPid = new Map<number, ProcessStatRow>();
  const childrenByPpid = new Map<number, ProcessStatRow[]>();

  for (const row of rows) {
    byPid.set(row.pid, row);
    const children = childrenByPpid.get(row.ppid) ?? [];
    children.push(row);
    childrenByPpid.set(row.ppid, children);
  }

  return { byPid, childrenByPpid };
}

function collectTree(rootPid: number, indexes: ReturnType<typeof buildIndexes>): ProcessStatRow[] {
  const root = indexes.byPid.get(rootPid);
  if (!root) {
    return [];
  }

  const result: ProcessStatRow[] = [];
  const stack = [root];
  const seen = new Set<number>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current.pid)) {
      continue;
    }
    seen.add(current.pid);
    result.push(current);

    for (const child of indexes.childrenByPpid.get(current.pid) ?? []) {
      stack.push(child);
    }
  }

  return result;
}

function summarizeRows(rows: ProcessStatRow[]) {
  return rows.reduce(
    (acc, row) => ({
      cpuPercent: acc.cpuPercent + (row.cpuPercent ?? 0),
      memoryBytes: acc.memoryBytes + (row.rssBytes ?? 0),
      processCount: acc.processCount + 1,
      uptimeSec: Math.max(acc.uptimeSec, row.elapsedSec ?? 0),
    }),
    { cpuPercent: 0, memoryBytes: 0, processCount: 0, uptimeSec: 0 }
  );
}

export function buildMonitoringSnapshot(input: {
  settings: MonitoringSettings;
  sampledAt: number;
  host: MonitoringHostSummary | null;
  roots: ManagedProcessRoot[];
  processRows: ProcessStatRow[] | null;
  previousSnapshot: MonitoringSnapshot | null;
  failureReason?: string;
}): MonitoringResponse {
  const empty = createEmptyMonitoringResponse(input.settings);
  const mode = deriveMonitoringMode(input.settings);

  if (!input.settings.enabled) {
    return {
      ...empty,
      settings: input.settings,
      snapshot: {
        ...empty.snapshot,
        sampledAt: input.sampledAt,
        mode,
      },
    };
  }

  if (!input.processRows) {
    return {
      ...empty,
      settings: input.settings,
      snapshot: {
        ...empty.snapshot,
        sampledAt: input.sampledAt,
        mode,
        host: input.host,
      },
      telemetry: {
        durationMs: 0,
        processRowCount: 0,
        subprocessGroupCount: 0,
        historyTrimmed: false,
        degraded: true,
        failureReason: input.failureReason,
      },
    };
  }

  const indexes = buildIndexes(input.processRows);
  const previousEntities = new Map(
    [...(input.previousSnapshot?.workspaces ?? []), ...(input.previousSnapshot?.sessions ?? []), ...(input.previousSnapshot?.subprocessGroups ?? [])]
      .map((entity) => [entity.id, entity.cpuPercent ?? null])
  );

  const workspaceMap = new Map<string, MonitoringEntitySummary>();
  const sessionMap = new Map<string, MonitoringEntitySummary>();
  const subprocessGroups: MonitoringEntitySummary[] = [];
  const backgroundGroups: MonitoringEntitySummary[] = [];
  const serverRoot = input.roots.find((root) => root.kind === "server");
  const serverRows = serverRoot ? collectTree(serverRoot.rootPid, indexes) : [];
  let totalManagedCpuPercent = 0;
  let totalManagedMemoryBytes = 0;
  let managedProcessCount = 0;

  for (const root of input.roots) {
    const treeRows = collectTree(root.rootPid, indexes);
    if (treeRows.length === 0) {
      continue;
    }

    const summary = summarizeRows(treeRows);
    totalManagedCpuPercent += summary.cpuPercent;
    totalManagedMemoryBytes += summary.memoryBytes;
    managedProcessCount += summary.processCount;

    if (!root.workspaceId) {
      backgroundGroups.push({
        id: `background:${root.ownerId}`,
        kind: "background_group",
        label: root.label,
        cpuPercent: summary.cpuPercent,
        memoryBytes: summary.memoryBytes,
        processCount: summary.processCount,
        uptimeSec: summary.uptimeSec,
        trend: createTrend(summary.cpuPercent, previousEntities.get(`background:${root.ownerId}`) ?? null),
      });
      continue;
    }

    const workspaceId = `workspace:${root.workspaceId}`;
    const workspace = workspaceMap.get(workspaceId) ?? {
      id: workspaceId,
      kind: "workspace",
      workspaceId: root.workspaceId,
      label: root.workspaceId,
      cpuPercent: 0,
      memoryBytes: 0,
      processCount: 0,
      uptimeSec: 0,
      trend: "unknown",
      childCount: 0,
    };
    workspace.cpuPercent = (workspace.cpuPercent ?? 0) + summary.cpuPercent;
    workspace.memoryBytes = (workspace.memoryBytes ?? 0) + summary.memoryBytes;
    workspace.processCount += summary.processCount;
    workspace.uptimeSec = Math.max(workspace.uptimeSec ?? 0, summary.uptimeSec);
    workspace.childCount = (workspace.childCount ?? 0) + 1;
    workspace.trend = createTrend(workspace.cpuPercent, previousEntities.get(workspaceId) ?? null);
    workspaceMap.set(workspaceId, workspace);

    if (root.sessionId) {
      const sessionId = `session:${root.sessionId}`;
      sessionMap.set(sessionId, {
        id: sessionId,
        kind: "session",
        parentId: workspaceId,
        workspaceId: root.workspaceId,
        sessionId: root.sessionId,
        terminalId: root.terminalId,
        label: root.label,
        cpuPercent: summary.cpuPercent,
        memoryBytes: summary.memoryBytes,
        processCount: summary.processCount,
        uptimeSec: summary.uptimeSec,
        trend: createTrend(summary.cpuPercent, previousEntities.get(sessionId) ?? null),
        childCount: Math.max(0, treeRows.length - 1),
      });

      if (input.settings.subprocessDrilldownEnabled) {
        for (const child of treeRows.filter((row) => row.pid !== root.rootPid)) {
          const id = `subprocess:${root.sessionId}:${child.pid}`;
          subprocessGroups.push({
            id,
            kind: "subprocess_group",
            parentId: sessionId,
            workspaceId: root.workspaceId,
            sessionId: root.sessionId,
            terminalId: root.terminalId,
            label: child.command ?? child.executable ?? `pid ${child.pid}`,
            cpuPercent: child.cpuPercent,
            memoryBytes: child.rssBytes,
            processCount: 1,
            uptimeSec: child.elapsedSec ?? null,
            trend: createTrend(child.cpuPercent, previousEntities.get(id) ?? null),
          });
        }
      }
    }
  }

  const serverSummary = summarizeRows(serverRows);
  const hostCpu = input.host?.cpuPercent ?? null;
  const hostMemory = input.host?.memoryTotalBytes ?? null;

  return {
    ...empty,
    settings: input.settings,
    capabilities: {
      loadAverageAvailable: input.host?.loadAverage !== null,
      processMetricsAvailable: true,
      subprocessHistoryLimited: false,
    },
    snapshot: {
      sampledAt: input.sampledAt,
      mode,
      host: input.host,
      runtime: input.settings.runtimeSummaryEnabled
        ? {
            serverCpuPercent: serverSummary.cpuPercent || null,
            serverMemoryBytes: serverSummary.memoryBytes || null,
            totalManagedCpuPercent,
            totalManagedMemoryBytes,
            managedProcessCount,
            cpuShareOfHostPercent:
              hostCpu != null && hostCpu > 0
                ? Number(((totalManagedCpuPercent / hostCpu) * 100).toFixed(2))
                : null,
            memoryShareOfHostPercent:
              hostMemory != null && hostMemory > 0
                ? Number(((totalManagedMemoryBytes / hostMemory) * 100).toFixed(2))
                : null,
          }
        : null,
      workspaces: input.settings.workspaceAttributionEnabled
        ? [...workspaceMap.values()].sort((left, right) => (right.cpuPercent ?? 0) - (left.cpuPercent ?? 0))
        : [],
      sessions: input.settings.workspaceAttributionEnabled
        ? [...sessionMap.values()].sort((left, right) => (right.cpuPercent ?? 0) - (left.cpuPercent ?? 0))
        : [],
      subprocessGroups: input.settings.subprocessDrilldownEnabled
        ? subprocessGroups.sort((left, right) => (right.cpuPercent ?? 0) - (left.cpuPercent ?? 0))
        : [],
      backgroundGroups: backgroundGroups.sort((left, right) => (right.cpuPercent ?? 0) - (left.cpuPercent ?? 0)),
    },
    telemetry: {
      durationMs: 0,
      processRowCount: input.processRows.length,
      subprocessGroupCount: subprocessGroups.length,
      historyTrimmed: false,
      degraded: false,
      failureReason: input.failureReason,
    },
  };
}
```

Create `packages/server/src/monitoring/service.ts`:

```ts
import {
  Topics,
  createEmptyMonitoringResponse,
  deriveMonitoringMode,
  resolveMonitoringSettings,
  type MonitoringResponse,
} from "@coder-studio/core";
import type { Session, Terminal } from "@coder-studio/core";
import { buildMonitoringSnapshot } from "./aggregation.js";
import { MonitoringHistoryStore } from "./history-store.js";
import { ManagedProcessRegistry } from "./managed-process-registry.js";
import type { HostCollector } from "./host-collector.js";
import type { ProcessTableCollector } from "./process-table/index.js";

export class MonitoringService {
  private timer: NodeJS.Timeout | null = null;
  private latest = createEmptyMonitoringResponse();
  private latestSampledSnapshot = this.latest.snapshot;
  private readonly history = new MonitoringHistoryStore();

  constructor(
    private readonly deps: {
      broadcaster: { broadcast(topic: string, payload: unknown): void };
      settingsRepo: { get<T = unknown>(key: string): T | undefined };
      registry: ManagedProcessRegistry;
      sessionMgr: {
        getAll(): Session[];
        findSessionIdByTerminal(terminalId: string): string | undefined;
      };
      terminalMgr: {
        getAll(): Array<{ toDTO(): Terminal; spec?: { workspaceId: string; kind: "agent" | "shell"; title?: string } }>;
      };
      hostCollector: Pick<HostCollector, "collect">;
      processCollector: Pick<ProcessTableCollector, "collect">;
      setInterval?: typeof global.setInterval;
      clearInterval?: typeof global.clearInterval;
      now?: () => number;
    }
  ) {}

  start(): void {
    this.deps.registry.registerServerProcess(process.pid);
    this.reloadFromSettings();
  }

  stop(): void {
    if (this.timer) {
      (this.deps.clearInterval ?? clearInterval)(this.timer);
      this.timer = null;
    }
  }

  getResponse(): MonitoringResponse {
    return this.latest;
  }

  async recheck(): Promise<MonitoringResponse> {
    await this.sampleOnce();
    return this.latest;
  }

  reloadFromSettings(): void {
    this.stop();
    const settings = resolveMonitoringSettings(this.deps.settingsRepo);
    if (!settings.enabled) {
      this.history.clear();
      this.latest = {
        ...createEmptyMonitoringResponse(settings),
        settings,
        snapshot: {
          ...createEmptyMonitoringResponse(settings).snapshot,
          sampledAt: this.now(),
          mode: deriveMonitoringMode(settings),
        },
      };
      return;
    }

    const intervalHandle = (this.deps.setInterval ?? setInterval)(() => {
      void this.sampleOnce();
    }, settings.sampleIntervalMs);
    intervalHandle.unref?.();
    this.timer = intervalHandle;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private syncManagedTerminalRoots(): void {
    const sessionsByTerminal = new Map(
      this.deps.sessionMgr.getAll().map((session) => [session.terminalId, session])
    );

    for (const activeTerminal of this.deps.terminalMgr.getAll()) {
      const terminal = activeTerminal.toDTO();
      this.deps.registry.upsertTerminalRoot({
        terminalId: terminal.id,
        workspaceId: terminal.workspaceId,
        pid: terminal.pid,
        kind: terminal.kind,
        title: terminal.title,
      });

      const session =
        sessionsByTerminal.get(terminal.id) ??
        ((): Session | undefined => {
          const sessionId = this.deps.sessionMgr.findSessionIdByTerminal(terminal.id);
          return sessionId
            ? this.deps.sessionMgr.getAll().find((candidate) => candidate.id === sessionId)
            : undefined;
        })();

      if (session) {
        this.deps.registry.bindSessionToTerminal(terminal.id, {
          sessionId: session.id,
          providerId: session.providerId,
          label: session.title ?? terminal.title,
        });
      }
    }
  }

  private async sampleOnce(): Promise<void> {
    const settings = resolveMonitoringSettings(this.deps.settingsRepo);
    const startedAt = this.now();
    this.syncManagedTerminalRoots();

    const host = settings.hostMetricsEnabled ? this.deps.hostCollector.collect() : null;

    let processRows = null;
    let failureReason: string | undefined;
    if (settings.runtimeSummaryEnabled) {
      try {
        processRows = await this.deps.processCollector.collect();
      } catch (error) {
        failureReason = error instanceof Error ? error.message : String(error);
      }
    }

    const response = buildMonitoringSnapshot({
      settings,
      sampledAt: startedAt,
      host,
      roots: this.deps.registry.listRoots(),
      processRows,
      previousSnapshot: this.latestSampledSnapshot.sampledAt > 0 ? this.latestSampledSnapshot : null,
      failureReason,
    });

    const historyState = this.history.record(response.snapshot);
    this.latestSampledSnapshot = response.snapshot;
    this.latest = {
      ...response,
      history: this.history.snapshot(),
      capabilities: {
        ...response.capabilities,
        subprocessHistoryLimited: historyState.subprocessHistoryLimited,
      },
      telemetry: response.telemetry
        ? {
            ...response.telemetry,
            durationMs: this.now() - startedAt,
            historyTrimmed: historyState.trimmed,
          }
        : null,
    };

    this.deps.broadcaster.broadcast(Topics.monitoringSnapshotUpdated, this.latest);
  }
}
```

- [ ] **Step 4: Run the aggregation and service tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/monitoring/aggregation.test.ts \
  src/__tests__/monitoring/service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit aggregation and service**

```bash
git add packages/server/src/monitoring/aggregation.ts \
  packages/server/src/monitoring/history-store.ts \
  packages/server/src/monitoring/service.ts \
  packages/server/src/__tests__/monitoring/aggregation.test.ts \
  packages/server/src/__tests__/monitoring/service.test.ts
git commit -m "feat(server): add monitoring aggregation service"
```

### Task 6: Wire Monitoring Into Server Lifecycle, Commands, And Settings Reloads

**Files:**
- Create: `packages/server/src/commands/monitoring.ts`
- Create: `packages/server/src/__tests__/monitoring/commands.test.ts`
- Create: `packages/server/src/__tests__/server-monitoring-hydration.test.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/commands/settings.ts`
- Modify: `packages/server/src/commands/settings.test.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write the failing command, settings, and server lifecycle tests**

Create `packages/server/src/__tests__/monitoring/commands.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../../ws/dispatch.js";
import { dispatch } from "../../ws/dispatch.js";
import "../../commands/monitoring.js";

describe("monitoring commands", () => {
  it("dispatches monitoring.get", async () => {
    const ctx = {
      monitoringService: {
        getResponse: vi.fn(() => ({ snapshot: { sampledAt: 1 } })),
      },
    } as unknown as CommandContext;

    const result = await dispatch(
      { kind: "command", id: crypto.randomUUID(), op: "monitoring.get", args: {} },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ snapshot: { sampledAt: 1 } });
  });

  it("dispatches monitoring.recheck", async () => {
    const ctx = {
      monitoringService: {
        recheck: vi.fn(async () => ({ snapshot: { sampledAt: 2 } })),
      },
    } as unknown as CommandContext;

    const result = await dispatch(
      { kind: "command", id: crypto.randomUUID(), op: "monitoring.recheck", args: {} },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ snapshot: { sampledAt: 2 } });
  });
});
```

Add a new test to `packages/server/src/commands/settings.test.ts`:

```ts
  it("settings.update persists monitoring settings and reloads the monitoring service", async () => {
    const monitoringService = {
      reloadFromSettings: vi.fn(),
    };
    ctx.monitoringService = monitoringService as never;

    const result = await dispatch(
      {
        kind: "command",
        id: "settings-update-monitoring",
        op: "settings.update",
        args: {
          settings: {
            monitoring: {
              enabled: true,
              hostMetricsEnabled: true,
              runtimeSummaryEnabled: true,
              workspaceAttributionEnabled: true,
              subprocessDrilldownEnabled: false,
              sampleIntervalMs: 5000,
            },
          },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(settingsRepo.get("monitoring.enabled")).toBe(true);
    expect(settingsRepo.get("monitoring.sampleIntervalMs")).toBe(5000);
    expect(monitoringService.reloadFromSettings).toHaveBeenCalledTimes(1);
  });
```

Create `packages/server/src/__tests__/server-monitoring-hydration.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "../server.js";
import { SettingsRepo } from "../storage/index.js";

describe("server monitoring hydration", () => {
  let server: Server | undefined;
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "coder-studio-monitoring-state-"));
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("hydrates persisted monitoring settings into the monitoring service on startup", async () => {
    const settingsRepo = new SettingsRepo({
      filePath: join(stateDir, "state", "settings.json"),
    });
    settingsRepo.set("monitoring.enabled", true);
    settingsRepo.set("monitoring.sampleIntervalMs", 5000);

    server = await createServer({
      stateDir,
      host: "127.0.0.1",
      port: 0,
    });

    expect(server.__test__?.commandContext.monitoringService?.getResponse().settings).toEqual(
      expect.objectContaining({
        enabled: true,
        sampleIntervalMs: 5000,
      })
    );
  });
});
```

- [ ] **Step 2: Run the server wiring tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/monitoring/commands.test.ts \
  src/__tests__/server-monitoring-hydration.test.ts \
  src/commands/settings.test.ts
```

Expected: FAIL because monitoring commands, settings schema, and server wiring are missing.

- [ ] **Step 3: Implement commands, settings reload hooks, and server lifecycle wiring**

Create `packages/server/src/commands/monitoring.ts`:

```ts
import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

registerCommand("monitoring.get", z.object({}).default({}), async (_args, ctx) => {
  return ctx.monitoringService?.getResponse();
});

registerCommand("monitoring.recheck", z.object({}).default({}), async (_args, ctx) => {
  if (!ctx.monitoringService) {
    throw Object.assign(new Error("Monitoring service unavailable"), {
      code: "monitoring_unavailable",
    });
  }
  return await ctx.monitoringService.recheck();
});
```

Update `packages/server/src/ws/dispatch.ts`:

```ts
import type { MonitoringService } from "../monitoring/service.js";

export interface CommandContext {
  // existing fields
  monitoringService?: MonitoringService;
}
```

Update `packages/server/src/commands/index.ts`:

```ts
import "./monitoring.js";
```

Update `packages/server/src/commands/settings.ts`:

```ts
import { isMonitoringSampleIntervalMs } from "@coder-studio/core";

const SettingsSchema = z.object({
  // existing sections
  monitoring: z
    .object({
      enabled: z.boolean().optional(),
      hostMetricsEnabled: z.boolean().optional(),
      runtimeSummaryEnabled: z.boolean().optional(),
      workspaceAttributionEnabled: z.boolean().optional(),
      subprocessDrilldownEnabled: z.boolean().optional(),
      sampleIntervalMs: z.number().int().refine(isMonitoringSampleIntervalMs).optional(),
    })
    .optional(),
});
```

and inside `settings.update`:

```ts
    if (
      flatSettings["monitoring.enabled"] !== undefined ||
      flatSettings["monitoring.hostMetricsEnabled"] !== undefined ||
      flatSettings["monitoring.runtimeSummaryEnabled"] !== undefined ||
      flatSettings["monitoring.workspaceAttributionEnabled"] !== undefined ||
      flatSettings["monitoring.subprocessDrilldownEnabled"] !== undefined ||
      flatSettings["monitoring.sampleIntervalMs"] !== undefined
    ) {
      ctx.monitoringService?.reloadFromSettings();
    }
```

Update `packages/server/src/server.ts` by adding imports:

```ts
import { HostCollector } from "./monitoring/host-collector.js";
import { ManagedProcessRegistry } from "./monitoring/managed-process-registry.js";
import { createProcessTableCollector } from "./monitoring/process-table/index.js";
import { MonitoringService } from "./monitoring/service.js";
```

Construct the service after `sessionMgr` and `terminalMgr` exist:

```ts
  const managedProcessRegistry = new ManagedProcessRegistry();
  const monitoringService = new MonitoringService({
    broadcaster: wsHub,
    settingsRepo,
    registry: managedProcessRegistry,
    sessionMgr,
    terminalMgr,
    hostCollector: new HostCollector(),
    processCollector: createProcessTableCollector(),
  });
```

Inject it into `commandContext`:

```ts
    monitoringService,
```

Start and stop it alongside the other services:

```ts
  monitoringService.start();
```

and in `stop()`:

```ts
    monitoringService.stop();
```

Expose it in `__test__` through the existing `commandContext`.

- [ ] **Step 4: Run the server wiring tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/monitoring/commands.test.ts \
  src/__tests__/server-monitoring-hydration.test.ts \
  src/commands/settings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the server wiring**

```bash
git add packages/server/src/commands/monitoring.ts \
  packages/server/src/__tests__/monitoring/commands.test.ts \
  packages/server/src/__tests__/server-monitoring-hydration.test.ts \
  packages/server/src/commands/index.ts \
  packages/server/src/ws/dispatch.ts \
  packages/server/src/commands/settings.ts \
  packages/server/src/commands/settings.test.ts \
  packages/server/src/server.ts
git commit -m "feat(server): wire monitoring service into commands"
```

### Task 7: Add The Routed Monitoring Page With Live Updates

**Files:**
- Create: `packages/web/src/features/monitoring/index.ts`
- Create: `packages/web/src/features/monitoring/formatters.ts`
- Create: `packages/web/src/features/monitoring/sparkline.tsx`
- Create: `packages/web/src/features/monitoring/page.tsx`
- Create: `packages/web/src/features/monitoring/page.test.tsx`
- Modify: `packages/web/src/shells/desktop-shell.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/shells/desktop-shell.test.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`

- [ ] **Step 1: Write the failing monitoring page and route tests**

Create `packages/web/src/features/monitoring/page.test.tsx`:

```ts
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../atoms/app-ui";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import { MonitoringPage } from "./page";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

function renderMonitoringPage(response: unknown, viewport: "desktop" | "mobile" = "desktop") {
  viewportMocks.viewport = viewport;

  const subscribe = vi.fn((_topics: string[], handler: (topic: string, payload: unknown) => void) => {
    handler("monitoring.snapshot.updated", response);
    return () => {};
  });

  const sendCommand = vi
    .fn()
    .mockResolvedValueOnce(response)
    .mockResolvedValueOnce(response);

  const store = createStore();
  store.set(localeAtom, "en");
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, { sendCommand, subscribe } as never);

  return {
    sendCommand,
    subscribe,
    ...render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/monitoring"]}>
          <Routes>
            <Route path="/monitoring" element={<MonitoringPage />} />
            <Route path="/settings" element={<div>SettingsPage</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    ),
  };
}

describe("MonitoringPage", () => {
  it("loads the snapshot, subscribes for updates, and renders host plus runtime sections", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "standard",
        host: {
          cpuPercent: 72,
          memoryUsedBytes: 800,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 200,
          loadAverage: [1, 1, 1],
          uptimeSec: 60,
          pressure: "elevated",
        },
        runtime: {
          serverCpuPercent: 10,
          serverMemoryBytes: 100,
          totalManagedCpuPercent: 30,
          totalManagedMemoryBytes: 300,
          managedProcessCount: 4,
          cpuShareOfHostPercent: 41.67,
          memoryShareOfHostPercent: 30,
        },
        workspaces: [
          {
            id: "workspace:ws-1",
            kind: "workspace",
            label: "ws-1",
            cpuPercent: 30,
            memoryBytes: 300,
            processCount: 4,
            uptimeSec: 60,
            trend: "steady",
          },
        ],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
        runtime: { points: [{ sampledAt: 10, cpuPercent: 30, memoryBytes: 300, processCount: 4 }] },
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: true,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    const { sendCommand, subscribe } = renderMonitoringPage(response);

    expect(await screen.findByText("Performance monitoring")).toBeInTheDocument();
    expect(sendCommand).toHaveBeenCalledWith("monitoring.get", {}, undefined);
    expect(subscribe).toHaveBeenCalledWith(["monitoring.snapshot.updated"], expect.any(Function));
    expect(screen.getByText("Host overview")).toBeInTheDocument();
    expect(screen.getByText("Coder Studio footprint")).toBeInTheDocument();
    expect(screen.getByText("ws-1")).toBeInTheDocument();
  });

  it("renders a disabled empty state that links to settings", async () => {
    const response = {
      settings: {
        enabled: false,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 0,
        mode: "disabled",
        host: null,
        runtime: null,
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [] },
        runtime: null,
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: false,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response);

    expect(await screen.findByText("Monitoring disabled")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(await screen.findByText("SettingsPage")).toBeInTheDocument();
  });

  it("falls back to mobile tabbed layout", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: false,
        workspaceAttributionEnabled: false,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 5000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "light",
        host: {
          cpuPercent: 30,
          memoryUsedBytes: 300,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 700,
          loadAverage: [0.3, 0.2, 0.1],
          uptimeSec: 60,
          pressure: "normal",
        },
        runtime: null,
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 30, memoryBytes: 300 }] },
        runtime: null,
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: false,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    };

    renderMonitoringPage(response, "mobile");

    expect(await screen.findByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Attribution" })).toBeInTheDocument();
    expect(screen.getByText("Enable runtime summary in settings")).toBeInTheDocument();
  });
});
```

Add a desktop shell route test to `packages/web/src/shells/desktop-shell.test.tsx`:

```ts
vi.mock("../features/monitoring", () => ({
  MonitoringPage: () => <div>MonitoringPage</div>,
}));

it("renders MonitoringPage on /monitoring while auth status is still unknown", () => {
  window.history.replaceState({}, "", "/monitoring");
  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(authEnabledAtom, null);
  store.set(authenticatedAtom, false);

  renderShell(store);

  expect(screen.getByText("MonitoringPage")).toBeInTheDocument();
  expect(screen.queryByText("正在连接工作区...")).not.toBeInTheDocument();
});
```

Add the corresponding mobile shell test to `packages/web/src/shells/mobile-shell/index.test.tsx` with the same `authEnabledAtom = null` bypass expectation for `/monitoring`.

- [ ] **Step 2: Run the web monitoring and route tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/monitoring/page.test.tsx \
  src/shells/desktop-shell.test.tsx \
  src/shells/mobile-shell/index.test.tsx
```

Expected: FAIL because the monitoring page and routes do not exist yet.

- [ ] **Step 3: Implement the monitoring page, sparkline helper, and routes**

Create `packages/web/src/features/monitoring/index.ts`:

```ts
export { MonitoringPage } from "./page";
```

Create `packages/web/src/features/monitoring/formatters.ts`:

```ts
export function formatPercent(value: number | null): string {
  return value == null ? "Unavailable" : `${value.toFixed(1)}%`;
}

export function formatBytes(value: number | null): string {
  if (value == null) return "Unavailable";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatUptime(value: number | null): string {
  if (value == null) return "Unavailable";
  if (value < 60) return `${Math.round(value)}s`;
  if (value < 3600) return `${Math.round(value / 60)}m`;
  return `${Math.round(value / 3600)}h`;
}

export function formatLoadAverage(value: [number, number, number] | null): string {
  return value == null ? "Unavailable" : value.map((item) => item.toFixed(2)).join(" / ");
}

export function formatRefreshInterval(ms: number): string {
  return `Refresh every ${ms / 1000}s`;
}
```

Create `packages/web/src/features/monitoring/sparkline.tsx`:

```tsx
import type { MonitoringSeriesPoint } from "@coder-studio/core";

export function Sparkline({
  points,
  metric,
  width = 96,
  height = 28,
}: {
  points: MonitoringSeriesPoint[];
  metric: "cpuPercent" | "memoryBytes";
  width?: number;
  height?: number;
}) {
  const values = points
    .map((point) => point[metric] ?? null)
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return <div className="monitoring-sparkline monitoring-sparkline--empty">—</div>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coordinates = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  });

  return (
    <svg className="monitoring-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={coordinates.join(" ")} />
    </svg>
  );
}
```

Create `packages/web/src/features/monitoring/page.tsx`:

```tsx
import type { MonitoringEntitySummary, MonitoringResponse } from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { connectionStatusAtom, dispatchCommandAtom, wsClientAtom } from "../../atoms/connection";
import { Button, EmptyState, Notice, SegmentedControl, Tag } from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";
import { MobilePageHeader } from "../shared/components/mobile-page-header";
import { PageHeader } from "../shared/components/page-header";
import {
  formatBytes,
  formatLoadAverage,
  formatPercent,
  formatRefreshInterval,
  formatUptime,
} from "./formatters";
import { Sparkline } from "./sparkline";

type RangeMinutes = 5 | 15 | 30;
type SortMetric = "cpu" | "memory";
type MobileSection = "overview" | "attribution" | "process";

function sortEntities(entities: MonitoringEntitySummary[], metric: SortMetric) {
  const key = metric === "cpu" ? "cpuPercent" : "memoryBytes";
  return [...entities].sort((left, right) => (Number(right[key] ?? 0) - Number(left[key] ?? 0)));
}

function filterPointsByRange<T extends { sampledAt: number }>(
  points: T[],
  rangeMinutes: RangeMinutes,
  sampledAt: number
) {
  const cutoff = sampledAt - rangeMinutes * 60_000;
  return points.filter((point) => point.sampledAt >= cutoff);
}

export function MonitoringPage() {
  const t = useTranslation();
  const navigate = useNavigate();
  const viewport = useViewport();
  const isMobile = viewport === "mobile";
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const [response, setResponse] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rangeMinutes, setRangeMinutes] = useState<RangeMinutes>(15);
  const [sortMetric, setSortMetric] = useState<SortMetric>("cpu");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<MobileSection>("overview");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const result = await dispatch<MonitoringResponse>("monitoring.get", {});
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setLoadError(result.error?.message ?? "Monitoring load failed");
      } else {
        setResponse(result.data);
        setLoadError(null);
      }
      setLoading(false);
    };

    void load();
    const unsubscribe =
      wsClient?.subscribe([Topics.monitoringSnapshotUpdated], (_topic, payload) => {
        setResponse(payload as MonitoringResponse);
      }) ?? (() => {});

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [dispatch, wsClient]);

  const selectedEntity = useMemo(() => {
    const all = [
      ...(response?.snapshot.workspaces ?? []),
      ...(response?.snapshot.sessions ?? []),
      ...(response?.snapshot.subprocessGroups ?? []),
      ...(response?.snapshot.backgroundGroups ?? []),
    ];
    return all.find((entity) => entity.id === selectedEntityId) ?? all[0] ?? null;
  }, [response, selectedEntityId]);

  const sortedWorkspaces = useMemo(
    () => sortEntities(response?.snapshot.workspaces ?? [], sortMetric),
    [response, sortMetric]
  );
  const sortedSessions = useMemo(
    () => sortEntities(response?.snapshot.sessions ?? [], sortMetric),
    [response, sortMetric]
  );
  const sortedProcesses = useMemo(
    () => sortEntities(response?.snapshot.subprocessGroups ?? [], sortMetric),
    [response, sortMetric]
  );

  const refresh = async () => {
    const result = await dispatch<MonitoringResponse>("monitoring.recheck", {});
    if (result.ok && result.data) {
      setResponse(result.data);
      setLoadError(null);
      return;
    }
    setLoadError(result.error?.message ?? "Monitoring refresh failed");
  };

  const header = isMobile ? (
    <MobilePageHeader title={t("monitoring.title")} titleAs="div" onBack={() => navigate(-1)} backLabel={t("action.back")} />
  ) : (
    <PageHeader title={t("monitoring.title")} titleAs="h1" level="secondary" onBack={() => navigate(-1)} backLabel={t("action.back")} />
  );

  if (loading) {
    return (
      <div className={`monitoring-page ${isMobile ? "monitoring-page--mobile" : ""}`}>
        <header className="monitoring-header">{header}</header>
        <main className="monitoring-content">
          <EmptyState title={t("monitoring.loading")} />
        </main>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`monitoring-page ${isMobile ? "monitoring-page--mobile" : ""}`}>
        <header className="monitoring-header">{header}</header>
        <main className="monitoring-content">
          <Notice tone="error" title={t("monitoring.load_failed")} message={loadError} />
        </main>
      </div>
    );
  }

  if (!response || !response.settings.enabled) {
    return (
      <div className={`monitoring-page ${isMobile ? "monitoring-page--mobile" : ""}`}>
        <header className="monitoring-header">{header}</header>
        <main className="monitoring-content">
          <EmptyState
            title={t("monitoring.disabled_title")}
            description={t("monitoring.disabled_description")}
            action={
              <Button type="button" onClick={() => navigate("/settings?section=general")}>
                {t("monitoring.open_settings")}
              </Button>
            }
          />
        </main>
      </div>
    );
  }

  const selectedHistory =
    (selectedEntity && response.history.workspaces[selectedEntity.id]) ||
    (selectedEntity && response.history.sessions[selectedEntity.id]) ||
    (selectedEntity && response.history.subprocessGroups[selectedEntity.id]) ||
    { points: [] };
  const hostHistoryPoints = filterPointsByRange(
    response.history.host.points,
    rangeMinutes,
    response.snapshot.sampledAt
  );
  const runtimeHistoryPoints = filterPointsByRange(
    response.history.runtime?.points ?? [],
    rangeMinutes,
    response.snapshot.sampledAt
  );
  const selectedHistoryPoints = filterPointsByRange(
    selectedHistory.points,
    rangeMinutes,
    response.snapshot.sampledAt
  );
  const processCollectionDegraded =
    response.settings.runtimeSummaryEnabled &&
    !response.capabilities.processMetricsAvailable &&
    response.telemetry?.degraded === true;

  const overview = (
    <>
      <section className="monitoring-overview-grid">
        <article className="monitoring-card">
          <div className="monitoring-card__header">
            <h2>{t("monitoring.host_overview")}</h2>
            <Tag>{response.snapshot.host?.pressure ?? "unknown"}</Tag>
          </div>
          <dl className="monitoring-metrics">
            <div><dt>{t("monitoring.cpu")}</dt><dd>{formatPercent(response.snapshot.host?.cpuPercent ?? null)}</dd></div>
            <div><dt>{t("monitoring.memory")}</dt><dd>{formatBytes(response.snapshot.host?.memoryUsedBytes ?? null)} / {formatBytes(response.snapshot.host?.memoryTotalBytes ?? null)}</dd></div>
            <div><dt>{t("monitoring.available_memory")}</dt><dd>{formatBytes(response.snapshot.host?.memoryAvailableBytes ?? null)}</dd></div>
            <div><dt>{t("monitoring.load_average")}</dt><dd>{formatLoadAverage(response.snapshot.host?.loadAverage ?? null)}</dd></div>
            <div><dt>{t("monitoring.uptime")}</dt><dd>{formatUptime(response.snapshot.host?.uptimeSec ?? null)}</dd></div>
          </dl>
          <Sparkline points={hostHistoryPoints} metric="cpuPercent" />
        </article>

        <article className="monitoring-card">
          <div className="monitoring-card__header">
            <h2>{t("monitoring.runtime_summary_title")}</h2>
            <Tag>{response.snapshot.mode}</Tag>
          </div>
          {response.snapshot.runtime ? (
            <>
              <dl className="monitoring-metrics">
                <div><dt>{t("monitoring.server_cpu")}</dt><dd>{formatPercent(response.snapshot.runtime.serverCpuPercent)}</dd></div>
                <div><dt>{t("monitoring.server_memory")}</dt><dd>{formatBytes(response.snapshot.runtime.serverMemoryBytes)}</dd></div>
                <div><dt>{t("monitoring.managed_cpu")}</dt><dd>{formatPercent(response.snapshot.runtime.totalManagedCpuPercent)}</dd></div>
                <div><dt>{t("monitoring.managed_memory")}</dt><dd>{formatBytes(response.snapshot.runtime.totalManagedMemoryBytes)}</dd></div>
                <div><dt>{t("monitoring.process_count")}</dt><dd>{response.snapshot.runtime.managedProcessCount}</dd></div>
              </dl>
              <Sparkline points={runtimeHistoryPoints} metric="cpuPercent" />
            </>
          ) : processCollectionDegraded ? (
            <Notice
              tone="warning"
              title={t("monitoring.process_collection_degraded")}
              message={
                response.telemetry?.failureReason ?? t("monitoring.process_collection_unavailable")
              }
            />
          ) : (
            <Notice
              tone="info"
              title={t("monitoring.runtime_summary_disabled")}
              message={t("monitoring.enable_runtime_summary")}
            />
          )}
        </article>
      </section>
    </>
  );

  const attribution = (
    <section className={`monitoring-attribution ${isMobile ? "monitoring-attribution--mobile" : ""}`}>
      <div className="monitoring-tree">
        <h2>{t("monitoring.attribution_tree")}</h2>
        {sortedWorkspaces.length === 0 && sortedSessions.length === 0 ? (
          <Notice tone="info" title={t("monitoring.attribution_disabled")} message={t("monitoring.enable_attribution")} />
        ) : (
          <>
            {sortedWorkspaces.map((entity) => (
              <button key={entity.id} type="button" className="monitoring-entity-row" onClick={() => setSelectedEntityId(entity.id)}>
                <span>{entity.label}</span>
                <span>{sortMetric === "cpu" ? formatPercent(entity.cpuPercent) : formatBytes(entity.memoryBytes)}</span>
              </button>
            ))}
            {sortedSessions.map((entity) => (
              <button key={entity.id} type="button" className="monitoring-entity-row monitoring-entity-row--child" onClick={() => setSelectedEntityId(entity.id)}>
                <span>{entity.label}</span>
                <span>{sortMetric === "cpu" ? formatPercent(entity.cpuPercent) : formatBytes(entity.memoryBytes)}</span>
              </button>
            ))}
            {sortedProcesses.map((entity) => (
              <button
                key={entity.id}
                type="button"
                className="monitoring-entity-row monitoring-entity-row--child"
                onClick={() => setSelectedEntityId(entity.id)}
              >
                <span>{entity.label}</span>
                <span>{sortMetric === "cpu" ? formatPercent(entity.cpuPercent) : formatBytes(entity.memoryBytes)}</span>
              </button>
            ))}
          </>
        )}
      </div>

      <div className="monitoring-detail">
        <h2>{t("monitoring.detail_panel")}</h2>
        {selectedEntity ? (
          <>
            <dl className="monitoring-metrics">
              <div><dt>{t("monitoring.cpu")}</dt><dd>{formatPercent(selectedEntity.cpuPercent)}</dd></div>
              <div><dt>{t("monitoring.memory")}</dt><dd>{formatBytes(selectedEntity.memoryBytes)}</dd></div>
              <div><dt>{t("monitoring.process_count")}</dt><dd>{selectedEntity.processCount}</dd></div>
              <div><dt>{t("monitoring.uptime")}</dt><dd>{formatUptime(selectedEntity.uptimeSec)}</dd></div>
            </dl>
            <Sparkline points={selectedHistoryPoints} metric="cpuPercent" />
          </>
        ) : (
          <EmptyState title={t("monitoring.select_entity")} />
        )}
      </div>
    </section>
  );

  const processPane =
    response.snapshot.subprocessGroups.length > 0 ? (
      <section className="monitoring-process-list">
        {sortedProcesses.map((entity) => (
          <button key={entity.id} type="button" className="monitoring-entity-row" onClick={() => setSelectedEntityId(entity.id)}>
            <span>{entity.label}</span>
            <span>{sortMetric === "cpu" ? formatPercent(entity.cpuPercent) : formatBytes(entity.memoryBytes)}</span>
          </button>
        ))}
      </section>
    ) : processCollectionDegraded ? (
      <Notice
        tone="warning"
        title={t("monitoring.process_collection_degraded")}
        message={response.telemetry?.failureReason ?? t("monitoring.process_collection_unavailable")}
      />
    ) : (
      <Notice tone="info" title={t("monitoring.subprocess_disabled")} message={t("monitoring.enable_subprocess")} />
    );

  return (
    <div className={`monitoring-page ${isMobile ? "monitoring-page--mobile" : ""}`}>
      <header className="monitoring-header">{header}</header>
      <main className="monitoring-content">
        <div className="monitoring-toolbar">
          <div className="monitoring-toolbar__meta">
            <Tag>{response.snapshot.mode}</Tag>
            <span>{formatRefreshInterval(response.settings.sampleIntervalMs)}</span>
            <span>{response.snapshot.sampledAt > 0 ? new Date(response.snapshot.sampledAt).toLocaleTimeString() : "—"}</span>
            <span>{connectionStatus}</span>
          </div>
          <div className="monitoring-toolbar__actions">
            <SegmentedControl
              label={t("monitoring.sort_by")}
              value={sortMetric}
              onChange={(value) => setSortMetric(value as SortMetric)}
              options={[
                { value: "cpu", label: t("monitoring.cpu") },
                { value: "memory", label: t("monitoring.memory") },
              ]}
            />
            <SegmentedControl
              label={t("monitoring.time_window")}
              value={String(rangeMinutes)}
              onChange={(value) => setRangeMinutes(Number(value) as RangeMinutes)}
              options={[
                { value: "5", label: "5m" },
                { value: "15", label: "15m" },
                { value: "30", label: "30m" },
              ]}
            />
            <Button type="button" onClick={() => void refresh()}>{t("action.refresh")}</Button>
          </div>
        </div>

        {isMobile ? (
          <>
            <SegmentedControl
              label={t("monitoring.mobile_section")}
              value={mobileSection}
              onChange={(value) => setMobileSection(value as MobileSection)}
              options={[
                { value: "overview", label: t("monitoring.mobile_overview") },
                { value: "attribution", label: t("monitoring.mobile_attribution") },
                { value: "process", label: t("monitoring.mobile_process") },
              ]}
            />
            {mobileSection === "overview" ? overview : null}
            {mobileSection === "attribution" ? attribution : null}
            {mobileSection === "process" ? processPane : null}
          </>
        ) : (
          <>
            {overview}
            {attribution}
          </>
        )}
      </main>
    </div>
  );
}
```

Update `packages/web/src/shells/desktop-shell.tsx`:

```tsx
import { MonitoringPage } from "../features/monitoring";

  const shouldBypassAuthLoading =
    location.pathname.startsWith("/settings") ||
    location.pathname.startsWith("/diagnostics") ||
    location.pathname.startsWith("/monitoring") ||
    location.pathname === "/session-gate";

            <Route path="/monitoring" element={<MonitoringPage />} />
```

Update `packages/web/src/shells/mobile-shell/index.tsx` with the same bypass and route additions.

- [ ] **Step 4: Run the web monitoring and route tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/monitoring/page.test.tsx \
  src/shells/desktop-shell.test.tsx \
  src/shells/mobile-shell/index.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the monitoring page**

```bash
git add packages/web/src/features/monitoring/index.ts \
  packages/web/src/features/monitoring/formatters.ts \
  packages/web/src/features/monitoring/sparkline.tsx \
  packages/web/src/features/monitoring/page.tsx \
  packages/web/src/features/monitoring/page.test.tsx \
  packages/web/src/shells/desktop-shell.tsx \
  packages/web/src/shells/mobile-shell/index.tsx \
  packages/web/src/shells/desktop-shell.test.tsx \
  packages/web/src/shells/mobile-shell/index.test.tsx
git commit -m "feat(web): add monitoring route and live page"
```

### Task 8: Add Monitoring Settings, Command Palette Entry, Copy, And Styling

**Files:**
- Create: `packages/web/src/features/settings/components/monitoring-settings-card.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing settings and command-palette tests**

Add to `packages/web/src/features/settings/components/settings-page.test.tsx`:

```ts
  it("renders monitoring settings in General and enforces dependency rules", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      "monitoring.enabled": false,
      "monitoring.hostMetricsEnabled": true,
      "monitoring.runtimeSummaryEnabled": true,
      "monitoring.workspaceAttributionEnabled": true,
      "monitoring.subprocessDrilldownEnabled": false,
      "monitoring.sampleIntervalMs": 2000,
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);

    expect(await screen.findByText("Performance monitoring")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("switch", { name: "Enable performance monitoring" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            monitoring: expect.objectContaining({
              enabled: true,
            }),
          },
        },
        undefined
      );
    });

    fireEvent.click(screen.getByRole("switch", { name: "Subprocess drill-down" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "settings.update",
        {
          settings: {
            monitoring: expect.objectContaining({
              subprocessDrilldownEnabled: true,
              workspaceAttributionEnabled: true,
              runtimeSummaryEnabled: true,
            }),
          },
        },
        undefined
      );
    });
  });
```

Add to `packages/web/src/features/command-palette/components/command-palette.test.tsx`:

```ts
  it("opens Monitoring from the quick actions list", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(commandPaletteOpenAtom, true);
    store.set(workspacesAtom, {
      "ws-1": createWorkspace("ws-1", "/tmp/one"),
    });
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    fireEvent.click(screen.getByText("Monitoring"));

    expect(routerMocks.navigate).toHaveBeenCalledWith("/monitoring");
  });
```

Add a theme-surface assertion to `packages/web/src/styles/components.theme.test.ts`:

```ts
  it("routes monitoring surfaces through theme tokens", () => {
    expect(getLastRuleBlock(".monitoring-card")).toContain("var(--surface-elevated)");
    expect(getLastRuleBlock(".monitoring-entity-row")).toContain("var(--border-subtle)");
  });
```

- [ ] **Step 2: Run the settings, palette, and theme tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/styles/components.theme.test.ts
```

Expected: FAIL because the monitoring settings card, palette entry, locales, and styles do not exist yet.

- [ ] **Step 3: Implement monitoring settings, command entry, copy, and CSS**

Create `packages/web/src/features/settings/components/monitoring-settings-card.tsx`:

```tsx
import type { MonitoringMode, MonitoringSampleIntervalMs, MonitoringSettings } from "@coder-studio/core";
import { Button, Notice, SegmentedControl, Switch, Tag } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";

type MonitoringPreset = "light" | "standard" | "deep" | "custom";

function toPreset(settings: MonitoringSettings): MonitoringPreset {
  if (settings.subprocessDrilldownEnabled) return "deep";
  if (settings.workspaceAttributionEnabled) return "standard";
  if (settings.hostMetricsEnabled || settings.runtimeSummaryEnabled) return "light";
  return "custom";
}

export function MonitoringSettingsCard({
  settings,
  mode,
  onChange,
  onOpenMonitoring,
}: {
  settings: MonitoringSettings;
  mode: MonitoringMode;
  onChange(next: MonitoringSettings): Promise<void>;
  onOpenMonitoring: () => void;
}) {
  const t = useTranslation();

  const applyDependencies = (next: MonitoringSettings): MonitoringSettings => {
    if (!next.runtimeSummaryEnabled) {
      next.workspaceAttributionEnabled = false;
      next.subprocessDrilldownEnabled = false;
    }
    if (!next.workspaceAttributionEnabled) {
      next.subprocessDrilldownEnabled = false;
    }
    if (next.subprocessDrilldownEnabled) {
      next.workspaceAttributionEnabled = true;
      next.runtimeSummaryEnabled = true;
    }
    if (next.workspaceAttributionEnabled) {
      next.runtimeSummaryEnabled = true;
    }
    return next;
  };

  const applyPreset = async (preset: MonitoringPreset) => {
    const base = {
      ...settings,
      enabled: true,
      hostMetricsEnabled: true,
    };

    if (preset === "light") {
      await onChange(
        applyDependencies({
          ...base,
          runtimeSummaryEnabled: true,
          workspaceAttributionEnabled: false,
          subprocessDrilldownEnabled: false,
        })
      );
      return;
    }

    if (preset === "standard") {
      await onChange(
        applyDependencies({
          ...base,
          runtimeSummaryEnabled: true,
          workspaceAttributionEnabled: true,
          subprocessDrilldownEnabled: false,
        })
      );
      return;
    }

    if (preset === "deep") {
      await onChange(
        applyDependencies({
          ...base,
          runtimeSummaryEnabled: true,
          workspaceAttributionEnabled: true,
          subprocessDrilldownEnabled: true,
        })
      );
    }
  };

  return (
    <section className="settings-card settings-card--monitoring" aria-label={t("monitoring.settings_group")}>
      <div className="settings-card__header">
        <div>
          <h3>{t("monitoring.settings_group")}</h3>
          <p>{t("monitoring.settings_description")}</p>
        </div>
        <div className="settings-card__header-actions">
          <Tag>{mode}</Tag>
          <Button type="button" kind="secondary" onClick={onOpenMonitoring}>
            {t("monitoring.open_monitoring")}
          </Button>
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field__copy">
          <label htmlFor="monitoring-enabled">{t("monitoring.enable_monitoring")}</label>
          <p>{t("monitoring.enable_monitoring_hint")}</p>
        </div>
        <Switch
          id="monitoring-enabled"
          checked={settings.enabled}
          onCheckedChange={(checked) => void onChange({ ...settings, enabled: checked })}
          aria-label={t("monitoring.enable_monitoring")}
        />
      </div>

      <SegmentedControl
        label={t("monitoring.preset")}
        value={toPreset(settings)}
        onChange={(value) => void applyPreset(value as MonitoringPreset)}
        options={[
          { value: "light", label: "Light" },
          { value: "standard", label: "Standard" },
          { value: "deep", label: "Deep" },
          { value: "custom", label: "Custom" },
        ]}
      />

      {!settings.enabled ? (
        <Notice tone="info" title={t("monitoring.disabled_title")} message={t("monitoring.disabled_settings_hint")} />
      ) : null}

      <div className="monitoring-settings-grid">
        <Switch
          checked={settings.hostMetricsEnabled}
          onCheckedChange={(checked) => void onChange(applyDependencies({ ...settings, hostMetricsEnabled: checked }))}
          aria-label={t("monitoring.host_metrics")}
        />
        <Switch
          checked={settings.runtimeSummaryEnabled}
          onCheckedChange={(checked) => void onChange(applyDependencies({ ...settings, runtimeSummaryEnabled: checked }))}
          aria-label={t("monitoring.runtime_summary_setting")}
          disabled={!settings.enabled}
        />
        <Switch
          checked={settings.workspaceAttributionEnabled}
          onCheckedChange={(checked) => void onChange(applyDependencies({ ...settings, workspaceAttributionEnabled: checked }))}
          aria-label={t("monitoring.workspace_attribution")}
          disabled={!settings.enabled}
        />
        <Switch
          checked={settings.subprocessDrilldownEnabled}
          onCheckedChange={(checked) => void onChange(applyDependencies({ ...settings, subprocessDrilldownEnabled: checked }))}
          aria-label={t("monitoring.subprocess_drilldown")}
          disabled={!settings.enabled}
        />
      </div>

      <SegmentedControl
        label={t("monitoring.refresh_rate")}
        value={String(settings.sampleIntervalMs)}
        onChange={(value) =>
          void onChange({ ...settings, sampleIntervalMs: Number(value) as MonitoringSampleIntervalMs })
        }
        options={[
          { value: "1000", label: "1s" },
          { value: "2000", label: "2s" },
          { value: "5000", label: "5s" },
          { value: "10000", label: "10s" },
        ]}
      />
    </section>
  );
}
```

Update `packages/web/src/features/settings/components/settings-page.tsx` by importing from `@coder-studio/core`:

```ts
  createDefaultMonitoringSettings,
  deriveMonitoringMode,
  resolveMonitoringSettings,
  type MonitoringSettings,
```

Add state:

```ts
  const [monitoringSettings, setMonitoringSettings] = useState<MonitoringSettings>(
    createDefaultMonitoringSettings()
  );
```

When hydrating `settings.get`, resolve and store monitoring settings:

```ts
      setMonitoringSettings(resolveMonitoringSettings(result.data ?? {}));
```

Add a save helper beside the existing `saveUpdateSettings`:

```ts
  const saveMonitoringSettings = async (next: MonitoringSettings) => {
    const previous = monitoringSettings;
    setMonitoringSettings(next);

    const result = await dispatch("settings.update", {
      settings: {
        monitoring: {
          enabled: next.enabled,
          hostMetricsEnabled: next.hostMetricsEnabled,
          runtimeSummaryEnabled: next.runtimeSummaryEnabled,
          workspaceAttributionEnabled: next.workspaceAttributionEnabled,
          subprocessDrilldownEnabled: next.subprocessDrilldownEnabled,
          sampleIntervalMs: next.sampleIntervalMs,
        },
      },
    });

    if (result === null || !result.ok) {
      setMonitoringSettings(previous);
    }
  };
```

Mount the new card inside `GeneralSettings` by extending props:

```tsx
            monitoringSettings={monitoringSettings}
            onMonitoringSettingsChange={saveMonitoringSettings}
```

and inside `GeneralSettings`:

```tsx
      <MonitoringSettingsCard
        settings={monitoringSettings}
        mode={deriveMonitoringMode(monitoringSettings)}
        onChange={onMonitoringSettingsChange}
        onOpenMonitoring={() => navigate("/monitoring")}
      />
```

Update `packages/web/src/features/command-palette/components/command-palette.tsx`:

```ts
    {
      id: "open-monitoring",
      label: t("monitoring.command_label"),
      description: t("monitoring.command_description"),
      action: () => {
        navigate("/monitoring");
      },
    },
```

Add locale keys to both locale files:

```json
{
  "monitoring.title": "Performance monitoring",
  "monitoring.command_label": "Monitoring",
  "monitoring.command_description": "Open the performance monitoring page",
  "monitoring.settings_group": "Performance monitoring",
  "monitoring.settings_description": "Control whether runtime sampling is enabled and how deep it goes.",
  "monitoring.enable_monitoring": "Enable performance monitoring",
  "monitoring.enable_monitoring_hint": "Sampling is disabled by default to avoid background overhead.",
  "monitoring.disabled_title": "Monitoring disabled",
  "monitoring.disabled_description": "No background sampling is running. Enable monitoring in settings before using this page.",
  "monitoring.disabled_settings_hint": "Turn monitoring on to start collecting host and runtime data.",
  "monitoring.open_settings": "Open Settings",
  "monitoring.open_monitoring": "Open Monitoring",
  "monitoring.loading": "Loading monitoring snapshot…",
  "monitoring.load_failed": "Monitoring failed to load",
  "monitoring.host_overview": "Host overview",
  "monitoring.runtime_summary_title": "Coder Studio footprint",
  "monitoring.runtime_summary_disabled": "Runtime summary disabled",
  "monitoring.enable_runtime_summary": "Enable runtime summary in settings",
  "monitoring.process_collection_degraded": "Process metrics unavailable",
  "monitoring.process_collection_unavailable": "Process collection is temporarily unavailable.",
  "monitoring.attribution_tree": "Attribution tree",
  "monitoring.attribution_disabled": "Attribution disabled",
  "monitoring.enable_attribution": "Enable workspace and session attribution in settings",
  "monitoring.subprocess_disabled": "Subprocess drill-down disabled",
  "monitoring.enable_subprocess": "Enable subprocess drill-down in settings",
  "monitoring.detail_panel": "Detail panel",
  "monitoring.select_entity": "Select a workspace, session, or process to inspect details.",
  "monitoring.cpu": "CPU",
  "monitoring.memory": "Memory",
  "monitoring.available_memory": "Available memory",
  "monitoring.load_average": "Load average",
  "monitoring.uptime": "Uptime",
  "monitoring.server_cpu": "Server CPU",
  "monitoring.server_memory": "Server memory",
  "monitoring.managed_cpu": "Managed CPU",
  "monitoring.managed_memory": "Managed memory",
  "monitoring.process_count": "Process count",
  "monitoring.sort_by": "Sort by",
  "monitoring.time_window": "Time window",
  "monitoring.refresh_rate": "Refresh rate",
  "monitoring.preset": "Preset",
  "monitoring.host_metrics": "Host metrics",
  "monitoring.runtime_summary_setting": "Runtime summary",
  "monitoring.workspace_attribution": "Workspace and session attribution",
  "monitoring.subprocess_drilldown": "Subprocess drill-down",
  "monitoring.mobile_section": "Monitoring section",
  "monitoring.mobile_overview": "Overview",
  "monitoring.mobile_attribution": "Attribution",
  "monitoring.mobile_process": "Process"
}
```

Add matching Chinese translations to `packages/web/src/locales/zh.json`.

Update `packages/web/src/styles/components.css` with monitoring styles that only reference theme tokens already used elsewhere:

```css
.monitoring-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.monitoring-content {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  padding: var(--sp-5);
}

.monitoring-toolbar,
.monitoring-overview-grid,
.monitoring-attribution {
  display: grid;
  gap: var(--sp-4);
}

.monitoring-overview-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.monitoring-attribution {
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
}

.monitoring-card,
.settings-card--monitoring,
.monitoring-tree,
.monitoring-detail,
.monitoring-process-list {
  border: 1px solid var(--border-subtle);
  background: var(--surface-elevated);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
}

.monitoring-card {
  padding: var(--sp-4);
}

.monitoring-entity-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
  color: inherit;
  text-align: left;
}

.monitoring-entity-row--child {
  padding-left: var(--sp-7);
}

.monitoring-sparkline {
  color: var(--accent-11);
}

.monitoring-page--mobile .monitoring-content,
.settings-page--mobile .monitoring-settings-grid {
  gap: var(--sp-3);
}

@media (max-width: 900px) {
  .monitoring-overview-grid,
  .monitoring-attribution {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Run the settings, palette, and theme tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/styles/components.theme.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the settings and presentation layer**

```bash
git add packages/web/src/features/settings/components/monitoring-settings-card.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/command-palette/components/command-palette.tsx \
  packages/web/src/features/command-palette/components/command-palette.test.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): add monitoring settings and controls"
```

### Task 9: Run Cross-Layer Monitoring Verification And Finish The Feature

**Files:**
- Modify: `packages/web/src/features/monitoring/page.test.tsx`
- Modify: `packages/server/src/__tests__/monitoring/service.test.ts`
- Modify: `packages/server/src/__tests__/monitoring/aggregation.test.ts`

- [ ] **Step 1: Add the final gap-closing tests before the broad verification run**

Extend `packages/web/src/features/monitoring/page.test.tsx` with two more cases:

```ts
  it("keeps the page usable when process collection is degraded", async () => {
    const response = {
      settings: {
        enabled: true,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: true,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 10,
        mode: "deep",
        host: {
          cpuPercent: 95,
          memoryUsedBytes: 900,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 100,
          loadAverage: [2, 2, 2],
          uptimeSec: 60,
          pressure: "hot",
        },
        runtime: null,
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [{ sampledAt: 10, cpuPercent: 95, memoryBytes: 900 }] },
        runtime: null,
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: true,
        processMetricsAvailable: false,
        subprocessHistoryLimited: false,
      },
      telemetry: {
        durationMs: 50,
        processRowCount: 0,
        subprocessGroupCount: 0,
        historyTrimmed: false,
        degraded: true,
        failureReason: "ps failed",
      },
    };

    renderMonitoringPage(response);

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(screen.getByText("Process metrics unavailable")).toBeInTheDocument();
  });
```

Extend `packages/server/src/__tests__/monitoring/service.test.ts`:

```ts
  it("clears history when monitoring is turned off", async () => {
    let enabled = true;
    const service = new MonitoringService({
      broadcaster: { broadcast: vi.fn() },
      settingsRepo: {
        get: (key: string) => {
          const settings = {
            "monitoring.enabled": enabled,
            "monitoring.hostMetricsEnabled": true,
            "monitoring.runtimeSummaryEnabled": true,
            "monitoring.workspaceAttributionEnabled": true,
            "monitoring.subprocessDrilldownEnabled": true,
            "monitoring.sampleIntervalMs": 2000,
          } as Record<string, unknown>;
          return settings[key];
        },
      },
      registry: new ManagedProcessRegistry({ now: () => 10 }),
      sessionMgr: { getAll: () => [], findSessionIdByTerminal: () => undefined },
      terminalMgr: { getAll: () => [] },
      hostCollector: {
        collect: () => ({
          cpuPercent: 30,
          memoryUsedBytes: 300,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 700,
          loadAverage: [0.3, 0.2, 0.1],
          uptimeSec: 10,
          pressure: "normal",
        }),
      },
      processCollector: { collect: async () => [] },
      setInterval: vi.fn(() => ({ unref: vi.fn() })),
      clearInterval: vi.fn(),
      now: () => 10,
    });

    service.start();
    await service.recheck();
    enabled = false;
    service.reloadFromSettings();

    expect(service.getResponse().history.host.points).toEqual([]);
    expect(service.getResponse().snapshot.mode).toBe("disabled");
  });
```

- [ ] **Step 2: Run the focused web and server monitoring suites**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/monitoring/managed-process-registry.test.ts \
  src/__tests__/monitoring/host-collector.test.ts \
  src/__tests__/monitoring/process-table.test.ts \
  src/__tests__/monitoring/aggregation.test.ts \
  src/__tests__/monitoring/service.test.ts \
  src/__tests__/monitoring/commands.test.ts \
  src/__tests__/server-monitoring-hydration.test.ts \
  src/commands/settings.test.ts
```

Expected: PASS.

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/monitoring/page.test.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/shells/desktop-shell.test.tsx \
  src/shells/mobile-shell/index.test.tsx \
  src/styles/components.theme.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the shared-domain and typecheck verification**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/monitoring.test.ts
```

Expected: PASS.

Run:

```bash
pnpm ci:typecheck
```

Expected: PASS across `@coder-studio/core`, `@coder-studio/server`, and `@coder-studio/web`.

- [ ] **Step 4: Review the full monitoring diff and commit the final gap-fixes**

Run:

```bash
git status --short
git log --oneline --decorate --max-count=12
```

Expected: `git status --short` is clean and the recent commit log only contains the monitoring feature commits from Tasks 1-8 plus this task's final gap-fix commit if one was needed.

If the final test additions in this task changed files, commit them:

```bash
git add packages/web/src/features/monitoring/page.test.tsx \
  packages/server/src/__tests__/monitoring/service.test.ts \
  packages/server/src/__tests__/monitoring/aggregation.test.ts
git commit -m "test: close monitoring verification gaps"
```

- [ ] **Step 5: Prepare review handoff**

Record the verification commands and their pass/fail status in the task log that the final code-review subagent will use:

```text
core monitoring test: PASS
server monitoring suite: PASS
web monitoring suite: PASS
typecheck: PASS
```

Use that log, plus the final commit range for the feature branch, when dispatching the full-feature review subagent after implementation.
