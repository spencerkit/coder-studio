import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_READY_PREFIX,
  DESKTOP_SHUTDOWN_MESSAGE,
  type DesktopReadyMessage,
} from "./protocol.js";

const children = new Set<ChildProcessWithoutNullStreams>();
const tempDirs = new Set<string>();
const WS_CLIENT_INSTANCE_ID = "desktop-sidecar-update-test";
const requireFromServer = createRequire(new URL("../../server/package.json", import.meta.url));
const WebSocket = requireFromServer("ws") as new (
  url: string,
  options: { headers: Record<string, string> }
) => {
  once(event: "open", listener: () => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  on(event: "message", listener: (data: unknown) => void): void;
  send(data: string): void;
  close(): void;
  terminate(): void;
};

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  children.clear();
  await Promise.all(
    [...tempDirs].map((path) => rm(path, { recursive: true, force: true }).catch(() => undefined))
  );
  tempDirs.clear();
});

async function waitForReady(child: ChildProcessWithoutNullStreams): Promise<DesktopReadyMessage> {
  const lines = createInterface({ input: child.stdout });
  return await new Promise((resolveReady, rejectReady) => {
    const stderr: string[] = [];
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    const timeout = setTimeout(() => rejectReady(new Error("Sidecar startup timed out")), 30_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectReady(new Error(`Sidecar exited with ${code}: ${stderr.join("")}`));
    });
    lines.on("line", (line) => {
      if (!line.startsWith(DESKTOP_READY_PREFIX)) return;
      clearTimeout(timeout);
      lines.close();
      resolveReady(JSON.parse(line.slice(DESKTOP_READY_PREFIX.length)) as DesktopReadyMessage);
    });
  });
}

async function callWs(
  baseUrl: string,
  cookie: string,
  op: string,
  args: Record<string, unknown> = {}
): Promise<{ ok: boolean; data?: unknown; error?: { code?: string } }> {
  const id = `${op}-${Date.now()}`;
  const activationId = `activation-${Date.now()}`;
  const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws`, {
    headers: { cookie },
  });
  return await new Promise((resolveResult, rejectResult) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      rejectResult(new Error(`Timed out waiting for ${op}`));
    }, 5_000);
    socket.once("open", () => {
      socket.send(
        JSON.stringify({
          kind: "command",
          id: activationId,
          op: "activation.claim",
          args: { clientInstanceId: WS_CLIENT_INSTANCE_ID },
        })
      );
    });
    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as {
        kind?: string;
        id?: string;
        ok: boolean;
        data?: unknown;
        error?: { code?: string };
      };
      if (message.kind === "result" && message.id === activationId) {
        if (!message.ok) {
          clearTimeout(timeout);
          socket.close();
          rejectResult(new Error(`Activation failed: ${message.error?.code ?? "unknown"}`));
          return;
        }
        socket.send(JSON.stringify({ kind: "command", id, op, args }));
        return;
      }
      if (message.kind !== "result" || message.id !== id) return;
      clearTimeout(timeout);
      socket.close();
      resolveResult(message);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      rejectResult(error);
    });
  });
}

describe("desktop sidecar", () => {
  it("starts on an OS-assigned loopback port, requires auth, and shuts down cleanly", async () => {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const stateRoot = await mkdtemp(join(tmpdir(), "coder-studio-desktop-sidecar-test-"));
    tempDirs.add(stateRoot);
    const secret = "desktop-test-secret";
    const child = spawn(
      process.execPath,
      [
        resolve(repoRoot, "node_modules/tsx/dist/cli.mjs"),
        resolve(repoRoot, "packages/desktop/src/sidecar.ts"),
      ],
      {
        cwd: repoRoot,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "production",
          CODER_STUDIO_RUNTIME_DIR: join(stateRoot, "runtime"),
          CODER_STUDIO_DESKTOP_SECRET: secret,
          CODER_STUDIO_DESKTOP_PORT: "0",
          CODER_STUDIO_DESKTOP_STATE_DIR: join(stateRoot, "state"),
          CODER_STUDIO_DESKTOP_UPLOADS_DIR: join(stateRoot, "uploads"),
          CODER_STUDIO_DESKTOP_APP_VERSION: "0.1.0-test",
        },
      }
    );
    children.add(child);

    const ready = await waitForReady(child);
    expect(ready.host).toBe("127.0.0.1");
    expect(ready.port).toBeGreaterThan(0);
    const url = `http://${ready.host}:${ready.port}`;

    expect((await fetch(`${url}/healthz`)).ok).toBe(true);
    const beforeLogin = await fetch(`${url}/auth/status`).then((response) => response.json());
    expect(beforeLogin).toMatchObject({ authEnabled: true, authenticated: false });

    const loginResponse = await fetch(`${url}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: secret }),
    });
    expect(loginResponse.ok).toBe(true);
    const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toContain("coder_studio_auth=");
    const afterLogin = await fetch(`${url}/auth/status`, {
      headers: { cookie: cookie as string },
    }).then((response) => response.json());
    expect(afterLogin).toMatchObject({ authEnabled: true, authenticated: true });

    const updateState = await callWs(url, cookie as string, "updates.getState");
    expect(updateState).toMatchObject({
      ok: true,
      data: {
        supported: false,
        runtimeContext: {
          environment: "desktop-managed",
          authority: "desktop",
          supported: true,
          unsupportedReason: null,
        },
      },
    });
    await expect(callWs(url, cookie as string, "updates.check")).resolves.toMatchObject({
      ok: false,
      error: { code: "update_unsupported" },
    });
    await expect(
      callWs(url, cookie as string, "updates.startInstall", {
        targetVersion: "9.9.9",
        force: true,
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "update_unsupported" },
    });

    const exited = new Promise<number | null>((resolveExit) =>
      child.once("exit", (code) => resolveExit(code))
    );
    child.stdin.write(`${DESKTOP_SHUTDOWN_MESSAGE}\n`);
    await expect(exited).resolves.toBe(0);
    children.delete(child);
  }, 45_000);
});
