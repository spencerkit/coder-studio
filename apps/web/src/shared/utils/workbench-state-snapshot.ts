import {
  createDefaultWorkbenchState,
  type WorkbenchState,
} from "../../state/workbench-core";

let latestWorkbenchStateSnapshot: WorkbenchState = createDefaultWorkbenchState();

export const getWorkbenchStateSnapshot = () => latestWorkbenchStateSnapshot;

export const syncWorkbenchStateSnapshot = (value: WorkbenchState) => {
  latestWorkbenchStateSnapshot = value;
  return value;
};

export const updateWorkbenchStateSnapshot = (
  updater: (current: WorkbenchState) => WorkbenchState,
) => {
  const next = updater(latestWorkbenchStateSnapshot);
  latestWorkbenchStateSnapshot = next;
  return next;
};
