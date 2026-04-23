import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: process.env.PLAYWRIGHT_WORKERS ? Number(process.env.PLAYWRIGHT_WORKERS) : 1,
  retries: 0,
  timeout: 60000,
  reporter: [['list']],
  webServer: {
    command: 'cd ../packages/web && pnpm vite --port 5173 --host 127.0.0.1',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: true,
    timeout: 30000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
    screenshot: 'on',
    video: 'off',
    viewport: { width: 1280, height: 800 },
  },
  outputDir: './test-results',
});
