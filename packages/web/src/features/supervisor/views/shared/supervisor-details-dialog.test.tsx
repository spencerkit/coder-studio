import type { Supervisor } from "@coder-studio/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { supervisorDetailsAtom, supervisorDialogAtom, supervisorsAtom } from "../../atoms";
import { SupervisorDetailsDialog } from "./supervisor-details-dialog";

vi.mock("../../../../hooks/use-viewport", () => ({
  useViewport: () => "desktop",
}));

function createSupervisor(): Supervisor {
  return {
    id: "sup-1",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    targetId: "tgt-1",
    state: "idle",
    objective: "Finish the server refactor",
    evaluatorProviderId: "codex",
    maxSupervisionCount: 0,
    completedSupervisionCount: 0,
    currentTargetMemory: {
      schemaVersion: 2,
      targetId: "tgt-1",
      planTree: {
        id: "plan-root",
        title: "Supervisor target",
        objective: "Complete the supervised target",
        deliverable: "Completed target",
        acceptanceCriteria: ["Target objective is complete"],
        status: "in_progress",
        taskType: "generic",
        children: [],
      },
      maxDepth: 6,
      planRevision: 0,
      progressSummary: "Validation in progress",
      stalledCount: 0,
      updatedAt: 1,
    },
    recentTargetCycles: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("SupervisorDetailsDialog", () => {
  it("places edit beside the header close control and removes footer actions", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
    store.set(supervisorDetailsAtom, { open: true, sessionId: "sess-1" });

    render(
      <Provider store={store}>
        <SupervisorDetailsDialog sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    const dialog = screen.getByRole("dialog");
    const header = dialog.querySelector(".dialog-header");
    const headerActions = dialog.querySelector(".supervisor-details-dialog__header-actions");

    expect(header).not.toBeNull();
    expect(headerActions).not.toBeNull();
    expect(headerActions?.contains(screen.getByRole("button", { name: "Edit Supervisor" }))).toBe(
      true
    );
    expect(headerActions?.contains(screen.getByRole("button", { name: "Close" }))).toBe(true);
    expect(dialog.querySelector(".modal-footer")).toBeNull();
    expect(within(dialog).getAllByRole("button", { name: "Edit Supervisor" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Edit Supervisor" }));

    const dialogState = store.get(supervisorDialogAtom);
    expect(dialogState.open).toBe(true);
    expect(dialogState.mode).toBe("edit");
    expect(store.get(supervisorDetailsAtom).open).toBe(false);
  });
});
