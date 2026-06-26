# Startup Readiness And Startup Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate false startup timeout reports from the global/production `coder-studio` CLI and reduce actual time-to-ready by shortening the server's pre-listen critical path.

**Architecture:** Keep the PM2-managed startup model unchanged. Fix the CLI first so it distinguishes "still starting" from "startup failed", then extend the wait budget to match real production startup. On the server side, move non-critical warmup work off the `await app.listen(...)` path so `runtime.json` can be written earlier without changing steady-state behavior.

**Tech Stack:** TypeScript, Vitest, PM2-managed CLI startup, Fastify server, runtime.json readiness file.

---

### Task 1: Fix The CLI Readiness Heuristic

**Files:**
- Modify: `packages/cli/src/pm2-control.ts`
- Modify: `packages/cli/src/pm2-control.test.ts`
- Modify: `packages/cli/src/cli.ts`
- Test: `packages/cli/src/pm2-control.test.ts`

- [ ] **Step 1: Add failing tests for slow-but-successful startup**

In `packages/cli/src/pm2-control.test.ts`, add cases that prove the CLI should keep waiting while PM2 is still online and only fail when PM2 has clearly failed:

```ts
it("keeps waiting while pm2 stays online and runtime.json is still pending", async () => {
  start.mockImplementationOnce(
    (_config: unknown, callback: (error: Error | null, apps: unknown[]) => void) => {
      callback(null, [{ pm_id: 1 }]);
    }
  );

  let readinessChecks = 0;
  describeProcess.mockImplementation(
    (_name: string, callback: (error: Error | null, result: unknown[]) => void) => {
      readinessChecks += 1;
      callback(null, [{ pid: 424242, pm2_env: { status: "online", restart_time: 0 } }]);
    }
  );

  const pendingStart = startManagedServer({
    script: "/cli/dist/esm/server-runner.js",
    cwd: "/repo",
    waitMs: 50,
  });

  setTimeout(() => {
    writeRuntimeConfig({
      host: "127.0.0.1",
      port: 4187,
      pid: 424242,
      token: "test-token",
      serverInstanceId: "server-1",
      startedAt: Date.now(),
    });
  }, 10);

  await expect(pendingStart).resolves.toBeUndefined();
  expect(readinessChecks).toBeGreaterThan(0);
});

it("fails startup when pm2 enters errored before runtime.json is written", async () => {
  start.mockImplementationOnce(
    (_config: unknown, callback: (error: Error | null, apps: unknown[]) => void) => {
      callback(null, [{ pm_id: 1 }]);
    }
  );

  describeProcess.mockImplementationOnce(
    (_name: string, callback: (error: Error | null, result: unknown[]) => void) =>
      callback(null, [{ pid: 424242, pm2_env: { status: "errored", restart_time: 1 } }])
  );

  await expect(
    startManagedServer({
      script: "/cli/dist/esm/server-runner.js",
      cwd: "/repo",
      waitMs: 50,
    })
  ).rejects.toThrow("the managed process entered the errored state");
});
```

- [ ] **Step 2: Run the CLI readiness tests and confirm the new slow-start case fails**

Run:

```bash
pnpm vitest packages/cli/src/pm2-control.test.ts --run
```

Expected: FAIL because the current readiness loop only accepts `runtime.json` and times out even while PM2 remains online.

- [ ] **Step 3: Refactor readiness into explicit states**

In `packages/cli/src/pm2-control.ts`, replace the open-coded polling logic with a helper that returns `ready`, `pending`, or `failed`:

```ts
interface RuntimeReadinessState {
  kind: "ready" | "pending" | "failed";
  reason?: string;
}

async function readRuntimeReadiness(pm2: Pm2Module): Promise<RuntimeReadinessState> {
  if (readRuntimeConfig()) {
    return { kind: "ready" };
  }

  const processes = await describeManagedServer(pm2);
  const process = processes[0];
  if (!process) {
    return {
      kind: "failed",
      reason: "the managed process exited before runtime data was written",
    };
  }

  const status = process.pm2_env?.status;
  if (status === "errored" || status === "stopped") {
    return {
      kind: "failed",
      reason: `the managed process entered the ${status} state`,
    };
  }

  return { kind: "pending" };
}
```

Update `waitForRuntimeReady(...)` to use this helper so:
- `ready` returns immediately
- `failed` throws the existing startup error with log excerpts
- `pending` continues polling until the deadline

- [ ] **Step 4: Increase the managed-start wait window**

In `packages/cli/src/cli.ts`, change:

```ts
const MANAGED_SERVER_WAIT_MS = 15000;
```

This keeps the change centralized for both `coder-studio serve` and `coder-studio open`.

- [ ] **Step 5: Re-run the CLI readiness tests**

Run:

```bash
pnpm vitest packages/cli/src/pm2-control.test.ts --run
```

Expected: PASS, including the slow-start success case and errored-state failure case.

- [ ] **Step 6: Commit the CLI readiness fix**

```bash
git add packages/cli/src/cli.ts packages/cli/src/pm2-control.ts packages/cli/src/pm2-control.test.ts
git commit -m "fix(cli): tolerate slow managed startup"
```

