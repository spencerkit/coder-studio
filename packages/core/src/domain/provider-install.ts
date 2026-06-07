import type {
  ProviderCapabilityDescriptor,
  ProviderKind,
  ProviderStability,
} from "../provider/definition";

export interface ProviderInstallDocUrls {
  provider: string;
  prerequisites: Partial<Record<string, string>>;
}

export interface ProviderRuntimeStatusEntry {
  providerId: string;
  displayName: string;
  badge: string;
  kind: ProviderKind;
  stability?: ProviderStability;
  supportsAgentInstructions?: boolean;
  supportsAgentInstructionsGeneration?: boolean;
  supportsSkillsMount?: boolean;
  capability: "full" | "limited" | "unsupported";
  capabilities: ProviderCapabilityDescriptor[];
  requiredCommands: string[];
  available: boolean;
  missingCommands: string[];
  missingPrerequisites: string[];
  autoInstallSupported: boolean;
  installReadiness: "ready" | "missing_prerequisite" | "unsupported_platform";
  manualGuideKeys: string[];
  docUrls: ProviderInstallDocUrls;
}

export interface ProviderRuntimeStatusResponse {
  providers: Record<string, ProviderRuntimeStatusEntry>;
}

export interface ProviderInstallStepSnapshot {
  id: string;
  titleKey: string;
  kind: "check" | "install" | "verify";
  command: string;
  args: string[];
  status: "pending" | "running" | "succeeded" | "failed";
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
}

export interface ProviderInstallFailure {
  code:
    | "missing_prerequisite"
    | "unsupported_platform"
    | "permission_denied"
    | "command_not_found"
    | "command_failed"
    | "verification_failed"
    | "unknown_failure";
  providerId: string;
  failedStepId: string;
  message: string;
  command: string;
  args: string[];
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  missingCommands: string[];
  manualGuideKeys: string[];
  docUrls: ProviderInstallDocUrls;
}

export interface ProviderInstallJobSnapshot {
  jobId: string;
  providerId: string;
  strategyIds: string[];
  status: "queued" | "running" | "succeeded" | "failed";
  currentStepId?: string;
  steps: ProviderInstallStepSnapshot[];
  failure?: ProviderInstallFailure;
}
