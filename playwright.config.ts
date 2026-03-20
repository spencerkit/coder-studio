import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:5174'
  },
  webServer: {
    command: 'node scripts/test/start-dev-stack.mjs',
    port: 5174,
    reuseExistingServer: true,
    timeout: 120000
  }
});
