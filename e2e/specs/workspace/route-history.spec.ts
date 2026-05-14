import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HOST = "127.0.0.1";
const SERVER_PORT = 43174;
const WEB_PORT = 53174;
const BACKEND_HTTP_URL = `http://${HOST}:${SERVER_PORT}`;
const BASE_URL = `http://${HOST}:${WEB_PORT}`;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_ROOT = join(REPO_ROOT, "packages", "web");

let sandboxDir: string;
let dbPath: string;
let runtimeDir: string;
let workspacesRoot: string;
let backendProcess: ChildProcess | undefined;
let webProcess: ChildProcess | undefined;

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

test.describe("workspace route history acceptance", () => {
  test.beforeAll(async () => {
    sandboxDir = mkdtempSync(join(tmpdir(), "coder-studio-workspace-history-e2e-"));
    dbPath = join(sandboxDir, "coder-studio.db");
    runtimeDir = join(sandboxDir, "runtime");
    workspacesRoot = join(sandboxDir, "workspaces");

    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(workspacesRoot, { recursive: true });

    const seed = spawn(
      "pnpm",
      ["exec", "tsx", "e2e/fixtures/seed-workspace-route-history-db.ts", dbPath, workspacesRoot],
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

  test("switching workspaces keeps the URL stable and restores across refresh and a new browser context", async ({
    page,
    browser,
  }) => {
    await page.goto("/");
    await expect(page.locator(".topbar-tab")).toHaveCount(2, { timeout: 20000 });

    await page.goto("/workspace");
    await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator(".topbar-tab")).toHaveCount(2, { timeout: 20000 });
    await expect(page.locator(".topbar-tab.active")).toContainText("recent-workspace");
    await expect(page).toHaveURL(`${BASE_URL}/workspace`);

    const historyLengthBeforeSwitch = await page.evaluate(() => window.history.length);

    await page.locator(".topbar-tab").nth(1).click();

    await expect(page.locator(".topbar-tab.active")).toContainText("older-workspace");
    await expect(page).toHaveURL(`${BASE_URL}/workspace`);
    await page.waitForTimeout(300);

    const historyLengthAfterSwitch = await page.evaluate(() => window.history.length);
    expect(historyLengthAfterSwitch).toBe(historyLengthBeforeSwitch);

    await page.reload();

    await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator(".topbar-tab")).toHaveCount(2, { timeout: 20000 });
    await expect(page.locator(".topbar-tab.active")).toContainText("older-workspace");
    await expect(page).toHaveURL(`${BASE_URL}/workspace`);

    const secondContext = await browser.newContext();
    try {
      const secondPage = await secondContext.newPage();
      await secondPage.goto(`${BASE_URL}/workspace`);
      await expect(secondPage.getByTestId("workspace-resolving-shell")).toHaveCount(0, {
        timeout: 20000,
      });
      await expect(secondPage.locator(".topbar-tab")).toHaveCount(2, { timeout: 20000 });
      await expect(secondPage.locator(".topbar-tab.active")).toContainText("older-workspace");
      await expect(secondPage).toHaveURL(`${BASE_URL}/workspace`);
    } finally {
      await secondContext.close();
    }

    await page.goBack();

    await expect(page).toHaveURL("about:blank");
  });
});
