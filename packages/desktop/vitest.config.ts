import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@coder-studio/desktop",
    globals: true,
    environment: "node",
  },
});
