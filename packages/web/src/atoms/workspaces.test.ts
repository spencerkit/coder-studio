import type { Workspace } from "@coder-studio/core";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import {
  activeWorkspaceAtom,
  activeWorkspaceIdAtom,
  resolvedActiveWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "./workspaces";

function createWorkspace(id: string): Workspace {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    targetRuntime: "native",
    openedAt: 1,
    lastActiveAt: 1,
    uiState: {
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
    },
  };
}

describe("workspace state atoms", () => {
  it("falls back to the first ordered workspace when the intent id is missing", () => {
    const store = createStore();
    const ws1 = createWorkspace("ws-1");
    const ws2 = createWorkspace("ws-2");

    store.set(workspacesAtom, {
      [ws1.id]: ws1,
      [ws2.id]: ws2,
    });
    store.set(workspaceOrderAtom, [ws2.id, ws1.id]);
    store.set(workspacesLoadStateAtom, "ready");
    store.set(activeWorkspaceIdAtom, "missing");

    expect(store.get(resolvedActiveWorkspaceIdAtom)).toBe("ws-2");
    expect(store.get(activeWorkspaceAtom)?.id).toBe("ws-2");
  });

  it("returns null before the workspace load state becomes ready", () => {
    const store = createStore();
    const ws1 = createWorkspace("ws-1");

    store.set(workspacesAtom, {
      [ws1.id]: ws1,
    });
    store.set(workspaceOrderAtom, [ws1.id]);
    store.set(workspacesLoadStateAtom, "loading");
    store.set(activeWorkspaceIdAtom, ws1.id);

    expect(store.get(resolvedActiveWorkspaceIdAtom)).toBeNull();
    expect(store.get(activeWorkspaceAtom)).toBeNull();
  });
});
