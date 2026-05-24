// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build, type InlineConfig } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ui-preview build outputs", () => {
  it("emits ui-preview.html as a production entry", async () => {
    const outDir = mkdtempSync(join(process.cwd(), ".vite-ui-preview-build-"));
    tempDirs.push(outDir);
    const resolvedConfig =
      typeof viteConfig === "function"
        ? ((await viteConfig({
            command: "build",
            mode: "production",
            isPreview: false,
          })) as InlineConfig)
        : viteConfig;

    await build({
      ...resolvedConfig,
      configFile: false,
      build: {
        ...resolvedConfig.build,
        outDir,
      },
    });

    expect(() => readFileSync(join(outDir, "ui-preview.html"), "utf8")).not.toThrow();
  }, 30_000);
});
