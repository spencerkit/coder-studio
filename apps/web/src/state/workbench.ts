import { state } from "@relax-state/react";

export * from "./workbench-core.ts";

import {
  createDefaultWorkbenchState,
  type WorkbenchState,
} from "./workbench-core.ts";

export const workbenchState = state<WorkbenchState>({
  ...createDefaultWorkbenchState()
});
