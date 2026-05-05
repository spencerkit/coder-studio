import type { Workspace } from "@coder-studio/core";
import type { Store } from "jotai";
import { workspaceOrderAtom, workspacesAtom, workspacesLoadStateAtom } from "../atoms/workspaces";

export function seedReadyWorkspaceState(store: Store, workspaces: Record<string, Workspace>): void {
  store.set(workspacesAtom, workspaces);
  store.set(workspaceOrderAtom, Object.keys(workspaces));
  store.set(workspacesLoadStateAtom, "ready");
}
