import { defineConfig, devices } from "@playwright/test";

const HOST = "127.0.0.1";
const PORT = 4174;
const BASE_URL = `http://${HOST}:${PORT}`;
const iPhone14 = devices["iPhone 14"];

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "desktop",
      use: {
        viewport: { width: 1440, height: 960 },
      },
    },
    {
      name: "mobile",
      use: {
        ...iPhone14,
        browserName: "chromium",
      },
    },
  ],
  webServer: {
    command: `pnpm --dir ../packages/web exec vite --host ${HOST} --port ${PORT}`,
    cwd: ".",
    url: `${BASE_URL}/ui-preview.html`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      ...process.env,
      NODE_ENV: "development",
    },
  },
});
