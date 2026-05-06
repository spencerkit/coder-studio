import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";

const HOME_DIR = process.env.HOME ?? "/root";
const TEMP_WORKSPACE_PARENT_DIR = join(HOME_DIR, "workspace");

function directoryRow(page: Page, name: string): Locator {
  return page
    .locator(".fp-dir")
    .filter({
      has: page.locator(".fp-dir-name").filter({ hasText: new RegExp(`^${escapeRegExp(name)}$`) }),
    })
    .first();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForWorkspaceEntry(page: Page): Promise<void> {
  await page.goto("/workspace");
  await waitForWorkspaceReady(page);
}

async function waitForWorkspaceReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const loading = document.querySelector(
        '.app-loading-shell, [data-testid="workspace-resolving-shell"]'
      );
      const welcome = document.querySelector(".welcome-btn");
      const workspace = document.querySelector(
        ".workspace-page, .agent-draft-launcher, .session-card.agent-pane, .bottom-terminal"
      );

      return !loading && Boolean(welcome || workspace);
    },
    { timeout: 20000 }
  );
}

function createTempWorkspaceDir(): string {
  mkdirSync(TEMP_WORKSPACE_PARENT_DIR, { recursive: true });
  return mkdtempSync(join(TEMP_WORKSPACE_PARENT_DIR, "coder-studio-terminal-reconnect-"));
}

function toWorkspaceSegments(workspacePath: string): string[] {
  const relativePath = workspacePath.startsWith(`${HOME_DIR}${sep}`)
    ? workspacePath.slice(HOME_DIR.length + 1)
    : workspacePath;

  return relativePath.split(sep).filter(Boolean);
}

async function openWorkspacePath(page: Page, workspacePath: string): Promise<void> {
  const segments = toWorkspaceSegments(workspacePath);
  await waitForWorkspaceEntry(page);

  const newWorkspaceButton = page.getByRole("button", { name: "New workspace" }).first();
  if (await newWorkspaceButton.isVisible().catch(() => false)) {
    await newWorkspaceButton.click();
  } else {
    await expect(page.getByRole("button", { name: "Open Workspace" })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Open Workspace" }).click();
  }

  await expect(page.locator(".launch-modal")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".fp-dir-list .fp-dir").first()).toBeVisible({ timeout: 10000 });

  for (const segment of segments.slice(0, -1)) {
    const row = directoryRow(page, segment);
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.dblclick();
    await expect(page.locator(".fp-dir-list .directory-loading")).toHaveCount(0);
  }

  const finalRow = directoryRow(page, segments.at(-1) ?? "");
  await expect(finalRow).toBeVisible({ timeout: 10000 });
  await finalRow.click();

  const startButton = page.getByRole("button", { name: "Start Workspace" });
  await expect(startButton).toBeEnabled({ timeout: 10000 });
  await startButton.click();

  await expect(page).toHaveURL(/\/workspace$/, { timeout: 15000 });
  await expect(
    page.locator(".agent-draft-launcher, .session-card.agent-pane, .bottom-terminal").first()
  ).toBeVisible({
    timeout: 15000,
  });
}

type RecordedCommand = {
  kind?: string;
  op?: string;
  args?: { terminalId?: string; lastSeq?: number };
};

const DISCONNECT_ON_SNAPSHOT_STORAGE_KEY = "e2e.disconnectOnTerminalSnapshot";

declare global {
  interface Window {
    __terminalReconnectMessages?: RecordedCommand[];
    __trackedWebSockets?: WebSocket[];
  }
}

async function waitForTrackedTerminalId(page: Page, startIndex: number): Promise<string> {
  await expect
    .poll(async () => {
      return await page.evaluate((commandIndex) => {
        const messages = window.__terminalReconnectMessages ?? [];
        const terminalCommand = messages.slice(commandIndex).find((message) => {
          if (message.kind !== "command") {
            return false;
          }

          return (
            (message.op === "terminal.snapshot" || message.op === "terminal.replay") &&
            typeof message.args?.terminalId === "string"
          );
        });

        return terminalCommand?.args?.terminalId ?? null;
      }, startIndex);
    })
    .not.toBeNull();

  return await page.evaluate((commandIndex) => {
    const messages = window.__terminalReconnectMessages ?? [];
    const terminalCommand = messages.slice(commandIndex).find((message) => {
      if (message.kind !== "command") {
        return false;
      }

      return (
        (message.op === "terminal.snapshot" || message.op === "terminal.replay") &&
        typeof message.args?.terminalId === "string"
      );
    });

    return terminalCommand?.args?.terminalId ?? null;
  }, startIndex);
}

