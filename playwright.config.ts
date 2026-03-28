import { defineConfig } from '@playwright/test';

const readPort = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const frontendPort = readPort(process.env.CODER_STUDIO_DEV_FRONTEND_PORT, 5174);

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: `http://localhost:${frontendPort}`
  },
  webServer: {
    command: 'node scripts/test/start-dev-stack.mjs',
    port: frontendPort,
    reuseExistingServer: false,
    timeout: 120000
  }
});
