import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDesktopBuildInfo, readDesktopBuildInfo } from "./build-info.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Desktop build info", () => {
  it("parses release build info", () => {
    expect(
      parseDesktopBuildInfo({
        schemaVersion: 1,
        shellVersion: "0.3.0",
        builtAt: "2026-08-08T00:55:00.000Z",
        publishedAt: "2026-08-08T01:02:03.000Z",
        engineVersion: "2",
        nodeVersion: "24.19.0",
        runtimeHostApiVersion: 1,
        apiProtocolVersion: 1,
        dataSchemaVersion: 1,
      })
    ).toMatchObject({ shellVersion: "0.3.0", publishedAt: "2026-08-08T01:02:03.000Z" });
  });

  it("uses the actual app version and unknown release time for legacy packages", async () => {
    const resourcesPath = await mkdtemp(join(tmpdir(), "desktop-build-info-"));
    tempDirs.push(resourcesPath);
    await writeFile(join(resourcesPath, "build-info.json"), "{broken", "utf8");

    await expect(readDesktopBuildInfo(resourcesPath, "0.2.0")).resolves.toMatchObject({
      shellVersion: "0.2.0",
      publishedAt: null,
      metadataAvailable: false,
    });
  });
});
