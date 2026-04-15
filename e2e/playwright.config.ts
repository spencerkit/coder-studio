import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../docs/验收报告/phase-1/latest-playwright.json' }]],
  snapshotPathTemplate: '../docs/验收报告/phase-1/baseline-screenshots/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
