// @vitest-environment node
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build, type InlineConfig } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import viteConfig from "../../vite.config";

const uiPreviewBuildDir = join(process.cwd(), ".vite-ui-preview-build");

afterEach(() => {
  rmSync(uiPreviewBuildDir, { recursive: true, force: true });
});

describe("ui-preview build outputs", () => {
  it("does not emit ui-preview.html during the default app build", async () => {
    rmSync(uiPreviewBuildDir, { recursive: true, force: true });
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
        outDir: uiPreviewBuildDir,
      },
    });

    expect(() => readFileSync(join(uiPreviewBuildDir, "ui-preview.html"), "utf8")).toThrow();
  }, 120_000);

  it("emits ui-preview.html only from the dedicated ui-preview build", async () => {
    rmSync(uiPreviewBuildDir, { recursive: true, force: true });
    const resolvedConfig =
      typeof viteConfig === "function"
        ? ((await viteConfig({
            command: "build",
            mode: "ui-preview",
            isPreview: false,
          })) as InlineConfig)
        : viteConfig;

    await build({
      ...resolvedConfig,
      configFile: false,
      build: {
        ...resolvedConfig.build,
        outDir: uiPreviewBuildDir,
      },
    });

    expect(() => readFileSync(join(uiPreviewBuildDir, "ui-preview.html"), "utf8")).not.toThrow();
  }, 120_000);
});
