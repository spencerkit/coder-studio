import react from "@vitejs/plugin-react";
import path from "path";
import { defineProject } from "vitest/config";

export default defineProject({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Avoid worker starvation when the Vite build test runs alongside large jsdom suites.
    maxWorkers: 4,
    env: {
      NODE_ENV: "test",
    },
    setupFiles: [path.resolve(__dirname, "./src/test-utils/setup.ts")],
  },
});
