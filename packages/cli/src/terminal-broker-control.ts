import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  deleteTerminalBrokerRuntime,
  getTerminalBrokerSocketPath,
  readTerminalBrokerRuntime,
  type TerminalBrokerRuntimeConfig,
  writeTerminalBrokerRuntime,
} from "@coder-studio/core/runtime";
import { TerminalBrokerClient } from "@coder-studio/server";
import { debugRestartTrace, warnRestartTrace } from "./restart-trace.js";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnDetachedTerminalBroker(script: string, cwd: string, endpoint: string): void {
  const bootstrapCode = `
    import { spawn } from "node:child_process";

    const child = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(script)}], {
      cwd: ${JSON.stringify(cwd)},
      detached: true,
      stdio: "ignore",
      env: process.env,
    });

    child.unref();
  `;

  spawn(process.execPath, ["--input-type=module", "-e", bootstrapCode], {
    cwd,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CODER_STUDIO_TERMINAL_BROKER_ENDPOINT: endpoint,
    },
  }).unref();
}

function canProbeSocket(endpoint: string): boolean {
  return process.platform === "win32" || existsSync(endpoint);
}

async function recoverLiveBrokerRuntime(
  endpoint: string
): Promise<TerminalBrokerRuntimeConfig | null> {
  if (!canProbeSocket(endpoint)) {
    return null;
  }

  const status = await new TerminalBrokerClient({ endpoint }).status();
  const runtime = {
    endpoint,
    pid: status.pid,
    startedAt: status.startedAt,
  } satisfies TerminalBrokerRuntimeConfig;
  writeTerminalBrokerRuntime(runtime);
  debugRestartTrace("terminal_broker.runtime_recovered", runtime);
  return runtime;
}

export async function ensureTerminalBroker(opts: {
  script: string;
  cwd: string;
  waitMs: number;
}): Promise<TerminalBrokerRuntimeConfig> {
  const endpoint = getTerminalBrokerSocketPath();
  const existing = readTerminalBrokerRuntime();
  if (existing) {
    debugRestartTrace("terminal_broker.runtime_found", {
      endpoint: existing.endpoint,
      pid: existing.pid,
      startedAt: existing.startedAt,
      socketExists: existsSync(existing.endpoint),
    });
    try {
      await new TerminalBrokerClient({ endpoint: existing.endpoint }).ping();
      debugRestartTrace("terminal_broker.runtime_alive", {
        endpoint: existing.endpoint,
        pid: existing.pid,
      });
      return existing;
    } catch (error) {
      warnRestartTrace("terminal_broker.runtime_stale", {
        endpoint: existing.endpoint,
        pid: existing.pid,
        startedAt: existing.startedAt,
        socketExists: existsSync(existing.endpoint),
        processAlive: isProcessAlive(existing.pid),
        message: error instanceof Error ? error.message : String(error),
      });
      deleteTerminalBrokerRuntime();
      try {
        const recovered = await recoverLiveBrokerRuntime(existing.endpoint);
        if (recovered) {
          return recovered;
        }
      } catch {
        // Fall through to spawning a replacement broker.
      }
    }
  } else {
    try {
      const recovered = await recoverLiveBrokerRuntime(endpoint);
      if (recovered) {
        return recovered;
      }
    } catch {
      // No broker was reachable on the default endpoint.
    }
  }

  debugRestartTrace("terminal_broker.spawn", {
    endpoint,
    script: opts.script,
    cwd: opts.cwd,
    waitMs: opts.waitMs,
  });
  spawnDetachedTerminalBroker(opts.script, opts.cwd, endpoint);

  const deadline = Date.now() + opts.waitMs;
  while (Date.now() <= deadline) {
    const runtime = readTerminalBrokerRuntime();
    if (runtime) {
      try {
        await new TerminalBrokerClient({ endpoint: runtime.endpoint }).ping();
        debugRestartTrace("terminal_broker.runtime_ready", {
          endpoint: runtime.endpoint,
          pid: runtime.pid,
          startedAt: runtime.startedAt,
        });
        return runtime;
      } catch {
        // Broker not ready yet.
      }
    }

    await sleep(50);
  }

  warnRestartTrace("terminal_broker.runtime_wait_timeout", {
    endpoint,
    script: opts.script,
    cwd: opts.cwd,
    waitMs: opts.waitMs,
  });
  throw new Error(`Timed out waiting for terminal broker after ${opts.waitMs}ms`);
}
