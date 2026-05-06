import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  dependencies?: Record<string, string>;
}

function readPackageManifest(relativePath: string): PackageManifest {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf-8")
  ) as PackageManifest;
}

describe("cli package manifest", () => {
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
