import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsRepo } from "../storage/repositories/settings-repo.js";
import { WORKSPACE_HISTORY_KEY, WorkspaceHistoryStore } from "./history-store.js";

describe("WorkspaceHistoryStore", () => {
  let settingsDir: string;
  let settingsRepo: SettingsRepo;
  let store: WorkspaceHistoryStore;

  beforeEach(() => {
    settingsDir = mkdtempSync(join(tmpdir(), "workspace-history-store-"));
    settingsRepo = new SettingsRepo({ filePath: join(settingsDir, "settings.json") });
    store = new WorkspaceHistoryStore(settingsRepo);
  });

  afterEach(() => {
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("returns an empty list when no history is stored", () => {
    expect(store.list()).toEqual([]);
  });

  it("records, dedupes, and sorts recent workspaces newest first", () => {
    store.recordOpen("/repo/app", 100);
    store.recordOpen("/repo/docs", 200);
    store.recordOpen("/repo/app", 300);

    expect(store.list()).toEqual([
      {
        path: "/repo/app",
        name: "app",
        lastOpenedAt: 300,
      },
      {
        path: "/repo/docs",
        name: "docs",
        lastOpenedAt: 200,
      },
    ]);
  });

  it("filters malformed entries and trims history to the newest twenty items", () => {
    settingsRepo.set(WORKSPACE_HISTORY_KEY, [
      {
        path: "/repo/kept",
        name: "kept",
        lastOpenedAt: 5,
      },
      {
        path: 123,
        name: "broken",
        lastOpenedAt: 4,
      },
    ]);

    for (let index = 0; index < 25; index += 1) {
      store.recordOpen(`/repo/project-${index}`, index + 10);
    }

    const history = store.list();
    expect(history).toHaveLength(20);
    expect(history[0]).toEqual({
      path: "/repo/project-24",
      name: "project-24",
      lastOpenedAt: 34,
    });
    expect(history.at(-1)).toEqual({
      path: "/repo/project-5",
      name: "project-5",
      lastOpenedAt: 15,
    });
    expect(history.find((entry) => entry.path === "/repo/kept")).toBeUndefined();
  });

  it("removes a stored history entry by path while preserving the remaining order", () => {
    store.recordOpen("/repo/alpha", 100);
    store.recordOpen("/repo/beta", 200);
    store.recordOpen("/repo/gamma", 300);

    const nextHistory = store.remove("/repo/beta");

    expect(nextHistory).toEqual([
      {
        path: "/repo/gamma",
        name: "gamma",
        lastOpenedAt: 300,
      },
      {
        path: "/repo/alpha",
        name: "alpha",
        lastOpenedAt: 100,
      },
    ]);
    expect(store.list()).toEqual(nextHistory);
  });

  it("returns the current history unchanged when removing a path that is not present", () => {
    store.recordOpen("/repo/alpha", 100);

    const nextHistory = store.remove("/repo/missing");

    expect(nextHistory).toEqual([
      {
        path: "/repo/alpha",
        name: "alpha",
        lastOpenedAt: 100,
      },
    ]);
    expect(store.list()).toEqual(nextHistory);
  });

  it("clears the stored history and removes the persisted key", () => {
    store.recordOpen("/repo/alpha", 100);
    store.recordOpen("/repo/beta", 200);

    const nextHistory = store.clear();

    expect(nextHistory).toEqual([]);
    expect(store.list()).toEqual([]);
    expect(settingsRepo.get(WORKSPACE_HISTORY_KEY)).toBeUndefined();
  });
});
