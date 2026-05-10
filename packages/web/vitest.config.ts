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
    env: {
      NODE_ENV: "test",
    },
    setupFiles: [path.resolve(__dirname, "./src/test-utils/setup.ts")],
  },
});
