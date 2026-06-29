import { describe, expect, it } from "vitest";
import {
  isRuntimeReleaseCompatible,
  pickLatestCompatibleRuntimeRelease,
  type RuntimeReleaseMetadata,
} from "./runtime-release-provider.js";

function release(overrides: Partial<RuntimeReleaseMetadata>): RuntimeReleaseMetadata {
  return {
    version: "0.5.4",
    platform: "win32",
    arch: "x64",
    artifactUrl: "https://example.com/runtime.zip",
    checksumSha256: "sha-123",
    artifactSize: 1234,
    publishedAt: "2026-06-28T10:00:00.000Z",
    ...overrides,
  };
}

describe("runtime-release-provider", () => {
  it("accepts releases compatible with the target app version, platform, and arch", () => {
    expect(
      isRuntimeReleaseCompatible(release({ minAppVersion: "0.5.0" }), {
        appVersion: "0.5.4",
        platform: "win32",
        arch: "x64",
      })
    ).toBe(true);
  });

  it("rejects releases when platform, arch, or minimum app version do not match", () => {
    expect(
      isRuntimeReleaseCompatible(release({ platform: "darwin" }), {
        appVersion: "0.5.4",
        platform: "win32",
        arch: "x64",
      })
    ).toBe(false);

    expect(
      isRuntimeReleaseCompatible(release({ arch: "arm64" }), {
        appVersion: "0.5.4",
        platform: "win32",
        arch: "x64",
      })
    ).toBe(false);

    expect(
      isRuntimeReleaseCompatible(release({ minAppVersion: "0.6.0" }), {
        appVersion: "0.5.4",
        platform: "win32",
        arch: "x64",
      })
    ).toBe(false);
  });

  it("picks the newest compatible release by runtime version", () => {
    const picked = pickLatestCompatibleRuntimeRelease(
      [
        release({ version: "0.5.3", publishedAt: "2026-06-27T10:00:00.000Z" }),
        release({ version: "0.5.5", publishedAt: "2026-06-26T10:00:00.000Z" }),
        release({
          version: "0.5.4",
          platform: "darwin",
          publishedAt: "2026-06-28T10:00:00.000Z",
        }),
      ],
      {
        appVersion: "0.5.4",
        platform: "win32",
        arch: "x64",
      }
    );

    expect(picked?.version).toBe("0.5.5");
  });

  it("returns null when no compatible release exists", () => {
    const picked = pickLatestCompatibleRuntimeRelease([release({ platform: "darwin" })], {
      appVersion: "0.5.4",
      platform: "win32",
      arch: "x64",
    });

    expect(picked).toBeNull();
  });
});
