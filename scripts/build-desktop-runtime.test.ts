import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDesktopRuntimeBuildOptions,
  DESKTOP_FACTORY_RUNTIME_DIR,
} from "./build-desktop-runtime.js";
import { CLI_DIR, DESKTOP_DIR } from "./shared/paths.js";

describe("build-desktop-runtime", () => {
  it("emits the Server and Agent automation entry as production ESM bundles", () => {
    const options = createDesktopRuntimeBuildOptions();

    expect(options.entryPoints).toEqual({
      server: resolve(DESKTOP_DIR, "src/sidecar.ts"),
      "automation-entry": resolve(CLI_DIR, "src/automation-entry.ts"),
    });
    expect(options.outdir).toBe(DESKTOP_FACTORY_RUNTIME_DIR);
    expect(options.outExtension).toEqual({ ".js": ".mjs" });
    expect(options.sourcemap).toBe(false);
  });
});
