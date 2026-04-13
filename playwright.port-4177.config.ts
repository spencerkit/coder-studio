import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4177'
  },
  webServer: {
    command: 'CODER_STUDIO_DEV_BACKEND_PORT=41036 CODER_STUDIO_DEV_FRONTEND_PORT=4177 node scripts/test/start-dev-stack.mjs',
    port: 4177,
    reuseExistingServer: false,
    timeout: 120000
  }
});
