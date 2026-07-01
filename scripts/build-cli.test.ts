import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareCliOutputDirs } from "./build-cli.js";
import {
  CLI_DIR,
  CORE_DIR,
  createCliBuildOptions,
  createWslRuntimeEntryBuildOptions,
  getProductionDeps,
  RUNTIME_DIR,
} from "./shared/index.js";

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

  it("emits the automation entry as an ESM build output", async () => {
    const buildOptions = await createCliBuildOptions("esm");

    expect(buildOptions.entryPoints).toContain(resolve(CLI_DIR, "src/automation-entry.ts"));
  });

  it("does not emit retired desktop or legacy command entries in the npm CLI bundle", async () => {
    const buildOptions = await createCliBuildOptions("esm");

    expect(buildOptions.entryPoints).not.toContain(resolve(CLI_DIR, "src/desktop-server.ts"));
    expect(buildOptions.entryPoints).not.toContain(resolve(CLI_DIR, "src/bin-legacy.ts"));
  });

  it("builds the WSL runtime entry from the runtime package", async () => {
    const buildOptions = await createWslRuntimeEntryBuildOptions();

    expect(buildOptions.entryPoints).toEqual([resolve(RUNTIME_DIR, "src/wsl-runtime-entry.ts")]);
    expect(buildOptions.format).toBe("esm");
    expect(buildOptions.packages).toBe("external");
    expect(buildOptions.define).toEqual({
      "process.env.CODER_STUDIO_WSL_RUNTIME_ENTRY": '"1"',
    });
  });
});
