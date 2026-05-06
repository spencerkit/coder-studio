import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../storage/database.js";
import { closeDatabase, openDatabase, SettingsRepo } from "../storage/index.js";

describe("SettingsRepo", () => {
  let db: Database;
  let repo: SettingsRepo;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "settings-repo-test-"));
    const dbPath = join(tempDir, "test.db");
    db = openDatabase(dbPath);
    repo = new SettingsRepo(db);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("set and get", () => {
    it("should set and get a setting value", () => {
      repo.set("theme", "dark");
      const result = repo.get<string>("theme");
      expect(result).toBe("dark");
    });

    it("should return undefined for non-existent key", () => {
      const result = repo.get("non-existent");
      expect(result).toBeUndefined();
    });

    it("should handle complex objects", () => {
      const settings = {
        theme: "dark",
        fontSize: 14,
        features: {
          notifications: true,
          autoSave: false,
        },
      };

      repo.set("user-preferences", settings);
      const result = repo.get("user-preferences");

      expect(result).toEqual(settings);
    });

    it("should handle arrays", () => {
      const recentFiles = ["/path/to/file1", "/path/to/file2", "/path/to/file3"];
      repo.set("recent-files", recentFiles);
      const result = repo.get<string[]>("recent-files");
      expect(result).toEqual(recentFiles);
    });

    it("should update existing setting", () => {
      repo.set("language", "en");
      repo.set("language", "zh");

      const result = repo.get<string>("language");
      expect(result).toBe("zh");
    });
  });

  describe("delete", () => {
    it("should delete a setting by key", () => {
      repo.set("test-key", "test-value");
      repo.delete("test-key");

      const result = repo.get("test-key");
      expect(result).toBeUndefined();
    });

    it("should not throw when deleting non-existent key", () => {
      expect(() => repo.delete("non-existent")).not.toThrow();
    });
  });

  describe("listKeys", () => {
    it("should list all setting keys", () => {
      repo.set("key1", "value1");
      repo.set("key2", "value2");
      repo.set("key3", "value3");

      const keys = repo.listKeys();

      expect(keys).toHaveLength(3);
      expect(keys).toEqual(expect.arrayContaining(["key1", "key2", "key3"]));
    });

    it("should return empty array when no settings exist", () => {
      const keys = repo.listKeys();
      expect(keys).toHaveLength(0);
    });
  });

  describe("getAll", () => {
    it("should get all settings as an object", () => {
      repo.set("theme", "dark");
      repo.set("fontSize", 14);
      repo.set("language", "en");

      const all = repo.getAll();

      expect(all).toEqual({
        theme: "dark",
        fontSize: 14,
        language: "en",
      });
    });

    it("should return empty object when no settings exist", () => {
      const all = repo.getAll();
      expect(all).toEqual({});
    });

    it("should handle mixed types", () => {
      repo.set("string", "text");
      repo.set("number", 42);
      repo.set("boolean", true);
      repo.set("object", { nested: "value" });
      repo.set("array", [1, 2, 3]);

      const all = repo.getAll();

      expect(all.string).toBe("text");
      expect(all.number).toBe(42);
      expect(all.boolean).toBe(true);
      expect(all.object).toEqual({ nested: "value" });
      expect(all.array).toEqual([1, 2, 3]);
    });
  });

  describe("type safety", () => {
    it("should preserve type information with generics", () => {
      interface UserPreferences {
        theme: "light" | "dark";
        notifications: boolean;
        maxHistory: number;
      }

      const prefs: UserPreferences = {
        theme: "dark",
        notifications: true,
        maxHistory: 100,
      };

      repo.set<UserPreferences>("preferences", prefs);
      const result = repo.get<UserPreferences>("preferences");

      expect(result).toEqual(prefs);
      expect(result?.theme).toBe("dark");
      expect(result?.notifications).toBe(true);
      expect(result?.maxHistory).toBe(100);
    });
  });
});
