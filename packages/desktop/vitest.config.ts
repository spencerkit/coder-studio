import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      "@coder-studio/core/runtime": resolve(__dirname, "../core/src/runtime.ts"),
      "@coder-studio/core/state-paths": resolve(__dirname, "../core/src/state-paths.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});
