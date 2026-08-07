import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopPackageArgs, readDesktopReleaseVersion } from "./package-desktop.js";
import { DESKTOP_DIR, ROOT_DIR } from "./shared/index.js";

async function readVersion(packagePath: string): Promise<string> {
  const manifest = JSON.parse(await readFile(packagePath, "utf8")) as { version: string };
  return manifest.version;
}

describe("readDesktopReleaseVersion", () => {
  it("uses the independently versioned Desktop package instead of the CLI package", async () => {
    const desktopVersion = await readVersion(resolve(DESKTOP_DIR, "package.json"));
    const cliVersion = await readVersion(resolve(ROOT_DIR, "packages/cli/package.json"));

    expect(await readDesktopReleaseVersion()).toBe(desktopVersion);
    expect(desktopVersion).not.toBe(cliVersion);
  });

  it("can isolate electron-builder output from a workspace being watched by Desktop", () => {
    const outputDirectory = resolve(ROOT_DIR, "..", "acceptance desktop output");

    expect(createDesktopPackageArgs({ unpacked: false, outputDirectory })).toEqual([
      "exec",
      "electron-builder",
      "--config",
      "electron-builder.yml",
      "--publish",
      "never",
      "--config.directories.output",
      outputDirectory,
    ]);
  });
});
