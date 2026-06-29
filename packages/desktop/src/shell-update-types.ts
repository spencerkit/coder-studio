export type ShellUpdateAvailability =
  | "unknown"
  | "up_to_date"
  | "update_available"
  | "downloaded"
  | "error";

export type ShellUpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "ready_to_restart"
  | "installing"
  | "failed";

export interface ShellUpdateState {
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  availability: ShellUpdateAvailability;
  status: ShellUpdateStatus;
  lastCheckedAt: number | null;
  errorSummary: string | null;
  releaseNotes: string | null;
}

export function createDefaultShellUpdateState(input: {
  currentVersion: string;
  supported: boolean;
}): ShellUpdateState {
  return {
    supported: input.supported,
    currentVersion: input.currentVersion,
    latestVersion: null,
    availability: "unknown",
    status: "idle",
    lastCheckedAt: null,
    errorSummary: null,
    releaseNotes: null,
  };
}
