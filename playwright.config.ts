import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:5174'
  },
  webServer: {
    command: 'pnpm dev',
    port: 5174,
    reuseExistingServer: true,
    timeout: 120000
  }
});