test.describe("@phase1 terminal websocket reconnect", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((disconnectOnSnapshotStorageKey: string) => {
      window.localStorage.setItem("ui.locale", JSON.stringify("en"));

      const originalSend = WebSocket.prototype.send;
      const OriginalWebSocket = WebSocket;
      const messages: RecordedCommand[] = [];
      const sockets: WebSocket[] = [];
      const pendingDisconnectOnMessage = new WeakMap<WebSocket, boolean>();

      const TrackedWebSocket = new Proxy(OriginalWebSocket, {
        construct(target, args, newTarget) {
          const socket = Reflect.construct(target, args, newTarget) as WebSocket;
          sockets.push(socket);
          pendingDisconnectOnMessage.set(socket, false);
          socket.addEventListener("message", (event) => {
            if (!pendingDisconnectOnMessage.get(socket)) {
              return;
            }

            pendingDisconnectOnMessage.set(socket, false);
            window.localStorage.removeItem(disconnectOnSnapshotStorageKey);
            event.stopImmediatePropagation();

            try {
              socket.close();
            } catch {
              // Ignore test-only socket close failures.
            }
          });
          return socket;
        },
      });

      Object.defineProperty(window, "__terminalReconnectMessages", {
        configurable: true,
        value: messages,
      });
      Object.defineProperty(window, "__trackedWebSockets", {
        configurable: true,
        value: sockets,
      });

      window.WebSocket = TrackedWebSocket as typeof WebSocket;

      WebSocket.prototype.send = function patchedSend(
        data: string | ArrayBufferLike | Blob | ArrayBufferView
      ) {
        if (typeof data === "string") {
          try {
            const parsed = JSON.parse(data) as RecordedCommand;
            messages.push({
              kind: parsed.kind,
              op: parsed.op,
              args: parsed.args,
            });

            const disconnectConfig = window.localStorage.getItem(disconnectOnSnapshotStorageKey);
            if (
              disconnectConfig &&
              parsed.kind === "command" &&
              parsed.op === "terminal.snapshot" &&
              typeof parsed.args?.terminalId === "string"
            ) {
              const targetTerminalId = JSON.parse(disconnectConfig) as string;
              if (parsed.args.terminalId === targetTerminalId) {
                pendingDisconnectOnMessage.set(this as WebSocket, true);
              }
            }
          } catch {
            // Ignore non-JSON websocket frames.
          }
        }

        return originalSend.call(this, data);
      };
    }, DISCONNECT_ON_SNAPSHOT_STORAGE_KEY);
  });

  test("websocket reconnect requests replay before any snapshot fallback", async ({ page }) => {
    const workspaceDir = createTempWorkspaceDir();
    try {
      await openWorkspacePath(page, workspaceDir);

      const commandStartIndex = await page.evaluate(
        () => window.__terminalReconnectMessages?.length ?? 0
      );

      await page.getByRole("button", { name: "New Terminal" }).first().click();

      const terminalInput = page.locator(".bottom-terminal .xterm textarea").first();
      await expect(terminalInput).toBeVisible({ timeout: 10000 });

      const terminalId = await waitForTrackedTerminalId(page, commandStartIndex);

      expect(terminalId).toBeTruthy();

      await terminalInput.click();
      await page.keyboard.type(
        "printf 'RECONNECT_E2E_START\\n'; sleep 5; printf 'RECONNECT_E2E_DONE\\n'"
      );
      await page.keyboard.press("Enter");

      const terminalViewport = page.locator(".bottom-terminal .xterm-rows").first();
      await expect(terminalViewport).toContainText("RECONNECT_E2E_START", { timeout: 10000 });

      const reconnectProbeStart = await page.evaluate(
        () => window.__terminalReconnectMessages?.length ?? 0
      );

      await page.evaluate(() => {
        const socket = window.__trackedWebSockets?.at(-1);
        socket?.close();
      });

      await expect(terminalViewport).toContainText("RECONNECT_E2E_DONE", { timeout: 15000 });

      await expect
        .poll(
          async () =>
            await page.evaluate(
              ({ startIndex, trackedTerminalId }) => {
                const messages = window.__terminalReconnectMessages ?? [];
                return messages.slice(startIndex).filter((message) => {
                  return (
                    message.kind === "command" &&
                    message.args?.terminalId === trackedTerminalId &&
                    (message.op === "terminal.replay" || message.op === "terminal.snapshot")
                  );
                });
              },
              { startIndex: reconnectProbeStart, trackedTerminalId: terminalId }
            ),
          { timeout: 15000 }
        )
        .not.toEqual([]);

      const reconnectCommands = await page.evaluate(
        ({ startIndex, trackedTerminalId }) => {
          const messages = window.__terminalReconnectMessages ?? [];
          return messages.slice(startIndex).filter((message) => {
            return (
              message.kind === "command" &&
              message.args?.terminalId === trackedTerminalId &&
              (message.op === "terminal.replay" || message.op === "terminal.snapshot")
            );
          });
        },
        { startIndex: reconnectProbeStart, trackedTerminalId: terminalId }
      );

      const replayIndex = reconnectCommands.findIndex(
        (message) => message.op === "terminal.replay"
      );
      const snapshotIndex = reconnectCommands.findIndex(
        (message) => message.op === "terminal.snapshot"
      );
      const reconnectReplay = reconnectCommands[replayIndex];

      expect(reconnectReplay?.args?.lastSeq).toBeGreaterThan(0);
      expect(replayIndex).toBeGreaterThanOrEqual(0);
      expect(snapshotIndex === -1 || replayIndex < snapshotIndex).toBe(true);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  test("refresh retries initial hydration with snapshot again after websocket reconnect", async ({
    page,
  }) => {
    const workspaceDir = createTempWorkspaceDir();
    try {
      await openWorkspacePath(page, workspaceDir);

      const commandStartIndex = await page.evaluate(
        () => window.__terminalReconnectMessages?.length ?? 0
      );

      await page.getByRole("button", { name: "New Terminal" }).first().click();

      const terminalInput = page.locator(".bottom-terminal .xterm textarea").first();
      await expect(terminalInput).toBeVisible({ timeout: 10000 });

      const terminalId = await waitForTrackedTerminalId(page, commandStartIndex);
      expect(terminalId).toBeTruthy();

      await terminalInput.click();
      await page.keyboard.type("printf 'REFRESH_HYDRATE_SNAPSHOT_RETRY\\n'");
      await page.keyboard.press("Enter");

      const terminalViewport = page.locator(".bottom-terminal .xterm-rows").first();
      await expect(terminalViewport).toContainText("REFRESH_HYDRATE_SNAPSHOT_RETRY", {
        timeout: 10000,
      });

      await page.evaluate(
        ({ storageKey, trackedTerminalId }) => {
          window.localStorage.setItem(storageKey, JSON.stringify(trackedTerminalId));
        },
        { storageKey: DISCONNECT_ON_SNAPSHOT_STORAGE_KEY, trackedTerminalId: terminalId }
      );

      await page.reload();
      await waitForWorkspaceReady(page);

      await expect
        .poll(
          async () =>
            await page.evaluate((trackedTerminalId) => {
              const messages = window.__terminalReconnectMessages ?? [];
              return messages
                .filter((message) => {
                  return (
                    message.kind === "command" &&
                    message.args?.terminalId === trackedTerminalId &&
                    (message.op === "terminal.snapshot" || message.op === "terminal.replay")
                  );
                })
                .slice(0, 2)
                .map((message) => message.op ?? null);
            }, terminalId),
          { timeout: 15000 }
        )
        .toEqual(["terminal.snapshot", "terminal.snapshot"]);

      await expect(terminalViewport).toContainText("REFRESH_HYDRATE_SNAPSHOT_RETRY", {
        timeout: 20000,
      });
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
