import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HOST = "127.0.0.1";
const SERVER_PORT = 43175;
const WEB_PORT = 53175;
const BACKEND_HTTP_URL = `http://${HOST}:${SERVER_PORT}`;
const BASE_URL = `http://${HOST}:${WEB_PORT}`;
const NEW_BRANCH_NAME = "feature/e2e-create-branch";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_ROOT = join(REPO_ROOT, "packages", "web");

let sandboxDir: string;
let dbPath: string;
let runtimeDir: string;
let workspacesRoot: string;
let backendProcess: ChildProcess | undefined;
let webProcess: ChildProcess | undefined;

const startProcess = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  }
): ChildProcess => {
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
};

const waitForHttp = async (url: string, timeoutMs = 30000): Promise<void> => {
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
};

test.describe("git branch switching acceptance", () => {
  test.beforeAll(async () => {
    sandboxDir = mkdtempSync(join(tmpdir(), "coder-studio-branch-switcher-e2e-"));
    dbPath = join(sandboxDir, "coder-studio.db");
    runtimeDir = join(sandboxDir, "runtime");
    workspacesRoot = join(sandboxDir, "workspaces");

    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(workspacesRoot, { recursive: true });

    const seed = spawn(
      "pnpm",
      ["exec", "tsx", "e2e/fixtures/seed-git-branch-switching-db.ts", dbPath, workspacesRoot],
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
      if (!child || child.killed) {
        return;
      }

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

  test("creates a new branch only after explicit confirmation from the branch quick pick", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });

    const branchButton = page.locator(".workspace-status-bar .git-panel-status-strip__branch");
    await expect(branchButton).toBeVisible({ timeout: 20000 });
    await expect(branchButton.locator(".git-panel-status-strip__branch-text")).toHaveText("main");

    await branchButton.click();

    await expect(page.locator(".branch-quick-pick")).toBeVisible();
    await expect(page.locator(".branch-quick-pick-item").filter({ hasText: "main" })).toBeVisible();

    const input = page.getByPlaceholder("Search branches or create new branch...");
    await input.fill(NEW_BRANCH_NAME);

    await expect(page.getByText(`Create branch: ${NEW_BRANCH_NAME}`)).toBeVisible();
    await input.press("Enter");

    await expect(page.getByText(`Confirm create branch: ${NEW_BRANCH_NAME}`)).toBeVisible();
    await expect(branchButton).toBeVisible();

    await input.press("Enter");

    await expect(page.locator(".branch-quick-pick")).toHaveCount(0);
    await expect(branchButton.locator(".git-panel-status-strip__branch-text")).toHaveText(
      NEW_BRANCH_NAME,
      {
        timeout: 20000,
      }
    );
  });
});
