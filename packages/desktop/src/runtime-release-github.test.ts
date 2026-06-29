import { describe, expect, it } from "vitest";
import {
  extractRuntimeReleaseMetadataFromGitHubIndex,
  GitHubRuntimeReleaseProvider,
} from "./runtime-release-github.js";

describe("runtime-release-github", () => {
  it("parses machine-readable github release metadata", () => {
    const releases = extractRuntimeReleaseMetadataFromGitHubIndex([
      {
        version: "0.5.4",
        platform: "win32",
        arch: "x64",
        artifactUrl:
          "https://github.com/spencerkit/coder-studio/releases/download/v0.5.4/runtime.zip",
        checksumSha256: "sha-123",
        artifactSize: 1234,
        publishedAt: "2026-06-28T10:00:00.000Z",
        minAppVersion: "0.5.0",
      },
    ]);

    expect(releases).toEqual([
      {
        version: "0.5.4",
        platform: "win32",
        arch: "x64",
        artifactUrl:
          "https://github.com/spencerkit/coder-studio/releases/download/v0.5.4/runtime.zip",
        checksumSha256: "sha-123",
        artifactSize: 1234,
        publishedAt: "2026-06-28T10:00:00.000Z",
        minAppVersion: "0.5.0",
      },
    ]);
  });

  it("rejects malformed github metadata", () => {
    expect(() =>
      extractRuntimeReleaseMetadataFromGitHubIndex([
        {
          version: "0.5.4",
          platform: "win32",
          arch: "x64",
        },
      ])
    ).toThrow(/artifactUrl|checksumSha256|artifactSize|publishedAt/i);
  });

  it("resolves the latest compatible release from github metadata", async () => {
    const provider = new GitHubRuntimeReleaseProvider({
      fetchReleaseIndex: async () => [
        {
          version: "0.5.4",
          platform: "win32",
          arch: "x64",
          artifactUrl: "https://example.com/0.5.4.zip",
          checksumSha256: "sha-054",
          artifactSize: 5400,
          publishedAt: "2026-06-28T10:00:00.000Z",
        },
        {
          version: "0.5.5",
          platform: "win32",
          arch: "x64",
          artifactUrl: "https://example.com/0.5.5.zip",
          checksumSha256: "sha-055",
          artifactSize: 5500,
          publishedAt: "2026-06-29T10:00:00.000Z",
          minAppVersion: "0.5.0",
        },
        {
          version: "0.5.6",
          platform: "darwin",
          arch: "arm64",
          artifactUrl: "https://example.com/0.5.6.zip",
          checksumSha256: "sha-056",
          artifactSize: 5600,
          publishedAt: "2026-06-30T10:00:00.000Z",
        },
      ],
    });

    await expect(
      provider.resolveLatestCompatible({
        appVersion: "0.5.4",
        platform: "win32",
        arch: "x64",
      })
    ).resolves.toMatchObject({
      version: "0.5.5",
      artifactUrl: "https://example.com/0.5.5.zip",
    });
  });

  it("resolves a specific version only when it is compatible", async () => {
    const provider = new GitHubRuntimeReleaseProvider({
      fetchReleaseIndex: async () => [
        {
          version: "0.5.5",
          platform: "win32",
          arch: "x64",
          artifactUrl: "https://example.com/0.5.5.zip",
          checksumSha256: "sha-055",
          artifactSize: 5500,
          publishedAt: "2026-06-29T10:00:00.000Z",
        },
        {
          version: "0.5.5",
          platform: "darwin",
          arch: "arm64",
          artifactUrl: "https://example.com/0.5.5-darwin.zip",
          checksumSha256: "sha-055-d",
          artifactSize: 5555,
          publishedAt: "2026-06-29T10:00:00.000Z",
        },
      ],
    });

    await expect(
      provider.resolveVersion("0.5.5", {
        appVersion: "0.5.4",
        platform: "win32",
        arch: "x64",
      })
    ).resolves.toMatchObject({
      version: "0.5.5",
      platform: "win32",
    });

    await expect(
      provider.resolveVersion("0.5.4", {
        appVersion: "0.5.4",
        platform: "win32",
        arch: "x64",
      })
    ).resolves.toBeNull();
  });
});
