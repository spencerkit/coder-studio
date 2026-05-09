import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HOST = "127.0.0.1";
async function reservePort(host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to reserve an ephemeral port for git auto-fetch e2e"));
        return;
      }

      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(port);
      });
    });
  });
}

const SERVER_PORT = await reservePort(HOST);
const WEB_PORT = await reservePort(HOST);
const BACKEND_HTTP_URL = `http://${HOST}:${SERVER_PORT}`;
const BASE_URL = `http://${HOST}:${WEB_PORT}`;
const REMOTE_BRANCH_NAME = "feature/auto-fetch-remote";
const REMOTE_BRANCH_REF = `origin/${REMOTE_BRANCH_NAME}`;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_ROOT = join(REPO_ROOT, "packages", "web");

let sandboxDir: string;
let dbPath: string;
let runtimeDir: string;
let workspacesRoot: string;
let contributorDir: string;
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

const runGit = (args: string[], cwd: string) => {
  const result = spawnSyncSafe("git", args, cwd);
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
};

const spawnSyncSafe = (command: string, args: string[], cwd: string) => {
  return spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Coder Studio E2E",
      GIT_AUTHOR_EMAIL: "e2e@coder-studio.test",
      GIT_COMMITTER_NAME: "Coder Studio E2E",
      GIT_COMMITTER_EMAIL: "e2e@coder-studio.test",
    },
    encoding: "utf8",
  });
};

const pushRemoteBranch = () => {
  if (!existsSync(join(contributorDir, ".git"))) {
    throw new Error(`Contributor repo missing at ${contributorDir}`);
  }

  writeFileSync(join(contributorDir, "feature.txt"), "feature\n");
  runGit(["checkout", "-b", REMOTE_BRANCH_NAME], contributorDir);
  runGit(["add", "."], contributorDir);
  runGit(["commit", "-m", "add remote branch"], contributorDir);
  runGit(["push", "-u", "origin", REMOTE_BRANCH_NAME], contributorDir);
};

test.describe("git auto-fetch acceptance", () => {
  test.beforeAll(async () => {
    sandboxDir = mkdtempSync(join(tmpdir(), "coder-studio-git-auto-fetch-e2e-"));
    dbPath = join(sandboxDir, "coder-studio.db");
    runtimeDir = join(sandboxDir, "runtime");
    workspacesRoot = join(sandboxDir, "workspaces");
    contributorDir = join(sandboxDir, "git-auto-fetch-contributor");

    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(workspacesRoot, { recursive: true });

    const seed = spawn(
      "pnpm",
      ["exec", "tsx", "e2e/fixtures/seed-git-auto-fetch-db.ts", dbPath, workspacesRoot],
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
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) =>
          setTimeout(() => {
            if (!child.killed) {
              child.kill("SIGKILL");
            }
            resolve(undefined);
          }, 5000)
        ),
      ]);
    };

    await kill(webProcess);
    await kill(backendProcess);
    rmSync(sandboxDir, { recursive: true, force: true });
  });

  test.use({
    baseURL: BASE_URL,
  });

  test("discovers a new remote branch via periodic auto-fetch and updates the manual fetch tooltip", async ({
    page,
  }) => {
    await page.goto("/workspace");
    await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });

    const branchButton = page
      .locator(".workspace-status-bar")
      .getByRole("button", { name: /^(Current Branch|当前分支): .+$/ });
    await expect(branchButton).toBeVisible({ timeout: 20000 });
    await expect(branchButton).toHaveAttribute("title", "main", { timeout: 20000 });

    await branchButton.click();
    await expect(page.locator(".branch-quick-pick-overlay")).toBeVisible();
    await expect(page.locator(".branch-quick-pick-name").filter({ hasText: /^main$/ })).toHaveCount(
      1,
      { timeout: 15000 }
    );
    await expect(
      page
        .locator(".branch-quick-pick-name")
        .filter({ hasText: new RegExp(`^${REMOTE_BRANCH_REF}$`) })
    ).toHaveCount(0);

    pushRemoteBranch();

    await expect(page.getByText(REMOTE_BRANCH_REF)).toBeVisible({ timeout: 15000 });

    await page.keyboard.press("Escape");
    await expect(page.locator(".branch-quick-pick-overlay")).toHaveCount(0);

    const fetchButton = page.locator(".git-status-bar").getByRole("button", {
      name: /^(Fetch|获取)$/,
    });
    await expect(fetchButton).toHaveAttribute("title", /^(Never fetched|尚未获取)$/);

    await fetchButton.click();

    await expect
      .poll(async () => await fetchButton.getAttribute("title"), {
        timeout: 15000,
      })
      .toMatch(/^(Last fetched |上次获取于 )/);
  });
});
