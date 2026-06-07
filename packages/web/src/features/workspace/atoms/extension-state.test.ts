import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import {
  setWorkspaceExtensionStateAtom,
  workspaceExtensionStateAtomFamily,
  workspaceExtensionStateLogsAtomFamily,
  workspaceExtensionStateProgressAtomFamily,
  workspaceExtensionStateQuickActionsAtomFamily,
  workspaceExtensionStateStatusPillsAtomFamily,
} from "./extension-state";

describe("workspace extension-state atoms", () => {
  it("returns an empty extension state per workspace by default", () => {
    const store = createStore();

    expect(store.get(workspaceExtensionStateAtomFamily("ws-1"))).toMatchObject({
      workspaceId: "ws-1",
      statusPills: [],
      progress: [],
      logs: [],
      quickActions: [],
    });
  });

  it("stores extension-state snapshots independently by workspace id", () => {
    const store = createStore();

    store.set(setWorkspaceExtensionStateAtom, {
      workspaceId: "ws-1",
      statusPills: [
        {
          key: "ci",
          label: "CI running",
          state: "running",
          detail: "unit tests",
          updatedAt: 100,
        },
      ],
      progress: [
        {
          key: "tests",
          label: "Tests",
          value: 4,
          max: 10,
          detail: "4/10",
          updatedAt: 101,
        },
      ],
      logs: [
        {
          key: "ci",
          level: "info",
          message: "Unit tests started",
          timestamp: 102,
        },
      ],
      quickActions: [
        {
          id: "rerun-tests",
          label: "Rerun tests",
          command: "extension.quickAction.run",
          description: "Run the current test command again",
        },
      ],
      updatedAt: 103,
    });

    expect(store.get(workspaceExtensionStateStatusPillsAtomFamily("ws-1"))).toHaveLength(1);
    expect(store.get(workspaceExtensionStateProgressAtomFamily("ws-1"))).toHaveLength(1);
    expect(store.get(workspaceExtensionStateLogsAtomFamily("ws-1"))).toHaveLength(1);
    expect(store.get(workspaceExtensionStateQuickActionsAtomFamily("ws-1"))).toHaveLength(1);
    expect(store.get(workspaceExtensionStateAtomFamily("ws-2")).statusPills).toEqual([]);
  });
});
