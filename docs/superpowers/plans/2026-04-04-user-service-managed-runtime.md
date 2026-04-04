# User Service Managed Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native user-service managed runtime support so Coder Studio can auto-restart after crashes and transparently proxy the existing lifecycle commands to the installed service.

**Architecture:** Keep the current unmanaged detached runtime flow as fallback, but introduce a separate service control plane in the CLI. A generated launcher becomes the stable service entrypoint, while Linux and macOS adapters own service installation and lifecycle commands.

**Tech Stack:** Node.js CLI, TypeScript `.mts` modules, native `systemd --user`, native `launchd`, existing runtime state and health APIs

---

### Task 1: Add Service State Persistence

**Files:**
- Create: `packages/cli/src/lib/service-state.mts`
- Modify: `packages/cli/src/lib/state.mts`
- Test: `tests/cli/service-state.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  clearServiceState,
  readServiceState,
  writeServiceState,
} from '../../packages/cli/src/lib/service-state.mjs';

test('service state round-trips installation metadata', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-service-state-'));

  await writeServiceState(stateDir, {
    mode: 'managed',
    platform: 'linux-systemd-user',
    serviceName: 'com.spencer-kit.coder-studio',
    launcherPath: '/tmp/launch.sh',
    installedAt: '2026-04-04T00:00:00.000Z',
    lastInstallVersion: '0.2.6',
  });

  const state = await readServiceState(stateDir);
  assert.equal(state.mode, 'managed');
  assert.equal(state.platform, 'linux-systemd-user');
  assert.equal(state.launcherPath, '/tmp/launch.sh');

  await clearServiceState(stateDir);
  assert.equal(await readServiceState(stateDir), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cli/service-state.test.mjs`
Expected: FAIL with module export or file-not-found errors for `service-state.mjs`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/lib/service-state.mts
import fs from 'node:fs/promises';
import path from 'node:path';

const SERVICE_STATE_FILENAME = 'service.json';

function resolveServiceStatePath(stateDir) {
  return path.join(stateDir, SERVICE_STATE_FILENAME);
}

