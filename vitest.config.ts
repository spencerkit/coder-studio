import { defineConfig } from "vitest/config";

export default defineConfig({
  root: __dirname,
  test: {
    projects: [
      "scripts/vitest.config.ts",
      "packages/cli/vitest.config.ts",
      "packages/core/vitest.config.ts",
      "packages/desktop/vitest.config.ts",
      "packages/providers/vitest.config.ts",
      "packages/server/vitest.config.ts",
      "packages/skill-manager/vitest.config.ts",
      "packages/utils/vitest.config.ts",
      "packages/web/vitest.config.ts",
    ],
  },
});
