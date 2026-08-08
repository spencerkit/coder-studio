import { describe, expect, it, vi } from "vitest";
import { lookupNpmReleaseMetadata } from "./npm-release-metadata.js";

describe("lookupNpmReleaseMetadata", () => {
  it("resolves the selected tag and both publication times", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            "dist-tags": { latest: "0.6.0", next: "0.7.0-beta.1" },
            time: {
              "0.5.0": "2026-07-01T02:03:04.000Z",
              "0.7.0-beta.1": "2026-08-08T03:04:05.000Z",
            },
          }),
          { status: 200 }
        )
    );

    await expect(
      lookupNpmReleaseMetadata({
        packageName: "@spencer-kit/coder-studio",
        currentVersion: "0.5.0",
        distTag: "next",
        registryUrl: "https://registry.npmjs.org/",
        fetch: fetchImpl,
      })
    ).resolves.toEqual({
      version: "0.7.0-beta.1",
      currentPublishedAt: "2026-07-01T02:03:04.000Z",
      latestPublishedAt: "2026-08-08T03:04:05.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://registry.npmjs.org/%40spencer-kit%2Fcoder-studio",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("normalizes invalid or missing publication times to null", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            "dist-tags": { latest: "0.6.0" },
            time: { "0.5.0": "not-a-date" },
          }),
          { status: 200 }
        )
    );

    await expect(
      lookupNpmReleaseMetadata({
        packageName: "@spencer-kit/coder-studio",
        currentVersion: "0.5.0",
        distTag: "latest",
        registryUrl: "https://registry.npmjs.org/",
        fetch: fetchImpl,
      })
    ).resolves.toMatchObject({ currentPublishedAt: null, latestPublishedAt: null });
  });
});
