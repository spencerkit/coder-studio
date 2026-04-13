import { state } from "@relax-state/react";

export * from "./workbench-core";

import {
  createDefaultWorkbenchState,
  type WorkbenchState,
} from "./workbench-core";

export const workbenchState = state<WorkbenchState>({
  ...createDefaultWorkbenchState()
});
