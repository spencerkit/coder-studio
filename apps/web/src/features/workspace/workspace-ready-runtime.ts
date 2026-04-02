import type { Tab } from "../../state/workbench-core";

export const READY_TAB_RUNTIME_RECOVERY_DELAYS_MS = [0, 3_000] as const;

export const collectReadyTabRuntimeRecoveryWorkspaceIds = (
  tabs: Array<Pick<Tab, "id" | "status">>,
) => tabs
  .filter((tab) => tab.status === "ready")
  .map((tab) => tab.id)
  .filter(Boolean);
