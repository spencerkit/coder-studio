import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareCliOutputDirs } from "./build-cli.js";
import { CLI_DIR, CORE_DIR, createCliBuildOptions, getProductionDeps } from "./shared/index.js";

describe("build-cli", () => {
  it("removes stale CLI dist files before recreating output directories", async () => {
    const cliDistDir = await mkdtemp(join(tmpdir(), "coder-studio-cli-dist-"));
    const cliEsmDir = join(cliDistDir, "esm");
    const cliWebDir = join(cliDistDir, "web");

    await mkdir(join(cliWebDir, "assets"), { recursive: true });
    await mkdir(cliEsmDir, { recursive: true });
    await writeFile(join(cliWebDir, "assets", "old-index.js"), "old");
    await writeFile(join(cliEsmDir, "old-index.mjs"), "old");

    await prepareCliOutputDirs({ cliDistDir, cliEsmDir, cliWebDir });

    await expect(readdir(cliEsmDir)).resolves.toEqual([]);
    await expect(readdir(cliWebDir)).resolves.toEqual([]);
  });

  it("does not recreate retired migration artifacts when preparing output directories", async () => {
    const cliDistDir = await mkdtemp(join(tmpdir(), "coder-studio-cli-dist-"));
    const cliEsmDir = join(cliDistDir, "esm");
    const cliWebDir = join(cliDistDir, "web");

    await mkdir(join(cliEsmDir, "migrations"), { recursive: true });
    await writeFile(join(cliEsmDir, "migrations", "001_init.sql"), "-- stale\n");

    await prepareCliOutputDirs({ cliDistDir, cliEsmDir, cliWebDir });

    await expect(readdir(cliEsmDir)).resolves.toEqual([]);
  });

  it("declares every bundled production dependency in the CLI package manifest", async () => {
    const pkg = JSON.parse(await readFile(join(CLI_DIR, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };

    const declaredDeps = new Set(Object.keys(pkg.dependencies ?? {}));
    const productionDeps = await getProductionDeps();

    expect(productionDeps.filter((dep) => !declaredDeps.has(dep))).toEqual([]);
  });

  it("maps core subpath exports to source files for the CLI bundle", async () => {
    const buildOptions = await createCliBuildOptions("esm");

    expect(buildOptions.alias).toMatchObject({
      "@coder-studio/core/runtime": resolve(CORE_DIR, "src/runtime.ts"),
      "@coder-studio/core/state-paths": resolve(CORE_DIR, "src/state-paths.ts"),
    });
  });
});
