import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerRegistry } from "@coder-studio/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { createServer, type Server } from "../server.js";
import { startTerminalBrokerServer } from "../terminal/broker-server.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";

type SessionManagerWithCleanup = {
  cleanupDetector: (sessionId: string) => void;
};

async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Condition not met within ${timeoutMs}ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("managed restart session preservation", () => {
  let tempDir: string;
  let workspaceDir: string;
  let binDir: string;
  let dataDir: string;
  let dbPath: string;
  let socketPath: string;
  let broker: Awaited<ReturnType<typeof startTerminalBrokerServer>> | undefined;
  let first: Server | undefined;
  let second: Server | undefined;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "coder-studio-managed-session-"));
    workspaceDir = join(tempDir, "workspace");
    binDir = join(tempDir, "bin");
    dataDir = join(tempDir, "data");
    dbPath = join(dataDir, "coder-studio.db");
    socketPath = join(tempDir, "terminal-broker.sock");

    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(join(workspaceDir, ".git"), { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(workspaceDir, ".git", "HEAD"), "ref: refs/heads/main\n");

    const codexPath = join(binDir, "codex");
    writeFileSync(
      codexPath,
      `#!/usr/bin/env bash
set -euo pipefail
trap 'exit 0' TERM INT
printf 'Session ID: abcdef-123456\\n> '
if IFS= read -r _line; then
  sleep 0.2
  printf 'working...\\n'
fi
while true; do
  sleep 1
done
`,
      "utf8"
    );
    chmodSync(codexPath, 0o755);

    vi.stubEnv("PATH", `${binDir}:${process.env.PATH ?? ""}`);

    broker = await startTerminalBrokerServer({
      endpoint: socketPath,
      eventBus: new EventBus(),
    });
  });

  afterEach(async () => {
    await first?.stop();
    await second?.stop();
    await broker?.close();
    vi.unstubAllEnvs();
    rmSync(tempDir, { recursive: true, force: true });
    first = undefined;
    second = undefined;
    broker = undefined;
  });

  it("moves a preserved running session back to idle after the debounce elapses", async () => {
    const codexProvider = providerRegistry.find((provider) => provider.id === "codex");
    expect(codexProvider).toBeDefined();

    first = await createServer({
      dataDir: dbPath,
      host: "127.0.0.1",
      port: 0,
      writeRuntimeConfig: false,
      serverInstanceId: "server-a",
      terminalBrokerEndpoint: socketPath,
    });

    const firstCtx = first.__test__!.commandContext;
    const open = await dispatch(
      {
        kind: "command",
        id: "workspace-open",
        op: "workspace.open",
        args: { path: workspaceDir },
      },
      firstCtx
    );
    expect(open.ok).toBe(true);
    const workspaceId = open.data!.id;

    const session = await first.__test__!.sessionMgr.create({
      workspaceId,
      workspacePath: workspaceDir,
      providerId: "codex",
      provider: codexProvider!,
    });

    await waitFor(() => first?.__test__!.sessionMgr.get(session.id)?.state === "idle");

    first.__test__!.sessionMgr.sendInput(session.id, Buffer.from("\r"), "submit", "check status");
    expect(first.__test__!.sessionMgr.get(session.id)?.state).toBe("running");

    await first.stop({
      mode: "restart-preserve",
      requestId: "restart-1",
      ttlMs: 5_000,
    });

    (first.__test__!.sessionMgr as unknown as SessionManagerWithCleanup).cleanupDetector(
      session.id
    );
    first = undefined;

    await new Promise((resolve) => setTimeout(resolve, 3_500));

    second = await createServer({
      dataDir: dbPath,
      host: "127.0.0.1",
      port: 0,
      writeRuntimeConfig: false,
      serverInstanceId: "server-b",
      terminalBrokerEndpoint: socketPath,
      restartClaimRequestId: "restart-1",
    });

    expect(second.__test__!.sessionMgr.get(session.id)?.state).toBe("idle");
  });
});
