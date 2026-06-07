import { describe, expect, it } from "vitest";
import {
  getAllProviderIds,
  getProviderById,
  getProvidersByCapability,
  isValidProviderId,
  providerRegistry,
  toProviderListItem,
} from "../src/registry.js";

describe("Provider Registry", () => {
  describe("providerRegistry", () => {
    it("should contain Claude and Codex providers", () => {
      expect(providerRegistry.length).toBe(2);

      const ids = providerRegistry.map((p) => p.id);
      expect(ids).toContain("claude");
      expect(ids).toContain("codex");
    });

    it("should have valid definitions for all providers", () => {
      for (const provider of providerRegistry) {
        expect(provider.id).toBeDefined();
        expect(provider.displayName).toBeDefined();
        expect(provider.badge).toBeDefined();
        expect(provider.capability).toMatch(/^(full|limited|unsupported)$/);
        expect(provider.requiredCommands).toBeDefined();
        expect(provider.configSchema).toBeDefined();
        expect(provider.defaultConfig).toBeDefined();
        expect(provider.buildCommand).toBeDefined();
      }
    });
  });

  describe("getProviderById", () => {
    it("should return Claude provider", () => {
      const result = getProviderById("claude");
      expect(result).toBeDefined();
      expect(result?.id).toBe("claude");
      expect(result?.capability).toBe("full");
    });

    it("should return Codex provider", () => {
      const result = getProviderById("codex");
      expect(result).toBeDefined();
      expect(result?.id).toBe("codex");
      expect(result?.capability).toBe("full");
    });

    it("should return undefined for unknown provider", () => {
      const result = getProviderById("unknown");
      expect(result).toBeUndefined();
    });
  });

  describe("isValidProviderId", () => {
    it("should return true for valid IDs", () => {
      expect(isValidProviderId("claude")).toBe(true);
      expect(isValidProviderId("codex")).toBe(true);
    });

    it("should return false for invalid IDs", () => {
      expect(isValidProviderId("unknown")).toBe(false);
      expect(isValidProviderId("")).toBe(false);
    });
  });

  describe("getAllProviderIds", () => {
    it("should return all provider IDs", () => {
      const ids = getAllProviderIds();
      expect(ids.length).toBe(2);
      expect(ids).toContain("claude");
      expect(ids).toContain("codex");
    });
  });

  describe("getProvidersByCapability", () => {
    it("should return full capability providers", () => {
      const fullProviders = getProvidersByCapability("full");
      expect(fullProviders.length).toBe(2);
      const ids = fullProviders.map((p) => p.id).sort();
      expect(ids).toEqual(["claude", "codex"]);
    });

    it("should return no limited capability providers (codex upgraded to full)", () => {
      const limitedProviders = getProvidersByCapability("limited");
      expect(limitedProviders.length).toBe(0);
    });

    it("should return empty array for unsupported capability", () => {
      const unsupportedProviders = getProvidersByCapability("unsupported");
      expect(unsupportedProviders.length).toBe(0);
    });
  });

  describe("toProviderListItem", () => {
    it("returns a safe provider DTO for Claude", () => {
      const provider = getProviderById("claude");
      expect(provider).toBeDefined();

      const item = toProviderListItem(provider!);

      expect(item).toEqual({
        id: "claude",
        displayName: "Claude Code",
        badge: "Claude",
        kind: "built_in",
        capability: "full",
        capabilities: [
          { key: "interactive_session", supported: true, label: "Interactive session" },
          { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
          { key: "idle_detection", supported: true, label: "Idle detection" },
          { key: "context_attach", supported: false, label: "Context attach" },
          { key: "review", supported: false, label: "Review" },
        ],
        requiredCommands: ["claude"],
      });
    });

    it("returns a safe provider DTO for Codex without executable internals", () => {
      const provider = getProviderById("codex");
      expect(provider).toBeDefined();

      const item = toProviderListItem(provider!);

      expect(item).toEqual({
        id: "codex",
        displayName: "Codex",
        badge: "Codex",
        kind: "built_in",
        capability: "full",
        capabilities: [
          { key: "interactive_session", supported: true, label: "Interactive session" },
          { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
          { key: "idle_detection", supported: true, label: "Idle detection" },
          { key: "context_attach", supported: false, label: "Context attach" },
          { key: "review", supported: false, label: "Review" },
        ],
        requiredCommands: ["codex"],
      });
      expect("buildCommand" in item).toBe(false);
      expect("install" in item).toBe(false);
      expect("configSchema" in item).toBe(false);
      expect("defaultConfig" in item).toBe(false);
    });
  });
});
