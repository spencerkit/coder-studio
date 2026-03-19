import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173'
  },
  webServer: {
    command: 'node scripts/test/start-release-server.mjs',
    port: 4173,
    reuseExistingServer: false,
    timeout: 120000
  }
});
