import type { LspServerKind } from "./lsp";
import type { SystemDependencyId } from "./system-dependency-install";

export type DiagnosticsContext =
  | "workspace_open"
  | "session_start"
  | "mobile_continue"
  | "manual_check";

export type DiagnosticsCheckStatus = "checking" | "ready" | "needs_attention";

export type DiagnosticsCheckCode =
  | "workspace_selection_missing"
  | "workspace_path_ready"
  | "workspace_path_not_found"
  | "workspace_path_unreadable"
  | "session_workspace_ready"
  | "session_workspace_missing"
  | "git_ready"
  | "git_missing"
  | "nodejs_ready"
  | "nodejs_missing"
  | "provider_runtime_ready"
  | "provider_cli_missing"
  | "provider_prerequisite_missing"
  | "provider_unknown"
  | "server_auth_ready"
  | "server_auth_not_required"
  | "mobile_host_ready"
  | "mobile_host_local_only"
  | "mobile_auth_disabled";

export interface DiagnosticsRequest {
  context: DiagnosticsContext;
  workspaceId?: string;
  workspacePath?: string;
  targetRuntime?: "native" | "wsl";
  wslDistro?: string;
  providerId?: string;
}

export interface DiagnosticsCheck {
  id: string;
  code: DiagnosticsCheckCode;
  status: DiagnosticsCheckStatus;
  workspaceId?: string;
  workspacePath?: string;
  providerId?: string;
  dependencyId?: SystemDependencyId;
  autoInstallSupported?: boolean;
  installReadiness?:
    | "ready"
    | "missing_prerequisite"
    | "unsupported_platform"
    | "unsupported_package_manager";
  missingCommands?: string[];
  missingPrerequisites?: string[];
  manualGuideKeys?: string[];
  docUrl?: string;
  version?: string;
}

export interface DiagnosticsMetadata {
  authEnabled?: boolean;
  host?: string;
  lspRuntimeContext?: {
    targetRuntime: "native" | "wsl";
    managedInstallSupported: boolean;
  };
  providerId?: string;
  workspaceId?: string;
  workspacePath?: string;
  targetRuntime?: "native" | "wsl";
  wslDistro?: string;
}

export type DiagnosticsLspServiceStatus =
  | "installed"
  | "not_installed"
  | "install_failed"
  | "prerequisite_missing"
  | "runtime_off";

export interface DiagnosticsLspServiceEntry {
  serverKind: LspServerKind;
  displayName: string;
  status: DiagnosticsLspServiceStatus;
  missingCommands?: string[];
  missingPrerequisites?: string[];
}

export interface DiagnosticsResponse {
  context: DiagnosticsContext;
  canContinue: boolean;
  checks: DiagnosticsCheck[];
  lspServices: DiagnosticsLspServiceEntry[];
  metadata: DiagnosticsMetadata;
}
