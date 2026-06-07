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
    it("should contain the built-in provider set", () => {
      expect(providerRegistry.length).toBe(5);

      const ids = providerRegistry.map((p) => p.id);
      expect(ids).toContain("claude");
      expect(ids).toContain("codex");
      expect(ids).toContain("gemini");
      expect(ids).toContain("cursor");
      expect(ids).toContain("opencode");
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

    it("should return Gemini, Cursor, and OpenCode providers", () => {
      expect(getProviderById("gemini")?.requiredCommands).toEqual(["gemini"]);
      expect(getProviderById("cursor")?.requiredCommands).toEqual(["agent"]);
      expect(getProviderById("opencode")?.capability).toBe("limited");
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
      expect(isValidProviderId("gemini")).toBe(true);
      expect(isValidProviderId("cursor")).toBe(true);
      expect(isValidProviderId("opencode")).toBe(true);
    });

    it("should return false for invalid IDs", () => {
      expect(isValidProviderId("unknown")).toBe(false);
      expect(isValidProviderId("")).toBe(false);
    });
  });

  describe("getAllProviderIds", () => {
    it("should return all provider IDs", () => {
      const ids = getAllProviderIds();
      expect(ids.length).toBe(5);
      expect(ids).toContain("claude");
      expect(ids).toContain("codex");
      expect(ids).toContain("gemini");
      expect(ids).toContain("cursor");
      expect(ids).toContain("opencode");
    });
  });

  describe("getProvidersByCapability", () => {
    it("should return full capability providers", () => {
      const fullProviders = getProvidersByCapability("full");
      expect(fullProviders.length).toBe(4);
      const ids = fullProviders.map((p) => p.id).sort();
      expect(ids).toEqual(["claude", "codex", "cursor", "gemini"]);
    });

    it("should return limited capability providers", () => {
      const limitedProviders = getProvidersByCapability("limited");
      expect(limitedProviders.length).toBe(1);
      expect(limitedProviders[0]?.id).toBe("opencode");
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
        stability: undefined,
        supportsAgentInstructions: true,
        supportsAgentInstructionsGeneration: true,
        supportsSkillsMount: true,
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
        stability: undefined,
        supportsAgentInstructions: true,
        supportsAgentInstructionsGeneration: true,
        supportsSkillsMount: true,
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

    it("maps provider metadata for Gemini and OpenCode", () => {
      const gemini = toProviderListItem(getProviderById("gemini")!);
      const opencode = toProviderListItem(getProviderById("opencode")!);

      expect(gemini).toMatchObject({
        id: "gemini",
        stability: "stable",
        supportsAgentInstructions: true,
        supportsAgentInstructionsGeneration: true,
        supportsSkillsMount: true,
        capability: "full",
      });

      expect(opencode).toMatchObject({
        id: "opencode",
        stability: "experimental",
        supportsAgentInstructions: true,
        supportsAgentInstructionsGeneration: false,
        supportsSkillsMount: true,
        capability: "limited",
      });
    });
  });

  describe("install metadata", () => {
    it("declares auto-install strategies for Gemini and OpenCode", () => {
      const gemini = getProviderById("gemini");
      const opencode = getProviderById("opencode");

      expect(gemini?.install).toMatchObject({
        prerequisites: ["npm"],
        manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.gemini.manual"],
        docUrls: {
          provider: "https://google-gemini.github.io/gemini-cli/docs/get-started/",
          prerequisites: {
            npm: "https://nodejs.org/en/download",
          },
        },
      });
      expect(gemini?.install.strategies.linux).toContainEqual(
        expect.objectContaining({
          id: "npm-install-gemini",
          kind: "provider",
          targetCommand: "gemini",
          command: "npm",
          args: ["install", "-g", "@google/gemini-cli"],
        })
      );

      expect(opencode?.install).toMatchObject({
        prerequisites: ["npm"],
        manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.opencode.manual"],
        docUrls: {
          provider: "https://github.com/anomalyco/opencode#installation",
          prerequisites: {
            npm: "https://nodejs.org/en/download",
          },
        },
      });
      expect(opencode?.install.strategies.linux).toContainEqual(
        expect.objectContaining({
          id: "npm-install-opencode",
          kind: "provider",
          targetCommand: "opencode",
          command: "npm",
          args: ["install", "-g", "opencode-ai"],
        })
      );
    });

    it("declares Cursor Agent install support through the official agent command", () => {
      const cursor = getProviderById("cursor");

      expect(cursor?.requiredCommands).toEqual(["agent"]);
      expect(cursor?.install).toMatchObject({
        prerequisites: [],
        manualGuideKeys: ["provider.install.cursor.manual"],
        docUrls: {
          provider: "https://cursor.com/docs/cli/installation",
          prerequisites: {},
        },
      });
      expect(cursor?.install.strategies.linux).toEqual([
        expect.objectContaining({
          id: "cursor-install-script",
          kind: "provider",
          targetCommand: "agent",
          requiresCommands: ["bash"],
          command: "bash",
          args: ["-lc", "curl https://cursor.com/install -fsS | bash"],
        }),
      ]);
      expect(cursor?.install.strategies.darwin).toEqual(cursor?.install.strategies.linux);
      expect(cursor?.install.strategies.win32).toBeUndefined();
    });
  });
});
