import type { Tab } from "../../state/workbench-core";

export const ROUTE_RUNTIME_ATTACH_RECOVERY_DELAYS_MS = [0, 1_000, 3_000, 7_000] as const;

export const shouldAttachRouteRuntimeForExistingTab = (
  existingTab: Pick<Tab, "status"> | null | undefined,
) => existingTab?.status !== "ready";
