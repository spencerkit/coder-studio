import { describe, expect, it } from "vitest";
import { getProviderPresets, providerPresets } from "./presets.js";
import { providerRegistry } from "./registry.js";

describe("provider presets", () => {
  it("defines preset metadata for future providers", () => {
    expect(providerPresets).toEqual([
      expect.objectContaining({
        id: "gemini-cli",
        displayName: "Gemini CLI",
        kind: "preset",
        command: "gemini",
        requiredCommands: ["gemini"],
      }),
      expect.objectContaining({
        id: "aider",
        displayName: "Aider",
        kind: "preset",
        command: "aider",
        requiredCommands: ["aider"],
      }),
      expect.objectContaining({
        id: "opencode",
        displayName: "OpenCode",
        kind: "preset",
        command: "opencode",
        requiredCommands: ["opencode"],
      }),
    ]);
  });

  it("returns stable copies and keeps presets out of the active provider registry", () => {
    const first = getProviderPresets();
    const second = getProviderPresets();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);

    const activeProviderIds = new Set(providerRegistry.map((provider) => provider.id));
    for (const preset of first) {
      expect(activeProviderIds.has(preset.id)).toBe(false);
    }
  });
});
