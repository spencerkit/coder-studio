import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4176'
  },
  webServer: {
    command: 'CODER_STUDIO_DEV_BACKEND_PORT=41035 CODER_STUDIO_DEV_FRONTEND_PORT=4176 node scripts/test/start-dev-stack.mjs',
    port: 4176,
    reuseExistingServer: false,
    timeout: 120000
  }
});
