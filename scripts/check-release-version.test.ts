import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertReleaseTagMatchesPackage,
  parseCheckReleaseVersionArgs,
  versionFromReleaseTag,
} from "./check-release-version.js";

describe("check-release-version", () => {
  it("parses an explicit release tag", () => {
    expect(parseCheckReleaseVersionArgs(["--tag", "v1.2.3"])).toEqual({ tag: "v1.2.3" });
  });

  it("ignores the pnpm argument separator", () => {
    expect(parseCheckReleaseVersionArgs(["--", "--tag", "v1.2.3"])).toEqual({ tag: "v1.2.3" });
  });

  it("extracts the semver version from a v-prefixed release tag", () => {
    expect(versionFromReleaseTag("v1.2.3")).toBe("1.2.3");
    expect(versionFromReleaseTag("v1.2.3-beta.1")).toBe("1.2.3-beta.1");
  });

  it("rejects tags outside the release tag format", () => {
    expect(() => versionFromReleaseTag("release-1.2.3")).toThrow("Expected release tag");
  });

  it("requires the release tag to match packages/cli/package.json version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coder-studio-release-version-"));
    const packageJsonPath = join(dir, "package.json");
    await writeFile(packageJsonPath, JSON.stringify({ version: "1.2.3" }));

    await expect(
      assertReleaseTagMatchesPackage({ tag: "v1.2.3", packageJsonPath })
    ).resolves.toEqual({ tag: "v1.2.3", version: "1.2.3" });

    await expect(
      assertReleaseTagMatchesPackage({ tag: "v1.2.4", packageJsonPath })
    ).rejects.toThrow("does not match");
  });
});
