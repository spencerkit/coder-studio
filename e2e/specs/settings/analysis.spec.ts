import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { translatePatternForE2E } from "../../fixtures/i18n";

const HOST = "127.0.0.1";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB_ROOT = join(REPO_ROOT, "packages", "web");
const SPEC_DIR = fileURLToPath(new URL(".", import.meta.url));

let sandboxDir: string;
let stateDir: string;
let runtimeDir: string;
let workspaceDir: string;
let backendHttpUrl = "";
let baseUrl = "";
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

async function reservePort(host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to reserve an ephemeral port for analysis acceptance"));
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

async function waitForHttp(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the server is reachable.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

test.describe("@phase2 settings analysis acceptance", () => {
  test.beforeAll(async () => {
    sandboxDir = mkdtempSync(join(tmpdir(), "coder-studio-analysis-settings-e2e-"));
    stateDir = join(sandboxDir, "state");
    runtimeDir = join(sandboxDir, "runtime");
    workspaceDir = join(sandboxDir, "workspace");

    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });

    const seed = spawnSync(
      "pnpm",
      ["exec", "tsx", "e2e/fixtures/seed-work-analysis-settings-db.ts", stateDir, workspaceDir],
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
      }
    );

    if (seed.status !== 0) {
      throw new Error(`Failed to seed work analysis settings state: ${seed.status ?? "unknown"}`);
    }

    const serverPort = await reservePort(HOST);
    const webPort = await reservePort(HOST);
    backendHttpUrl = `http://${HOST}:${serverPort}`;
    baseUrl = `http://${HOST}:${webPort}`;

    backendProcess = startProcess(
      "pnpm",
      ["exec", "tsx", "e2e/fixtures/start-analysis-server.ts"],
      {
        cwd: REPO_ROOT,
        env: {
          HOST,
          PORT: String(serverPort),
          STATE_DIR: stateDir,
          RUNTIME_DIR: runtimeDir,
          NO_AUTH: "true",
        },
      }
    );

    await waitForHttp(`${backendHttpUrl}/healthz`);

    webProcess = startProcess("pnpm", ["exec", "vite", "--host", HOST, "--port", String(webPort)], {
      cwd: WEB_ROOT,
      env: {
        NODE_ENV: "development",
        VITE_BACKEND_HTTP_URL: backendHttpUrl,
        VITE_BACKEND_WS_URL: `ws://${HOST}:${serverPort}/ws`,
      },
    });

    await waitForHttp(`${baseUrl}/`);
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

  test("P2S-09 more-features page routes to analytics and preserves discovered workspace paths", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}/workspace`);
    await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });

    await page.getByTestId("more-open").click();
    await expect(page).toHaveURL(/\/more\/settings\/general$/, { timeout: 20000 });
    await expect(page.getByTestId("more-features-page")).toBeVisible();

    await expect(
      page.getByRole("tab", { name: translatePatternForE2E("more.category.settings") })
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: translatePatternForE2E("more.category.analysis") })
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: translatePatternForE2E("more.category.about") })
    ).toBeVisible();

    await page.screenshot({
      path: join(SPEC_DIR, "../../test-results/more-features-root.png"),
      fullPage: true,
    });

    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.general") })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.providers") })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.appearance") })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.shortcuts.title") })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.analysis.title") })
    ).toHaveCount(0);

    await page.screenshot({
      path: join(SPEC_DIR, "../../test-results/more-features-settings.png"),
      fullPage: true,
    });

    await page.getByRole("tab", { name: translatePatternForE2E("more.category.analysis") }).click();

    await expect(page).toHaveURL(/\/more\/analysis\/analytics$/, { timeout: 20000 });
    await expect(
      page
        .getByTestId("work-analysis-root")
        .getByRole("heading", { name: translatePatternForE2E("settings.analysis.title") })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("monitoring.title") })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.diagnostics.title") })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: translatePatternForE2E("settings.general") })
    ).toHaveCount(0);
    await expect(page.getByTestId("work-analysis-data-source")).toContainText("Codex 4");

    await page.screenshot({
      path: join(SPEC_DIR, "../../test-results/settings-analysis-overview.png"),
      fullPage: true,
    });

    await expect(page.getByTestId("token-trend-chart")).toBeVisible();
    await expect(page.getByTestId("token-contribution-row")).toBeVisible();

    await page.getByRole("button", { name: /目录筛选/ }).click();
    await expect(page.getByRole("checkbox", { name: /workspace$/ })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /workspace-b$/ })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /workspace-c$/ })).toBeVisible();

    await page.screenshot({
      path: join(SPEC_DIR, "../../test-results/settings-analysis-compare.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "全部目录", exact: true }).click();
    await expect(
      page.getByTestId("work-analysis-root").getByRole("heading", { name: "工作分析" })
    ).toBeVisible();

    await page.screenshot({
      path: join(SPEC_DIR, "../../test-results/settings-analysis-yield.png"),
      fullPage: true,
    });
  });
});