### Task 2: Move Non-Critical Warmup Off The Pre-Listen Path

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/__tests__/server-runtime-config.test.ts`
- Test: `packages/server/src/__tests__/server-runtime-config.test.ts`

- [ ] **Step 1: Add a failing runtime-config timing test**

In `packages/server/src/__tests__/server-runtime-config.test.ts`, add a timing-oriented assertion that proves startup writes `runtime.json` promptly enough for the CLI contract. Keep it black-box and avoid adding test-only hooks to `createServer`.

Use a simple upper bound around server creation:

```ts
it("writes runtime config during startup", async () => {
  const startedAt = Date.now();

  server = await createRuntimeServer({
    stateDir: join(testHomeDir, "server-state"),
    host: "127.0.0.1",
    port: 0,
    writeRuntimeConfig: true,
  });

  const runtime = readRuntimeConfig();
  expect(runtime).toEqual(
    expect.objectContaining({
      host: "127.0.0.1",
      pid: process.pid,
    })
  );
  expect(runtime?.startedAt).toBeGreaterThanOrEqual(startedAt);
});
```

This test is intentionally narrow: it guards the readiness side effect without introducing unsupported `__testOverrides`.

- [ ] **Step 2: Run the server runtime-config test**

Run:

```bash
pnpm vitest packages/server/src/__tests__/server-runtime-config.test.ts --run
```

Expected: PASS before refactor. This is a characterization test that protects the existing contract while the startup order changes.

- [ ] **Step 3: Defer the clearly non-critical warmup calls**

In `packages/server/src/server.ts`, move these calls so they no longer block `await app.listen(...)` and `writeRuntimeConfig(...)`:

```ts
workAnalysisService.startAutoScan();
workspaceMgr.hydrateWatchers();
await agentInstructionPublisher.syncAllOpenWorkspaces();
updateService.start();
monitoringService.start();
```

Refactor them into a post-listen function with failure isolation:

```ts
const runPostListenWarmup = async () => {
  workAnalysisService.startAutoScan();
  workspaceMgr.hydrateWatchers();
  await agentInstructionPublisher.syncAllOpenWorkspaces();
  updateService.start();
  monitoringService.start();
};
```

Invoke it only after:

```ts
await app.listen({ host: config.host, port: config.port });
writeRuntimeConfig(runtime);
void runPostListenWarmup().catch((error) => {
  app.log.warn({ err: error }, "post-listen warmup failed");
});
```

Keep these on the pre-listen path:
- `buildFastifyApp(...)`
- `await sessionMgr.hydrate()`
- supervisor wiring needed for normal runtime construction
- `await app.listen(...)`
- `writeRuntimeConfig(...)`

- [ ] **Step 4: Re-run the server runtime-config test**

Run:

```bash
pnpm vitest packages/server/src/__tests__/server-runtime-config.test.ts --run
```

Expected: PASS.

- [ ] **Step 5: Commit the startup-path reduction**

```bash
git add packages/server/src/server.ts packages/server/src/__tests__/server-runtime-config.test.ts
git commit -m "perf(server): defer non-critical startup warmup"
```

### Task 3: Add Startup Phase Timing Logs

**Files:**
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/src/__tests__/server-runtime-config.test.ts`

- [ ] **Step 1: Add minimal startup timing instrumentation**

In `packages/server/src/server.ts`, add small, flat timing logs for the highest-value phases:

```ts
const startupAt = Date.now();

function logStartupPhase(app: FastifyInstance | null, label: string, startedAt: number) {
  const elapsedMs = Date.now() - startedAt;
  if (app) {
    app.log.info({ elapsedMs }, `[startup] ${label}`);
    return;
  }

  console.log(`[startup] ${label}=${elapsedMs}ms`);
}
```

Log at least:
- `builtinSkillSync`
- `buildFastifyApp`
- `sessionHydrate`
- `listen`
- `runtimeConfigWritten`
- `postListenWarmupScheduled`

Keep the output single-line and grep-friendly so future production log checks can identify where startup time is spent.

- [ ] **Step 2: Add or extend a test only if the repo already has a stable log assertion pattern**

If there is no stable existing pattern for asserting server startup logs, skip a dedicated log assertion test and rely on the targeted runtime-config test plus manual diff review. Do not add brittle logger mocks just to satisfy instrumentation.

- [ ] **Step 3: Run the targeted tests**

Run:

```bash
pnpm vitest packages/cli/src/pm2-control.test.ts packages/server/src/__tests__/server-runtime-config.test.ts --run
```

Expected: PASS.

- [ ] **Step 4: Commit the timing diagnostics**

```bash
git add packages/server/src/server.ts packages/server/src/__tests__/server-runtime-config.test.ts
git commit -m "chore(server): log startup phase timings"
```

### Task 4: Repository Verification

**Files:**
- Test: `packages/cli/src/pm2-control.test.ts`
- Test: `packages/server/src/__tests__/server-runtime-config.test.ts`

- [ ] **Step 1: Run targeted startup tests**

Run:

```bash
pnpm vitest packages/cli/src/pm2-control.test.ts packages/server/src/__tests__/server-runtime-config.test.ts --run
```

Expected: PASS.

- [ ] **Step 2: Run repository verification**

Run:

```bash
pnpm ci:verify
```

Expected: PASS.

- [ ] **Step 3: Review the scoped diff**

Run:

```bash
git diff -- packages/cli/src/cli.ts packages/cli/src/pm2-control.ts packages/cli/src/pm2-control.test.ts packages/server/src/server.ts packages/server/src/__tests__/server-runtime-config.test.ts docs/superpowers/plans/2026-06-15-startup-readiness-and-startup-path.md
```

Expected: Only readiness detection, wait budget, deferred warmup, startup timing, and the saved plan should appear.

- [ ] **Step 4: Commit the verification pass**

```bash
git add packages/cli/src/cli.ts packages/cli/src/pm2-control.ts packages/cli/src/pm2-control.test.ts packages/server/src/server.ts packages/server/src/__tests__/server-runtime-config.test.ts docs/superpowers/plans/2026-06-15-startup-readiness-and-startup-path.md
git commit -m "test: verify startup readiness changes"
```
