import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const HOST = '127.0.0.1';
const SERVER_PORT = 43175;
const WEB_PORT = 53175;
const BACKEND_HTTP_URL = `http://${HOST}:${SERVER_PORT}`;
const BASE_URL = `http://${HOST}:${WEB_PORT}`;
const NEW_BRANCH_NAME = 'feature/e2e-create-branch';

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
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  child.on('error', (error) => {
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

test.describe('git branch switching acceptance', () => {
  test.beforeAll(async () => {
    sandboxDir = mkdtempSync(join(tmpdir(), 'coder-studio-branch-switcher-e2e-'));
    dbPath = join(sandboxDir, 'coder-studio.db');
    runtimeDir = join(sandboxDir, 'runtime');
    workspacesRoot = join(sandboxDir, 'workspaces');

    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(workspacesRoot, { recursive: true });

    const seed = spawn('pnpm', [
      'exec',
      'tsx',
      'e2e/fixtures/seed-git-branch-switching-db.ts',
      dbPath,
      workspacesRoot,
    ], {
      cwd: '/home/spencer/workspace/coder-studio',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      let stderr = '';
      seed.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      seed.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr || `seed exited with code ${code}`));
      });
      seed.on('error', reject);
    });

    backendProcess = startProcess('pnpm', ['exec', 'tsx', 'packages/server/src/server.ts'], {
      cwd: '/home/spencer/workspace/coder-studio',
      env: {
        HOST,
        PORT: String(SERVER_PORT),
        DATA_DIR: dbPath,
        RUNTIME_DIR: runtimeDir,
        NO_AUTH: 'true',
      },
    });

    await waitForHttp(`${BACKEND_HTTP_URL}/healthz`);

    webProcess = startProcess('pnpm', ['exec', 'vite', '--host', HOST, '--port', String(WEB_PORT)], {
      cwd: '/home/spencer/workspace/coder-studio/packages/web',
      env: {
        VITE_BACKEND_HTTP_URL: BACKEND_HTTP_URL,
        VITE_BACKEND_WS_URL: `ws://${HOST}:${SERVER_PORT}/ws`,
      },
    });

    await waitForHttp(`${BASE_URL}/`);
  });

  test.afterAll(async () => {
    const kill = async (child: ChildProcess | undefined) => {
      if (!child || child.killed) {
        return;
      }

      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    };

    await kill(webProcess);
    await kill(backendProcess);
    rmSync(sandboxDir, { recursive: true, force: true });
  });

  test.use({
    baseURL: BASE_URL,
  });

  test('creates a new branch only after explicit confirmation from the branch quick pick', async ({ page }) => {
    await page.goto('/workspace');
    await expect(page.getByTestId('workspace-resolving-shell')).toHaveCount(0, { timeout: 20000 });

    const branchButton = page.getByRole('button', {
      name: 'Open branch switcher for main',
    });
    await expect(branchButton).toBeVisible({ timeout: 20000 });

    await branchButton.click();

    await expect(page.getByRole('button', { name: 'Git Diff' })).toHaveClass(/active/);
    await expect(page.locator('.branch-quick-pick-overlay')).toBeVisible();
    await expect(
      page.locator('.branch-quick-pick-item').filter({ hasText: 'main' })
    ).toBeVisible();

    const input = page.getByPlaceholder('Search branches or create new branch...');
    await input.fill(NEW_BRANCH_NAME);

    await expect(page.getByText(`Create branch: ${NEW_BRANCH_NAME}`)).toBeVisible();
    await input.press('Enter');

    await expect(page.getByText(`Confirm create branch: ${NEW_BRANCH_NAME}`)).toBeVisible();
    await expect(branchButton).toBeVisible();

    await input.press('Enter');

    await expect(page.locator('.branch-quick-pick-overlay')).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: `Open branch switcher for ${NEW_BRANCH_NAME}`,
      })
    ).toBeVisible({ timeout: 20000 });
  });
});
