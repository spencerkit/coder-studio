import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { getCliVersion, resolveCliPackageManifestUrl } from "./package-manifest.js";

interface PackageManifest {
  dependencies?: Record<string, string>;
}

function readPackageManifest(relativePath: string): PackageManifest {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf-8")
  ) as PackageManifest;
}

describe("cli package manifest", () => {
  it("resolves the CLI package manifest instead of the workspace root manifest", () => {
    expect(fileURLToPath(resolveCliPackageManifestUrl(import.meta.url))).toBe(
      fileURLToPath(new URL("../package.json", import.meta.url))
    );
  });

  it("reads the published CLI version from the CLI package manifest", () => {
    const cliPackage = readPackageManifest("../package.json") as { version?: string };

    expect(getCliVersion(import.meta.url)).toBe(cliPackage.version);
  });

  it("declares every external server runtime dependency", () => {
    const cliPackage = readPackageManifest("../package.json");
    const serverPackage = readPackageManifest("../../server/package.json");

    const cliDependencies = cliPackage.dependencies ?? {};
    const missingDependencies = Object.keys(serverPackage.dependencies ?? {}).filter(
      (dependency) =>
        !dependency.startsWith("@coder-studio/") && cliDependencies[dependency] === undefined
    );

    expect(missingDependencies).toEqual([]);
  });
});
