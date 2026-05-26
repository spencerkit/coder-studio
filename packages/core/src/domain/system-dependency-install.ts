export const SYSTEM_DEPENDENCY_IDS = ["git", "node"] as const;
export const SYSTEM_DEPENDENCY_INSTALL_OUTPUT_TOPIC_SCOPE = "systemDeps.install" as const;

export type SystemDependencyId = (typeof SYSTEM_DEPENDENCY_IDS)[number];
export type SystemDependencyPackageManager =
  | "brew"
  | "apt-get"
  | "dnf"
  | "yum"
  | "pacman"
  | "zypper";

export function isSystemDependencyId(value: unknown): value is SystemDependencyId {
  return typeof value === "string" && (SYSTEM_DEPENDENCY_IDS as readonly string[]).includes(value);
}

export interface SystemDependencyRuntimeEntry {
  dependencyId: SystemDependencyId;
  available: boolean;
  version?: string;
  autoInstallSupported: boolean;
  installReadiness: "ready" | "unsupported_platform" | "unsupported_package_manager";
  packageManager?: SystemDependencyPackageManager;
  manualGuideKeys: string[];
  docUrl?: string;
}

export interface SystemDependencyRuntimeStatusResponse {
  dependencies: Record<SystemDependencyId, SystemDependencyRuntimeEntry>;
}

export interface SystemDependencyInstallInteraction {
  kind: "none" | "sudo_password" | "confirm";
  promptExcerpt?: string;
  echo: boolean;
}

export interface SystemDependencyInstallStepSnapshot {
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

export interface SystemDependencyInstallFailure {
  code:
    | "unsupported_platform"
    | "unsupported_package_manager"
    | "permission_denied"
    | "user_cancelled"
    | "pty_disconnected"
    | "command_not_found"
    | "command_failed"
    | "verification_failed"
    | "unknown_failure";
  dependencyId: SystemDependencyId;
  failedStepId: string;
  message: string;
  command: string;
  args: string[];
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  packageManager?: SystemDependencyPackageManager;
  manualGuideKeys: string[];
  docUrl?: string;
}

export interface SystemDependencyInstallJobSnapshot {
  jobId: string;
  dependencyId: SystemDependencyId;
  status: "queued" | "running" | "waiting_input" | "succeeded" | "failed" | "cancelled";
  packageManager?: SystemDependencyPackageManager;
  currentStepId?: string;
  steps: SystemDependencyInstallStepSnapshot[];
  interaction: SystemDependencyInstallInteraction;
  failure?: SystemDependencyInstallFailure;
}

export interface SystemDependencyInstallOutputChunk {
  jobId: string;
  chunk: string;
  seq: number;
}
