import type { ProviderConfig } from "@coder-studio/core";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../storage/database.js";
import { closeDatabase, openDatabase, ProviderConfigRepo } from "../storage/index.js";

describe("ProviderConfigRepo", () => {
  let db: Database;
  let repo: ProviderConfigRepo;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "provider-config-repo-test-"));
    const dbPath = join(tempDir, "test.db");
    db = openDatabase(dbPath);
    repo = new ProviderConfigRepo(db);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("set and get", () => {
    it("should set and get a provider configuration", () => {
      const config: ProviderConfig = {
        apiKey: "sk-test-123",
        model: "claude-3-opus",
        temperature: 0.7,
      };

      repo.set("claude-cli", config);
      const result = repo.get("claude-cli");

      expect(result).toEqual(config);
    });

    it("should return undefined for non-existent provider", () => {
      const result = repo.get("non-existent");
      expect(result).toBeUndefined();
    });

    it("should handle complex configurations", () => {
      const config: ProviderConfig = {
        apiEndpoint: "https://api.anthropic.com",
        apiKey: "sk-ant-123",
        defaultModel: "claude-3-sonnet",
        options: {
          maxTokens: 4096,
          temperature: 0.7,
          topP: 1.0,
          stopSequences: ["\n\nHuman:"],
        },
        features: {
          streaming: true,
          caching: true,
        },
      };

      repo.set("claude-cli", config);
      const result = repo.get("claude-cli");

      expect(result).toEqual(config);
      expect(result?.options?.temperature).toBe(0.7);
      expect(result?.features?.streaming).toBe(true);
    });

    it("should update existing configuration", () => {
      const config1: ProviderConfig = {
        apiKey: "key1",
        model: "model1",
      };

      const config2: ProviderConfig = {
        apiKey: "key2",
        model: "model2",
        temperature: 0.5,
      };

      repo.set("claude-cli", config1);
      repo.set("claude-cli", config2);

      const result = repo.get("claude-cli");
      expect(result).toEqual(config2);
    });
  });

  describe("delete", () => {
    it("should delete a provider configuration", () => {
      const config: ProviderConfig = { apiKey: "test" };
      repo.set("claude-cli", config);

      repo.delete("claude-cli");

      const result = repo.get("claude-cli");
      expect(result).toBeUndefined();
    });

    it("should not throw when deleting non-existent provider", () => {
      expect(() => repo.delete("non-existent")).not.toThrow();
    });
  });

  describe("listProviderIds", () => {
    it("should list all provider IDs", () => {
      repo.set("claude-cli", { apiKey: "key1" });
      repo.set("openai", { apiKey: "key2" });
      repo.set("anthropic", { apiKey: "key3" });

      const ids = repo.listProviderIds();

      expect(ids).toHaveLength(3);
      expect(ids).toEqual(expect.arrayContaining(["claude-cli", "openai", "anthropic"]));
    });

    it("should return empty array when no providers configured", () => {
      const ids = repo.listProviderIds();
      expect(ids).toHaveLength(0);
    });
  });

  describe("getAll", () => {
    it("should get all provider configurations", () => {
      const claudeConfig: ProviderConfig = { apiKey: "claude-key", model: "claude-3-opus" };
      const openaiConfig: ProviderConfig = { apiKey: "openai-key", model: "gpt-4" };

      repo.set("claude-cli", claudeConfig);
      repo.set("openai", openaiConfig);

      const all = repo.getAll();

      expect(all).toEqual({
        "claude-cli": claudeConfig,
        openai: openaiConfig,
      });
    });

    it("should return empty object when no providers configured", () => {
      const all = repo.getAll();
      expect(all).toEqual({});
    });
  });

  describe("integration scenarios", () => {
    it("should handle multiple providers with different configurations", () => {
      const claudeConfig: ProviderConfig = {
        apiKey: "sk-ant-123",
        defaultModel: "claude-3-sonnet",
        options: {
          maxTokens: 2048,
          temperature: 0.7,
        },
      };

      const openaiConfig: ProviderConfig = {
        apiKey: "sk-openai-456",
        defaultModel: "gpt-4-turbo",
        options: {
          maxTokens: 4096,
          temperature: 0.9,
        },
      };

      repo.set("claude-cli", claudeConfig);
      repo.set("openai", openaiConfig);

      const all = repo.getAll();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all["claude-cli"].defaultModel).toBe("claude-3-sonnet");
      expect(all.openai.defaultModel).toBe("gpt-4-turbo");
    });
  });
});
