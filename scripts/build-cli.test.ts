import { mkdtemp, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareCliOutputDirs } from "./build-cli.js";

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
});
