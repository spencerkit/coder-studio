import type { AgentSkillTargetEntry, ProviderDefinition } from "@coder-studio/core";

interface TargetHealthState {
  state: AgentSkillTargetEntry["lastHealthState"];
  error?: string;
}

export function buildAgentSkillTargets(input: {
  providers: ProviderDefinition[];
  resolvedSkillDirByProviderId: Record<string, string | undefined>;
  mountCountsByProviderId: Record<string, number>;
  targetHealthByProviderId: Record<string, TargetHealthState>;
}): Array<AgentSkillTargetEntry & { mountedSkillCount: number }> {
  return [...input.providers]
    .filter((provider) => provider.supportsSkillsMount === true)
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((provider) => {
      const skillDir = input.resolvedSkillDirByProviderId[provider.id];
      const health = input.targetHealthByProviderId[provider.id] ?? {
        state: "unconfigured" as const,
      };
      return {
        providerId: provider.id,
        displayName: provider.displayName,
        kind: provider.kind,
        skillDir,
        mountPreference: "auto",
        lastHealthState: health.state,
        lastHealthError: health.error,
        mountedSkillCount: input.mountCountsByProviderId[provider.id] ?? 0,
      };
    });
}
