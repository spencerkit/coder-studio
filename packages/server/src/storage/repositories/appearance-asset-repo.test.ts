import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppearanceAssetRepo } from "./appearance-asset-repo.js";

describe("AppearanceAssetRepo", () => {
  let tempDir: string;
  let repo: AppearanceAssetRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "appearance-asset-repo-"));
    repo = new AppearanceAssetRepo({ filePath: join(tempDir, "appearance-assets.json") });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores, reads, and deletes service-scoped appearance asset metadata", () => {
    const createdAt = Date.now();
    repo.set({
      id: "asset-1",
      fileName: "pixel.png",
      mime: "image/png",
      size: 68,
      storagePath: join(
        tempDir,
        "uploads",
        "appearance",
        "default",
        "2026-05-21",
        "asset-1-pixel.png"
      ),
      createdAt,
    });

    const reloaded = new AppearanceAssetRepo({
      filePath: join(tempDir, "appearance-assets.json"),
    });

    expect(reloaded.get("asset-1")).toEqual({
      id: "asset-1",
      fileName: "pixel.png",
      mime: "image/png",
      size: 68,
      storagePath: join(
        tempDir,
        "uploads",
        "appearance",
        "default",
        "2026-05-21",
        "asset-1-pixel.png"
      ),
      createdAt,
    });
    expect(reloaded.list()).toEqual([
      {
        id: "asset-1",
        fileName: "pixel.png",
        mime: "image/png",
        size: 68,
        storagePath: join(
          tempDir,
          "uploads",
          "appearance",
          "default",
          "2026-05-21",
          "asset-1-pixel.png"
        ),
        createdAt,
      },
    ]);

    reloaded.delete("asset-1");

    expect(reloaded.get("asset-1")).toBeUndefined();
    expect(reloaded.list()).toEqual([]);
  });
});
