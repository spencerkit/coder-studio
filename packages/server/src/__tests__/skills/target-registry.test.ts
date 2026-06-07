import type { ProviderDefinition } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import { buildAgentSkillTargets } from "../../skills/target-registry.js";

const providers = [
  {
    id: "claude",
    displayName: "Claude Code",
    badge: "Claude",
    kind: "built_in",
    supportsSkillsMount: true,
    capability: "full",
    capabilities: [],
    install: {
      prerequisites: [],
      manualGuideKeys: [],
      docUrls: { provider: "", prerequisites: {} },
      strategies: {},
    },
    buildCommand: () => ({ argv: ["claude"], env: {}, cwd: "/tmp" }),
    configSchema: { parse: (value: unknown) => value } as never,
    defaultConfig: {},
    requiredCommands: ["claude"],
  },
  {
    id: "review-bot",
    displayName: "Review Bot",
    badge: "Custom",
    kind: "custom",
    supportsSkillsMount: false,
    capability: "full",
    capabilities: [],
    install: {
      prerequisites: [],
      manualGuideKeys: [],
      docUrls: { provider: "", prerequisites: {} },
      strategies: {},
    },
    buildCommand: () => ({ argv: ["review-bot"], env: {}, cwd: "/tmp" }),
    configSchema: { parse: (value: unknown) => value } as never,
    defaultConfig: {},
    requiredCommands: ["review-bot"],
  },
] satisfies ProviderDefinition[];

describe("buildAgentSkillTargets", () => {
  it("uses provider-configured skill directories and excludes unsupported providers", () => {
    const targets = buildAgentSkillTargets({
      providers,
      resolvedSkillDirByProviderId: {
        claude: "/Users/test/.claude/skills",
      },
      mountCountsByProviderId: {
        claude: 2,
      },
      targetHealthByProviderId: {
        claude: { state: "healthy" },
        "review-bot": { state: "unconfigured", error: "No skill directory configured" },
      },
    });

    expect(targets).toEqual([
      expect.objectContaining({
        providerId: "claude",
        skillDir: "/Users/test/.claude/skills",
        mountedSkillCount: 2,
        lastHealthState: "healthy",
      }),
    ]);
  });
});
