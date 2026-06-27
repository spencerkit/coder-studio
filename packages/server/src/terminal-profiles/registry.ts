import type {
  CustomTerminalProfile,
  TerminalProfile,
  TerminalProfilesListResult,
} from "@coder-studio/core";
import { type DetectedTerminalProfile, detectTerminalProfiles } from "./detect.js";
import { appendWslCwd, formatWslLabel, toExplicitWslCwd } from "./wsl.js";

export interface ResolvedTerminalLaunch {
  profileId: string;
  title: string;
  argv: string[];
  cwd: string;
}

export interface RegistryInput {
  platform?: NodeJS.Platform;
  shellPath?: string;
  configuredDefaultProfileId?: string;
  customProfiles: CustomTerminalProfile[];
  workspacePath?: string;
  detectProfiles?: () => Promise<DetectedTerminalProfile[]>;
}

export async function listTerminalProfiles(
  input: RegistryInput
): Promise<TerminalProfilesListResult> {
  const state = await loadRegistryState(input);

  return {
    profiles: state.profiles,
    configuredDefaultProfileId: input.configuredDefaultProfileId,
    resolvedDefaultProfileId: state.resolvedDefaultProfileId,
  };
}

export async function resolveTerminalLaunch(
  input: RegistryInput & { requestedProfileId?: string }
): Promise<ResolvedTerminalLaunch> {
  if (!input.workspacePath) {
    throw new Error("workspacePath is required for resolveTerminalLaunch");
  }

  const state = await loadRegistryState(input);
  const targetId = input.requestedProfileId ?? state.resolvedDefaultProfileId;

  if (!targetId) {
    throw {
      code: "terminal_profile_unavailable",
      message: "No terminal profiles are available on this machine",
    };
  }

  const profile = state.definitions.get(targetId);
  if (!profile) {
    throw {
      code: "terminal_profile_unavailable",
      message: `Terminal profile unavailable: ${targetId}`,
    };
  }

  if (isCustomProfile(profile)) {
    return {
      profileId: profile.id,
      title: profile.label,
      argv: [profile.command, ...(profile.args ?? [])],
      cwd: input.workspacePath,
    };
  }

  if (profile.cwdRuntime === "wsl") {
    return {
      profileId: profile.id,
      title: getDetectedProfileLabel(profile),
      argv: appendWslCwd(profile.argv, toExplicitWslCwd(input.workspacePath, profile.wslDistro)),
      cwd: input.workspacePath,
    };
  }

  return {
    profileId: profile.id,
    title: getDetectedProfileLabel(profile),
    argv: [...profile.argv],
    cwd: input.workspacePath,
  };
}

interface RegistryState {
  profiles: TerminalProfile[];
  definitions: Map<string, DetectedTerminalProfile | CustomTerminalProfile>;
  resolvedDefaultProfileId: string | null;
}

async function loadRegistryState(input: RegistryInput): Promise<RegistryState> {
  const detected = await loadDetectedProfiles(input);
  const profiles: TerminalProfile[] = [
    ...detected.map(toDto),
    ...input.customProfiles.map(toCustomDto),
  ];

  const definitions = new Map<string, DetectedTerminalProfile | CustomTerminalProfile>();
  for (const profile of detected) {
    definitions.set(profile.id, profile);
  }
  for (const profile of input.customProfiles) {
    definitions.set(profile.id, profile);
  }

  const resolvedDefaultProfileId =
    profiles.find((profile) => profile.id === input.configuredDefaultProfileId)?.id ??
    profiles[0]?.id ??
    null;

  return {
    profiles,
    definitions,
    resolvedDefaultProfileId,
  };
}

async function loadDetectedProfiles(input: RegistryInput): Promise<DetectedTerminalProfile[]> {
  if (input.detectProfiles) {
    return input.detectProfiles();
  }

  return detectTerminalProfiles({
    platform: input.platform,
    shellPath: input.shellPath,
  });
}

function toDto(profile: DetectedTerminalProfile): TerminalProfile {
  return {
    id: profile.id,
    label: getDetectedProfileLabel(profile),
    source: profile.source,
    runtime: profile.runtime,
    icon: profile.icon,
  };
}

function toCustomDto(profile: CustomTerminalProfile): TerminalProfile {
  return {
    id: profile.id,
    label: profile.label,
    source: "custom",
    runtime: "native",
    icon: profile.icon ?? "terminal",
  };
}

function isCustomProfile(
  profile: DetectedTerminalProfile | CustomTerminalProfile
): profile is CustomTerminalProfile {
  return "command" in profile;
}

function getDetectedProfileLabel(profile: DetectedTerminalProfile): string {
  if (profile.runtime !== "wsl") {
    return profile.label;
  }

  return formatWslLabel(profile.wslDistro ?? profile.label);
}
