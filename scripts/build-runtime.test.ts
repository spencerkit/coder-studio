import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_DIR } from "./shared/index.js";

describe("build-runtime plumbing", () => {
  it("includes packages/runtime in the pnpm workspace", async () => {
    const workspace = await readFile(join(ROOT_DIR, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).toContain("packages/runtime");
  });

  it("exposes a runtime build script at the repo root", async () => {
    const pkg = JSON.parse(await readFile(join(ROOT_DIR, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.["build:runtime"]).toBe("tsx scripts/build-runtime.ts");
  });

  it("adds the runtime package manifest to the workspace", async () => {
    const pkg = JSON.parse(
      await readFile(join(ROOT_DIR, "packages/runtime/package.json"), "utf8")
    ) as {
      name?: string;
      scripts?: Record<string, string>;
    };

    expect(pkg.name).toBe("@coder-studio/runtime");
    expect(pkg.scripts?.build).toBe("tsc -p tsconfig.json");
  });
});
