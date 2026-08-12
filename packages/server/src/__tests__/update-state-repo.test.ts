import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UpdateStateRepo } from "../storage/repositories/update-state-repo.js";

describe("UpdateStateRepo", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns the default state when the file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "update-state-repo-"));
    tempDirs.push(dir);
    const repo = new UpdateStateRepo({
      filePath: join(dir, "update-state.json"),
      currentVersion: "0.4.0",
    });

    expect(repo.get()).toEqual({
      version: 2,
      currentVersion: "0.4.0",
      currentPublishedAt: null,
      latestVersion: null,
      latestPublishedAt: null,
      availability: "unknown",
      updateStatus: "idle",
      lastCheckedAt: null,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
    });
  });

  it("persists partial updates on top of the current snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "update-state-repo-"));
    tempDirs.push(dir);
    const repo = new UpdateStateRepo({
      filePath: join(dir, "update-state.json"),
      currentVersion: "0.4.0",
    });

    repo.update({
      latestVersion: "0.5.0",
      availability: "update_available",
      lastCheckedAt: 123,
    });

    expect(repo.get()).toMatchObject({
      currentVersion: "0.4.0",
      latestVersion: "0.5.0",
      availability: "update_available",
      lastCheckedAt: 123,
      updateStatus: "idle",
    });
  });

  it("reads v1 without writing and upgrades on the next mutation", () => {
    const dir = mkdtempSync(join(tmpdir(), "update-state-repo-"));
    tempDirs.push(dir);
    const filePath = join(dir, "update-state.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        currentVersion: "0.4.0",
        latestVersion: "0.5.0",
        availability: "update_available",
        updateStatus: "idle",
        lastCheckedAt: 100,
        targetVersion: null,
        startedAt: null,
        finishedAt: null,
        requiresManualStep: false,
        manualCommand: null,
        errorSummary: null,
      })
    );
    const repo = new UpdateStateRepo({ filePath, currentVersion: "0.4.0" });

    expect(repo.get()).toMatchObject({
      version: 2,
      currentPublishedAt: null,
      latestPublishedAt: null,
    });
    expect(JSON.parse(readFileSync(filePath, "utf8")).version).toBe(1);

    repo.update({ latestPublishedAt: "2026-08-08T01:02:03.000Z" });
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toMatchObject({
      version: 2,
      latestPublishedAt: "2026-08-08T01:02:03.000Z",
    });
  });
});
