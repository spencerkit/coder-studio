import { spawn } from "node:child_process";
import {
  deleteTerminalBrokerRuntime,
  getTerminalBrokerSocketPath,
  readTerminalBrokerRuntime,
  type TerminalBrokerRuntimeConfig,
} from "@coder-studio/core/runtime";
import { TerminalBrokerClient } from "@coder-studio/server";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureTerminalBroker(opts: {
  script: string;
  cwd: string;
  waitMs: number;
}): Promise<TerminalBrokerRuntimeConfig> {
  const existing = readTerminalBrokerRuntime();
  if (existing) {
    try {
      await new TerminalBrokerClient({ endpoint: existing.endpoint }).ping();
      return existing;
    } catch {
      deleteTerminalBrokerRuntime();
    }
  }

  const endpoint = getTerminalBrokerSocketPath();
  spawn(process.execPath, [opts.script], {
    cwd: opts.cwd,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CODER_STUDIO_TERMINAL_BROKER_ENDPOINT: endpoint,
    },
  }).unref();

  const deadline = Date.now() + opts.waitMs;
  while (Date.now() <= deadline) {
    const runtime = readTerminalBrokerRuntime();
    if (runtime) {
      try {
        await new TerminalBrokerClient({ endpoint: runtime.endpoint }).ping();
        return runtime;
      } catch {
        // Broker not ready yet.
      }
    }

    await sleep(50);
  }

  throw new Error(`Timed out waiting for terminal broker after ${opts.waitMs}ms`);
}
