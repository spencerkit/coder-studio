import type { UpdateActivitySummary, UpdateCheckIntervalSec } from "./update";

export type UpdateAuthority = "desktop" | "cli" | "none";
export type UpdateEnvironment =
  | "desktop-native"
  | "desktop-wsl"
  | "cli-global-npm"
  | "cli-unsupported"
  | "desktop-managed";

export interface UpdateRuntimeContext {
  environment: UpdateEnvironment;
  authority: UpdateAuthority;
  supported: boolean;
  unsupportedReason: string | null;
}

export type ProductUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "succeeded"
  | "failed"
  | "manual_required"
  | "unsupported";

export type UpdateComponentId = "shell" | "runtime:win32-x64" | "runtime:linux-x64" | "cli";
export type UpdateComponentKind = "shell" | "runtime" | "cli";

export interface ProductUpdateComponent {
  id: UpdateComponentId;
  kind: UpdateComponentKind;
  target: "win32-x64" | "linux-x64" | null;
  currentVersion: string;
  currentPublishedAt: string | null;
  targetVersion: string | null;
  targetPublishedAt: string | null;
  status: ProductUpdateStatus;
  progressPercent: number | null;
  downloaded: boolean;
  verified: boolean;
  errorSummary: string | null;
}

export interface UpdateCompatibilityResult {
  compatible: boolean;
  code: string | null;
  summary: string | null;
}

export interface ProductUpdateDiagnostics {
  failedComponentId: UpdateComponentId | null;
  failedPhase: string | null;
  shellVersion: string | null;
  shellPublishedAt: string | null;
  shellBuiltAt: string | null;
  engineVersion: string | null;
  nodeVersion: string | null;
  runtimeHostApiVersion: number | null;
  apiProtocolVersion: number | null;
  dataSchemaVersion: number | null;
  logLocations: string[];
  recoveryAction: string | null;
}

export interface ProductUpdateState {
  schemaVersion: 1;
  runtimeContext: UpdateRuntimeContext;
  status: ProductUpdateStatus;
  productVersion: string;
  productPublishedAt: string | null;
  planId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastCheckedAt: number | null;
  components: ProductUpdateComponent[];
  compatibility: UpdateCompatibilityResult;
  diagnostics: ProductUpdateDiagnostics;
  restartRequired: boolean;
  requiresManualStep: boolean;
  manualCommand: string | null;
  errorSummary: string | null;
}

export interface DesktopUpdateSettings {
  schemaVersion: 1;
  autoCheckEnabled: boolean;
  checkIntervalSec: UpdateCheckIntervalSec;
}

export interface ProductUpdatePreparation {
  state: ProductUpdateState;
  activity: UpdateActivitySummary;
  canProceed: boolean;
}

export function createDefaultDesktopUpdateSettings(): DesktopUpdateSettings {
  return { schemaVersion: 1, autoCheckEnabled: true, checkIntervalSec: 21600 };
}

export function createDefaultProductUpdateState(
  runtimeContext: UpdateRuntimeContext,
  productVersion: string,
  productPublishedAt: string | null
): ProductUpdateState {
  return {
    schemaVersion: 1,
    runtimeContext,
    status: runtimeContext.supported ? "idle" : "unsupported",
    productVersion,
    productPublishedAt,
    planId: null,
    createdAt: null,
    updatedAt: null,
    lastCheckedAt: null,
    components: [],
    compatibility: { compatible: true, code: null, summary: null },
    diagnostics: {
      failedComponentId: null,
      failedPhase: null,
      shellVersion: null,
      shellPublishedAt: null,
      shellBuiltAt: null,
      engineVersion: null,
      nodeVersion: null,
      runtimeHostApiVersion: null,
      apiProtocolVersion: null,
      dataSchemaVersion: null,
      logLocations: [],
      recoveryAction: null,
    },
    restartRequired: false,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
  };
}
