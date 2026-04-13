import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4179'
  },
  webServer: {
    command: 'CODER_STUDIO_DEV_BACKEND_PORT=41038 CODER_STUDIO_DEV_FRONTEND_PORT=4179 node scripts/test/start-dev-stack.mjs',
    port: 4179,
    reuseExistingServer: false,
    timeout: 120000
  }
});