export async function readServiceState(stateDir) {
  try {
    const raw = await fs.readFile(resolveServiceStatePath(stateDir), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeServiceState(stateDir, state) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(resolveServiceStatePath(stateDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function clearServiceState(stateDir) {
  await fs.rm(resolveServiceStatePath(stateDir), { force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cli/service-state.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/service-state.mts tests/cli/service-state.test.mjs
git commit -m "feat: add cli service state persistence"
```

### Task 2: Add Launcher and Bundle Manifest Generation

**Files:**
- Create: `packages/cli/src/lib/service-launcher.mts`
- Modify: `packages/cli/src/lib/config.mts`
- Test: `tests/cli/service-launcher.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeServiceLauncher } from '../../packages/cli/src/lib/service-launcher.mjs';

test('writeServiceLauncher creates a launcher and bundle manifest', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-service-launcher-'));

  const result = await writeServiceLauncher({
    stateDir,
    binaryPath: '/opt/coder-studio/bin/coder-studio-server',
    distDir: '/opt/coder-studio/dist',
    host: '127.0.0.1',
    port: 41033,
    dataDir: path.join(stateDir, 'data'),
  });

  const launcher = await fs.readFile(result.launcherPath, 'utf8');
  const manifest = JSON.parse(await fs.readFile(result.bundleManifestPath, 'utf8'));

  assert.match(launcher, /CODER_STUDIO_PORT=41033/);
  assert.equal(manifest.binaryPath, '/opt/coder-studio/bin/coder-studio-server');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cli/service-launcher.test.mjs`
Expected: FAIL because `service-launcher.mjs` does not exist

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/lib/service-launcher.mts
import fs from 'node:fs/promises';
import path from 'node:path';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

export async function writeServiceLauncher(input) {
  const serviceDir = path.join(input.stateDir, 'service');
  const launcherPath = path.join(serviceDir, 'launch.sh');
  const bundleManifestPath = path.join(serviceDir, 'service-bundle.json');

  await fs.mkdir(serviceDir, { recursive: true });
  await fs.writeFile(bundleManifestPath, `${JSON.stringify({
    binaryPath: input.binaryPath,
    distDir: input.distDir,
  }, null, 2)}\n`, 'utf8');

  const launcher = `#!/bin/sh
set -eu
export CODER_STUDIO_HOST=${shellQuote(input.host)}
export CODER_STUDIO_PORT=${shellQuote(String(input.port))}
export CODER_STUDIO_DATA_DIR=${shellQuote(input.dataDir)}
export CODER_STUDIO_DIST_DIR=${shellQuote(input.distDir)}
exec ${shellQuote(input.binaryPath)}
`;

  await fs.writeFile(launcherPath, launcher, { mode: 0o755 });
  return { launcherPath, bundleManifestPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cli/service-launcher.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/service-launcher.mts tests/cli/service-launcher.test.mjs
git commit -m "feat: add service launcher generation"
```

### Task 3: Add Linux and macOS Service Adapters

**Files:**
- Create: `packages/cli/src/lib/service-adapters/linux-systemd-user.mts`
- Create: `packages/cli/src/lib/service-adapters/macos-launchd-agent.mts`
- Create: `packages/cli/src/lib/service-controller.mts`
- Test: `tests/cli/service-controller.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformServiceController } from '../../packages/cli/src/lib/service-controller.mjs';

test('createPlatformServiceController selects linux systemd user adapter', async () => {
  const controller = createPlatformServiceController({ platform: 'linux' });
  assert.equal(controller.id, 'linux-systemd-user');
});

test('createPlatformServiceController selects macos launchd agent adapter', async () => {
  const controller = createPlatformServiceController({ platform: 'darwin' });
  assert.equal(controller.id, 'macos-launchd-agent');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cli/service-controller.test.mjs`
Expected: FAIL because `service-controller.mjs` does not exist

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/lib/service-controller.mts
export function createPlatformServiceController({ platform = process.platform } = {}) {
  if (platform === 'linux') {
    return { id: 'linux-systemd-user' };
  }
  if (platform === 'darwin') {
    return { id: 'macos-launchd-agent' };
  }
  return { id: 'unsupported' };
}
```

Then expand the real implementation to expose:

- `install`
- `uninstall`
- `start`
- `stop`
- `restart`
- `status`

using:

- Linux:
  - `systemctl --user daemon-reload`
  - `systemctl --user enable <service>`
  - `systemctl --user start|stop|restart|is-active <service>`
- macOS:
  - `launchctl bootstrap gui/<uid> <plist>`
  - `launchctl bootout gui/<uid>/<label>`
  - `launchctl kickstart -k gui/<uid>/<label>`
  - `launchctl print gui/<uid>/<label>`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cli/service-controller.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/service-adapters packages/cli/src/lib/service-controller.mts tests/cli/service-controller.test.mjs
git commit -m "feat: add cli user service adapters"
```

### Task 4: Add Managed-Mode Auto-Proxy in Runtime Controller

**Files:**
- Modify: `packages/cli/src/lib/runtime-controller.mts`
- Test: `tests/cli/runtime-service-proxy.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtimeController from '../../packages/cli/src/lib/runtime-controller.mjs';

test('startRuntime proxies to service start when service is installed', async () => {
  const calls = [];
  const result = await runtimeController.startRuntime({
    __testOverrides: {
      isServiceInstalled: async () => true,
      startService: async () => {
        calls.push('service-start');
        return { status: 'running', managed: true };
      },
    },
  });

  assert.deepEqual(calls, ['service-start']);
  assert.equal(result.managed, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cli/runtime-service-proxy.test.mjs`
Expected: FAIL because current `startRuntime` still tries unmanaged startup

- [ ] **Step 3: Write minimal implementation**

```ts
// inside runtime-controller.mts
async function shouldUseManagedService(options) {
  return options.__testOverrides?.isServiceInstalled
    ? options.__testOverrides.isServiceInstalled()
    : false;
}

export async function startRuntime(input = {}) {
  const options = resolveOptions(input);
  if (await shouldUseManagedService(options)) {
    const startService = options.__testOverrides?.startService;
    return startService
      ? startService(options)
      : { status: 'running', managed: true };
  }

  // existing unmanaged path stays below
}
```

Then expand the same managed-mode gate for:

- `stopRuntime`
- `restartRuntime`
- `getStatus`
- `openRuntime`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cli/runtime-service-proxy.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/runtime-controller.mts tests/cli/runtime-service-proxy.test.mjs
git commit -m "feat: proxy managed runtime commands to native services"
```

### Task 5: Add `service` CLI Commands and Managed-Mode Errors

**Files:**
- Modify: `packages/cli/src/lib/cli.mts`
- Test: `tests/cli/service-cli.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI_BIN = path.resolve('.build/cli/bin/coder-studio.mjs');

async function runCli(args, { env = process.env, allowFailure = false } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-cli-run-'));
  const stdoutPath = path.join(tempRoot, 'stdout.log');
  const stderrPath = path.join(tempRoot, 'stderr.log');
  const stdoutHandle = await fs.open(stdoutPath, 'w');
  const stderrHandle = await fs.open(stderrPath, 'w');

  try {
    const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
      env,
      stdio: ['ignore', stdoutHandle.fd, stderrHandle.fd],
    });

    await stdoutHandle.close();
    await stderrHandle.close();

    const [stdout, stderr] = await Promise.all([
      fs.readFile(stdoutPath, 'utf8').catch(() => ''),
      fs.readFile(stderrPath, 'utf8').catch(() => ''),
    ]);

    if ((result.status ?? 0) !== 0) {
      const error = Object.assign(new Error(`cli exited with code ${result.status}`), {
        code: result.status ?? 1,
        stdout,
        stderr,
      });
      if (allowFailure) {
        return error;
      }
      throw error;
    }

    return { stdout, stderr };
  } finally {
    await stdoutHandle.close().catch(() => undefined);
    await stderrHandle.close().catch(() => undefined);
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

test('managed mode rejects foreground start', async () => {
  const result = await runCli(['start', '--foreground'], {
    env: { CODER_STUDIO_TEST_MANAGED_SERVICE: '1' },
    allowFailure: true,
  });

  assert.match(result.stderr, /service_managed_runtime_requires_service_stop_for_foreground_debug/);
});

test('service status command is recognized', async () => {
  const result = await runCli(['service', 'status', '--json']);
  assert.match(result.stdout, /"serviceState"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cli/service-cli.test.mjs`
Expected: FAIL because `service` subcommands and managed-mode validation do not exist

- [ ] **Step 3: Write minimal implementation**

```ts
// inside cli.mts command dispatch
if (command === 'service') {
  const subcommand = positionals[0] || 'help';
  // route to install/start/stop/restart/status/uninstall handlers
}

if (command === 'start' && flags.foreground && managedServiceInstalled) {
  throw new CliError(
    'service_managed_runtime_requires_service_stop_for_foreground_debug',
    { exitCode: EXIT_FAILURE }
  );
}

if (command === 'start' && (flags.host || Number.isFinite(flags.port)) && managedServiceInstalled) {
  throw new CliError(
    'service_managed_runtime_requires_config_update_instead_of_ephemeral_override',
    { exitCode: EXIT_FAILURE }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cli/service-cli.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/cli.mts tests/cli/service-cli.test.mjs
git commit -m "feat: add cli service commands"
```

### Task 6: End-to-End Service Installation and Status Verification

**Files:**
- Modify: `tests/smoke/cli-smoke.test.mjs`
- Test: `tests/smoke/cli-smoke.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('installed managed runtime routes lifecycle commands through service mode', async () => {
  const serviceStatus = await runCli(cliPath, ['service', 'status', '--json'], env);
  const parsed = JSON.parse(serviceStatus.stdout);
  assert.equal(typeof parsed.installed, 'boolean');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/smoke/cli-smoke.test.mjs`
Expected: FAIL because `service status` output is not implemented

- [ ] **Step 3: Write minimal implementation**

```js
// extend existing smoke flow
const install = await runCli(cliPath, ['service', 'install', '--json'], env);
assert.equal(JSON.parse(install.stdout).installed, true);

const start = await runCli(cliPath, ['start', '--json'], env);
assert.equal(JSON.parse(start.stdout).managed, true);

const status = await runCli(cliPath, ['status', '--json'], env);
assert.equal(JSON.parse(status.stdout).managed, true);
```

Add platform guards so the smoke only runs on supported managed-service platforms in phase 1.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/smoke/cli-smoke.test.mjs`
Expected: PASS on supported platforms, SKIP on unsupported ones

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/cli-smoke.test.mjs
git commit -m "test: cover managed cli service lifecycle"
```

### Task 7: Docs and Release Notes for Managed Runtime

**Files:**
- Modify: `packages/cli/README.md`
- Modify: `docs/deployment/`
- Test: `pnpm test:cli`

- [ ] **Step 1: Write the failing documentation check**

```bash
pnpm test:cli
```

Expected: Existing CLI tests pass, but docs still omit the new `service` command family and managed-mode behavior.

- [ ] **Step 2: Update docs with exact command surface**

```md
coder-studio service install
coder-studio service uninstall
coder-studio service start
coder-studio service stop
coder-studio service restart
coder-studio service status
```

Also document:

- managed-mode auto-proxy
- foreground-debug restriction
- config-change-before-restart rule

- [ ] **Step 3: Run CLI verification**

Run: `pnpm test:cli`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/cli/README.md docs/deployment
git commit -m "docs: add managed runtime service commands"
```
