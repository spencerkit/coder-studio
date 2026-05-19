import { render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { supervisorsAtom } from "../../atoms";
import { SupervisorDetailsContent } from "./supervisor-details-content";

describe("SupervisorDetailsContent", () => {
  const createSupervisor = () => ({
    id: "sup-1",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    targetId: "tgt-1",
    state: "idle" as const,
    objective: "Reduce mobile regression bugs",
    evaluatorProviderId: "claude",
    maxSupervisionCount: 3,
    completedSupervisionCount: 1,
    currentTargetMemory: {
      targetId: "tgt-1",
      decompositionGenerated: true,
      decompositionMode: "stage" as const,
      items: [
        {
          id: "stage-1",
          kind: "stage" as const,
          title: "Audit the mobile sheet layout",
          objective: "Identify spacing issues in the current details flow",
          deliverable: "A concrete list of layout issues",
          acceptanceCriteria: ["Layout issues are captured"],
          status: "done" as const,
        },
        {
          id: "stage-2",
          kind: "stage" as const,
          title: "Refine the details modal structure",
          objective: "Move summary information above the stage list",
          deliverable: "A compact summary block and progress list",
          acceptanceCriteria: ["Summary appears before progress list"],
          status: "in_progress" as const,
        },
        {
          id: "stage-3",
          kind: "stage" as const,
          title: "Verify the updated interaction",
          objective: "Confirm details and edit navigation still works",
          deliverable: "A passing focused test run",
          acceptanceCriteria: ["Focused tests pass"],
          status: "pending" as const,
        },
      ],
      activeItemId: "stage-2",
      progressSummary: "Validation in progress",
      stalledCount: 0,
      updatedAt: 1,
    },
    recentTargetCycles: [
      {
        cycleId: "target-cycle-1",
        targetId: "tgt-1",
        startedAt: 1,
        completedAt: 2,
        result: "continue" as const,
        reason: "Need to finish the validation step.",
      },
    ],
    cycles: [],
    createdAt: 1,
    updatedAt: 1,
  });

  it("renders basic supervisor information above a structured progress list", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));

    render(
      <Provider store={store}>
        <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
      </Provider>
    );

    expect(screen.getByText("Basic Info")).toBeInTheDocument();
    expect(document.querySelector(".supervisor-summary-card")).not.toBeNull();
    expect(screen.getByText("Objective")).toBeInTheDocument();
    expect(screen.getByText("Reduce mobile regression bugs")).toBeInTheDocument();
    expect(screen.getByText("Cycles")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByText("Validation in progress")).toBeInTheDocument();

    expect(screen.getByText("Progress List")).toBeInTheDocument();
    expect(document.querySelector(".supervisor-progress-list--checklist")).not.toBeNull();
    expect(screen.getByText("Audit the mobile sheet layout")).toBeInTheDocument();
    expect(screen.getAllByText("Refine the details modal structure")).toHaveLength(2);
    expect(screen.getByText("Verify the updated interaction")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(screen.getByText("A compact summary block and progress list")).toBeInTheDocument();
    expect(screen.getByText("Need to finish the validation step.")).toBeInTheDocument();
  });
});
