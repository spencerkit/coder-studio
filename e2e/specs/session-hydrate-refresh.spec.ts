import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HOST = "127.0.0.1";
const SERVER_PORT = 43173;
const WEB_PORT = 53173;
const BACKEND_HTTP_URL = `http://${HOST}:${SERVER_PORT}`;
const BASE_URL = `http://${HOST}:${WEB_PORT}`;
const INTERRUPTED_SESSION_ID = "sess-hydrate-interrupted";
const UNAVAILABLE_SESSION_ID = "sess-hydrate-unavailable";
type TerminalTraceEntry = {
  terminalId?: string;
  event?: string;
};
let sandboxDir: string;
let workspaceDir: string;
let dbPath: string;
let runtimeDir: string;
let backendProcess: ChildProcess | undefined;
let webProcess: ChildProcess | undefined;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_ROOT = join(REPO_ROOT, "packages", "web");

function startProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  }
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});
  child.on("error", (error) => {
    throw error;
  });

  return child;
}

async function waitForHttp(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

test.describe("session hydrate refresh acceptance", () => {
  test.beforeAll(async () => {
    sandboxDir = mkdtempSync(join(tmpdir(), "coder-studio-hydrate-e2e-"));
    workspaceDir = join(sandboxDir, "workspace");
    dbPath = join(sandboxDir, "coder-studio.db");
    runtimeDir = join(sandboxDir, "runtime");

    mkdirSync(join(workspaceDir, ".git"), { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(workspaceDir, ".git", "HEAD"), "ref: refs/heads/main\n");

    const seed = spawn(
      "pnpm",
      ["exec", "tsx", "e2e/fixtures/seed-hydrate-refresh-db.ts", dbPath, workspaceDir],
      {
        cwd: REPO_ROOT,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    await new Promise<void>((resolve, reject) => {
      let stderr = "";
      seed.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      seed.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr || `seed exited with code ${code}`));
      });
      seed.on("error", reject);
    });

    backendProcess = startProcess("pnpm", ["exec", "tsx", "packages/server/src/server.ts"], {
      cwd: REPO_ROOT,
      env: {
        HOST,
        PORT: String(SERVER_PORT),
        DATA_DIR: dbPath,
        RUNTIME_DIR: runtimeDir,
        NO_AUTH: "true",
      },
    });

    await waitForHttp(`${BACKEND_HTTP_URL}/healthz`);

    webProcess = startProcess(
      "pnpm",
      ["exec", "vite", "--host", HOST, "--port", String(WEB_PORT)],
      {
        cwd: WEB_ROOT,
        env: {
          NODE_ENV: "development",
          VITE_BACKEND_HTTP_URL: BACKEND_HTTP_URL,
          VITE_BACKEND_WS_URL: `ws://${HOST}:${SERVER_PORT}/ws`,
        },
      }
    );

    await waitForHttp(`${BASE_URL}/`);
  });

  test.afterAll(async () => {
    const kill = async (child: ChildProcess | undefined) => {
      if (!child || child.killed) return;
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    };

    await kill(webProcess);
    await kill(backendProcess);
    rmSync(sandboxDir, { recursive: true, force: true });
  });

  test.use({
    baseURL: BASE_URL,
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    });
  });

  test("desktop restores server-backed pane layout after refresh without local pane storage", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator(".session-card.agent-pane")).toHaveCount(2, { timeout: 20000 });

    const interruptedCard = page.locator(
      `.session-card.agent-pane[data-session-id="${INTERRUPTED_SESSION_ID}"]`
    );
    const unavailableCard = page.locator(
      `.session-card.agent-pane[data-session-id="${UNAVAILABLE_SESSION_ID}"]`
    );

    await expect(interruptedCard).toBeVisible();
    await expect(unavailableCard).toBeVisible();
    await expect(interruptedCard.locator(".session-state-badge")).toHaveText("Interrupted");
    await expect(unavailableCard.locator(".session-title")).toHaveText("Unavailable");
    await expect(unavailableCard.locator(".session-state-badge")).toHaveText("Unavailable");
    await expect(interruptedCard.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(unavailableCard.getByRole("button", { name: "Start" })).toHaveCount(0);

    const interruptedTextarea = interruptedCard.locator(".xterm textarea");
    const unavailableTextarea = unavailableCard.locator(".xterm textarea");

    await expect(interruptedTextarea).toHaveAttribute("readonly", "");
    await expect(unavailableTextarea).toHaveAttribute("readonly", "");

    await page.reload();

    await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });
    await expect(interruptedCard).toBeVisible();
    await expect(unavailableCard).toBeVisible();
    await expect(interruptedCard.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(unavailableCard.getByRole("button", { name: "Start" })).toHaveCount(0);
    await expect(interruptedTextarea).toHaveAttribute("readonly", "");
    await expect(unavailableTextarea).toHaveAttribute("readonly", "");
  });

  test("desktop terminals refit once per terminal after rapid viewport resize", async ({
    page,
  }) => {
    const traces: TerminalTraceEntry[] = [];

    page.on("console", (message) => {
      if (message.type() !== "debug") {
        return;
      }

      void Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => undefined))).then(
        (args) => {
          if (args[0] !== "[terminal-trace]") {
            return;
          }

          const entry = args[1];
          if (entry && typeof entry === "object") {
            traces.push(entry as TerminalTraceEntry);
          }
        }
      );
    });

    await page.addInitScript(() => {
      window.localStorage.setItem("coderStudio.terminalTrace", "1");
    });

    await page.goto("/workspace");
    await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator(".session-card.agent-pane")).toHaveCount(2, { timeout: 20000 });

    await expect
      .poll(() => new Set(traces.map((entry) => entry.terminalId).filter(Boolean)).size)
      .toBe(2);

    await page.waitForTimeout(300);

    const terminalCount = new Set(traces.map((entry) => entry.terminalId).filter(Boolean)).size;
    const initialFitCount = traces.filter((entry) => entry.event === "fit").length;
    const initialObserverCount = traces.filter((entry) => entry.event === "resize-observer").length;

    await page.setViewportSize({ width: 1180, height: 800 });
    await page.setViewportSize({ width: 1020, height: 800 });

    await expect
      .poll(() => traces.filter((entry) => entry.event === "resize-observer").length)
      .toBeGreaterThan(initialObserverCount);

    await expect
      .poll(() => traces.filter((entry) => entry.event === "fit").length)
      .toBe(initialFitCount + terminalCount);

    await page.waitForTimeout(250);
    expect(traces.filter((entry) => entry.event === "fit")).toHaveLength(
      initialFitCount + terminalCount
    );
  });

  test("mobile restores the server-backed active session after refresh", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 430, height: 932 },
    });
    const page = await context.newPage();

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem("ui.locale", JSON.stringify("en"));
      });

      await page.goto("/workspace");
      await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, {
        timeout: 20000,
      });
      await expect(page.getByTestId("mobile-shell")).toBeVisible({ timeout: 20000 });

      const visibleCard = page.locator(".mobile-shell .session-card.agent-pane").first();
      await expect(visibleCard).toBeVisible();
      await expect(visibleCard).toHaveAttribute("data-session-id", UNAVAILABLE_SESSION_ID);
      await expect(visibleCard.locator(".session-title")).toHaveText("Unavailable");
      await expect(visibleCard.locator(".session-state-badge")).toHaveText("Unavailable");
      await expect(visibleCard.getByRole("button", { name: "Expand terminal keys" })).toHaveCount(
        0
      );

      await page.reload();

      await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, {
        timeout: 20000,
      });
      await expect(page.getByTestId("mobile-shell")).toBeVisible({ timeout: 20000 });
      await expect(visibleCard).toBeVisible();
      await expect(visibleCard).toHaveAttribute("data-session-id", UNAVAILABLE_SESSION_ID);
      await expect(visibleCard.getByRole("button", { name: "Expand terminal keys" })).toHaveCount(
        0
      );

      await page.getByRole("button", { name: "Open Agent sheet" }).click();
      const agentSheet = page.getByRole("dialog", { name: "Agent Sessions" });
      await expect(agentSheet).toBeVisible();
      await expect(
        agentSheet.getByRole("button", { name: "Switch to agent Resume me" })
      ).toBeVisible();
      await expect(
        agentSheet.getByRole("button", { name: "Switch to agent Unavailable" })
      ).toHaveClass(/mobile-inline-sheet__option--active/);
    } finally {
      await context.close();
    }
  });
});
