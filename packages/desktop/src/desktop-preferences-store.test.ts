import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopPreferencesStore } from "./desktop-preferences-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  vi.useRealTimers();
});

async function createFilePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "desktop-preferences-"));
  tempDirs.push(root);
  return join(root, "desktop-preferences.json");
}

class FakeWatcher extends EventEmitter {
  readonly close = vi.fn();
}

describe("DesktopPreferencesStore", () => {
  it("starts empty, initializes the theme once, and persists atomic snapshots", async () => {
    const filePath = await createFilePath();
    const changed = vi.fn();
    const store = new DesktopPreferencesStore({
      filePath,
      now: () => new Date("2026-08-26T12:30:00.000Z"),
      onChanged: changed,
    });

    await expect(store.start()).resolves.toMatchObject({
      revision: 0,
      appearance: { themeId: null },
    });
    await expect(store.initializeTheme("nord-dark")).resolves.toEqual({
      schemaVersion: 1,
      revision: 1,
      updatedAt: "2026-08-26T12:30:00.000Z",
      appearance: { themeId: "nord-dark" },
    });
    await expect(store.initializeTheme("mint-light")).resolves.toMatchObject({
      revision: 1,
      appearance: { themeId: "nord-dark" },
    });

    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      revision: 1,
      appearance: { themeId: "nord-dark" },
    });
    expect(changed).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("serializes concurrent writers and keeps the revision monotonic", async () => {
    const filePath = await createFilePath();
    const native = new DesktopPreferencesStore({ filePath });
    const wsl = new DesktopPreferencesStore({ filePath });
    await Promise.all([native.start(), wsl.start()]);

    await Promise.all([
      native.update({ appearance: { themeId: "graphite-dark" } }),
      wsl.update({ appearance: { themeId: "mint-light" } }),
    ]);
    await Promise.all([native.refresh(), wsl.refresh()]);

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.revision).toBe(2);
    expect(["graphite-dark", "mint-light"]).toContain(persisted.appearance.themeId);
    expect(native.getSnapshot()).toEqual(wsl.getSnapshot());
    native.close();
    wsl.close();
  });

  it("rejects a compromised lock before writing preferences", async () => {
    const filePath = await createFilePath();
    const warnings: string[] = [];
    const store = new DesktopPreferencesStore({
      filePath,
      lockFile: async (_path, options) => {
        options?.onCompromised?.(new Error("lock ownership lost"));
        return async () => {
          throw new Error("lock already released");
        };
      },
      onWarning: (message) => warnings.push(message),
    });
    await store.start();

    await expect(store.update({ appearance: { themeId: "graphite-dark" } })).rejects.toThrow(
      "Desktop preferences lock was compromised: lock ownership lost"
    );
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(warnings).toContain("Desktop preferences lock was compromised: lock ownership lost");
    expect(warnings).toContain("Unable to release Desktop preferences lock: lock already released");
    store.close();
  });

  it("does not report a committed preference write as failed when lock release fails", async () => {
    const filePath = await createFilePath();
    const warnings: string[] = [];
    const store = new DesktopPreferencesStore({
      filePath,
      lockFile: async () => async () => {
        throw new Error("unable to remove lock directory");
      },
      onWarning: (message) => warnings.push(message),
    });
    await store.start();

    await expect(store.update({ appearance: { themeId: "graphite-dark" } })).resolves.toMatchObject(
      {
        revision: 1,
        appearance: { themeId: "graphite-dark" },
      }
    );
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      revision: 1,
      appearance: { themeId: "graphite-dark" },
    });
    expect(warnings).toContain(
      "Unable to release Desktop preferences lock: unable to remove lock directory"
    );
    store.close();
  });

  it("allows only the first concurrent migration to initialize the theme", async () => {
    const filePath = await createFilePath();
    const native = new DesktopPreferencesStore({ filePath });
    const wsl = new DesktopPreferencesStore({ filePath });
    await Promise.all([native.start(), wsl.start()]);

    await Promise.all([native.initializeTheme("nord-dark"), wsl.initializeTheme("mint-light")]);
    await Promise.all([native.refresh(), wsl.refresh()]);

    expect(native.getSnapshot().revision).toBe(1);
    expect(native.getSnapshot()).toEqual(wsl.getSnapshot());
    native.close();
    wsl.close();
  });

  it("reloads a sibling write after a matching directory watch event", async () => {
    const filePath = await createFilePath();
    const watcher = new FakeWatcher();
    let onDirectoryChange:
      | ((eventType: string, filename: string | Buffer | null) => void)
      | undefined;
    const changed = vi.fn();
    const reader = new DesktopPreferencesStore({
      filePath,
      onChanged: changed,
      watchDebounceMs: 25,
      watchDirectory: (_path, listener) => {
        onDirectoryChange = listener;
        return watcher;
      },
    });
    const writer = new DesktopPreferencesStore({ filePath });
    await Promise.all([reader.start(), writer.start()]);
    await writer.update({ appearance: { themeId: "winter-dark" } });

    onDirectoryChange?.("rename", "unrelated.json");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(changed).not.toHaveBeenCalled();
    onDirectoryChange?.("rename", "desktop-preferences.json");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));

    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 1, appearance: { themeId: "winter-dark" } })
    );
    reader.close();
    writer.close();
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  it("keeps the last valid snapshot when the shared file becomes malformed", async () => {
    const filePath = await createFilePath();
    const warnings: string[] = [];
    const store = new DesktopPreferencesStore({
      filePath,
      onWarning: (message) => warnings.push(message),
    });
    await store.start();
    await store.update({ appearance: { themeId: "hc-dark" } });
    await writeFile(filePath, "{invalid", "utf8");

    await expect(store.refresh()).resolves.toMatchObject({
      revision: 1,
      appearance: { themeId: "hc-dark" },
    });
    await expect(store.update({ appearance: { themeId: "hc-light" } })).rejects.toThrow(
      "Unable to parse desktop-preferences.json"
    );
    expect(warnings).toHaveLength(1);
    store.close();
  });
});
