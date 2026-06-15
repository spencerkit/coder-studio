import type { Supervisor, SupervisorTargetMemory } from "@coder-studio/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { supervisorsAtom } from "../../atoms";
import { SupervisorDetailsContent } from "./supervisor-details-content";

describe("SupervisorDetailsContent", () => {
  type TestSupervisor = Supervisor & { currentTargetMemory: SupervisorTargetMemory };

  const createSupervisor = (): TestSupervisor => ({
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
      schemaVersion: 2,
      targetId: "tgt-1",
      planTree: {
        id: "plan-root",
        title: "Supervisor target",
        objective: "Complete the supervised target",
        deliverable: "Completed target",
        acceptanceCriteria: ["Target objective is complete"],
        status: "in_progress" as const,
        taskType: "generic" as const,
        children: [
          {
            id: "stage-1",
            title: "Audit the mobile sheet layout",
            objective: "Identify spacing issues in the current details flow",
            deliverable: "A concrete list of layout issues",
            acceptanceCriteria: ["Layout issues are captured"],
            status: "done" as const,
            taskType: "design" as const,
            children: [],
          },
          {
            id: "stage-2",
            title: "Refine the details modal structure",
            objective: "Move summary information above the stage list",
            deliverable: "A compact summary block and progress list",
            acceptanceCriteria: ["Summary appears before progress list"],
            status: "in_progress" as const,
            taskType: "coding" as const,
            children: [],
          },
          {
            id: "stage-3",
            title: "Verify the updated interaction",
            objective: "Confirm details and edit navigation still works",
            deliverable: "A passing focused test run",
            acceptanceCriteria: ["Focused tests pass"],
            status: "pending" as const,
            taskType: "coding" as const,
            children: [],
          },
        ],
      },
      maxDepth: 6,
      planRevision: 0,
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
    createdAt: 1,
    updatedAt: 1,
  });

  const supervisorMap = (supervisor: Supervisor = createSupervisor()) =>
    new Map<string, Supervisor>([["sess-1", supervisor]]);

  it("renders basic supervisor information and runtime status alongside the mind map", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, supervisorMap());

    render(
      <Provider store={store}>
        <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
      </Provider>
    );

    expect(screen.queryByText("Basic Info")).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-summary-card")).not.toBeNull();
    expect(document.querySelector(".supervisor-meta-item--objective")).toBeNull();
    expect(screen.queryByText("Objective")).not.toBeInTheDocument();
    expect(screen.getAllByText("Reduce mobile regression bugs").length).toBeGreaterThan(0);
    expect(screen.getByText("Evaluator")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Cycles")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(
      document.querySelector(".supervisor-meta-item--runtime .supervisor-meta-label")
    ).toHaveTextContent("Status");
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Status", level: 3 })).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-details-surface--runtime")).toBeNull();
    expect(screen.queryByText("Target progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Active item")).not.toBeInTheDocument();

    expect(screen.queryByText("Target cycle reasoning")).not.toBeInTheDocument();
    expect(screen.queryByText("Need to finish the validation step.")).not.toBeInTheDocument();
    const mindMap = document.querySelector(".supervisor-mind-map-flow");
    expect(mindMap).not.toBeNull();
    expect(mindMap?.closest(".supervisor-details-section--plan")).not.toBeNull();
    expect(document.querySelector(".supervisor-meta-grid--inline")).not.toBeNull();

    expect(document.querySelector(".supervisor-mind-map-flow")).not.toBeNull();
    expect(document.querySelector(".supervisor-mind-map")).toBeNull();
    expect(document.querySelector(".supervisor-plan-tree")).toBeNull();
    expect(screen.getByRole("treeitem", { name: "Reduce mobile regression bugs" })).toHaveAttribute(
      "data-root-node",
      "true"
    );
    expect(screen.getByText("Audit the mobile sheet layout")).toBeInTheDocument();
    expect(screen.getAllByText("Refine the details modal structure").length).toBeGreaterThan(0);
    expect(screen.getByText("Verify the updated interaction")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getAllByText("Current task").length).toBeGreaterThan(0);
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(screen.getAllByText("A compact summary block and progress list").length).toBeGreaterThan(
      0
    );
  });

  it("exposes operational styling hooks for the redesigned details layout", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, supervisorMap());

    render(
      <Provider store={store}>
        <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
      </Provider>
    );

    expect(document.querySelector(".supervisor-details")).toHaveAttribute(
      "data-runtime-status",
      "idle"
    );
    expect(document.querySelector(".supervisor-summary-card")).toHaveAttribute(
      "data-supervisor-state",
      "idle"
    );
    expect(document.querySelector(".supervisor-details-layout")).toBeNull();
    expect(document.querySelector(".supervisor-details-rail")).toBeNull();
    expect(document.querySelector(".supervisor-details-section--summary")).not.toBeNull();
    expect(document.querySelector(".supervisor-details-section--plan")).not.toBeNull();
    expect(document.querySelector(".supervisor-meta-item--objective")).toBeNull();
    expect(document.querySelector(".supervisor-meta-item--runtime")).not.toBeNull();
    expect(document.querySelector(".supervisor-mind-map-flow__node")).toHaveAttribute(
      "data-plan-status",
      "in_progress"
    );
  });

  it("renders recursive mind map context when planTree is available", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorsAtom,
      supervisorMap({
        ...createSupervisor(),
        currentTargetMemory: {
          ...createSupervisor().currentTargetMemory,
          planTree: {
            id: "root",
            title: "Reduce mobile regression bugs",
            objective: "Complete the supervised target",
            deliverable: "A verified mobile regression reduction",
            acceptanceCriteria: ["Mobile regression risk is reduced"],
            status: "in_progress" as const,
            taskType: "generic" as const,
            children: [
              {
                id: "stage-1",
                title: "Audit current behavior",
                objective: "Identify the risky mobile details behavior",
                deliverable: "A concrete behavior audit",
                acceptanceCriteria: ["Risky behavior is captured"],
                status: "done" as const,
                taskType: "design" as const,
                children: [],
              },
              {
                id: "stage-2",
                title: "Refine details flow",
                objective: "Split the broad details work into executable units",
                deliverable: "A details flow refinement",
                acceptanceCriteria: ["The flow is easier to verify"],
                status: "in_progress" as const,
                taskType: "coding" as const,
                children: [
                  {
                    id: "stage-2-1",
                    title: "Render active leaf path",
                    objective: "Expose the exact current executable branch",
                    deliverable: "A visible active leaf path",
                    acceptanceCriteria: ["The active leaf path is visible"],
                    status: "in_progress" as const,
                    taskType: "coding" as const,
                    children: [],
                    readyCheck: {
                      granularity: "ready" as const,
                      reason: "This leaf is concrete enough to execute.",
                      checkedAt: 3,
                    },
                    execution: {
                      executable: true,
                      guidance: "Update the details panel with active leaf path context.",
                      lastInjectedAt: 4,
                    },
                  },
                ],
              },
            ],
          },
          activeNodeId: "stage-2-1",
        },
      })
    );

    render(
      <Provider store={store}>
        <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
      </Provider>
    );

    expect(screen.getByRole("tree", { name: "Target Details" })).toBeInTheDocument();
    expect(screen.queryByText("Mind Map")).not.toBeInTheDocument();
    expect(screen.queryByText("Active leaf path")).not.toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "Reduce mobile regression bugs" })).toHaveAttribute(
      "data-root-node",
      "true"
    );
    expect(screen.getAllByText("Refine details flow").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Render active leaf path").length).toBeGreaterThan(0);
    expect(screen.getByText("Branch open")).toBeInTheDocument();
    expect(screen.getAllByText("Current task").length).toBeGreaterThan(0);
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Next executable item")).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-next-executable")).toBeNull();
    expect(
      screen.queryByText("Update the details panel with active leaf path context.")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("This leaf is concrete enough to execute.")).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-mind-map-flow")).not.toBeNull();
    expect(document.querySelector(".supervisor-mind-map")).toBeNull();
    expect(document.querySelector(".supervisor-plan-tree")).toBeNull();
    expect(document.querySelector(".supervisor-active-leaf")).toBeNull();
    expect(document.querySelector(".supervisor-active-leaf-path")).toBeNull();
    expect(document.querySelector('[data-active-node="true"]')).not.toBeNull();
    expect(document.querySelector(".supervisor-node-detail")).toBeNull();

    fireEvent.click(screen.getByRole("treeitem", { name: "Render active leaf path" }));

    const nodeDetail = document.querySelector(".supervisor-node-detail");
    const nodeDetailRegion = document.querySelector(".supervisor-details-node-detail-region");
    expect(nodeDetail).not.toBeNull();
    expect(nodeDetailRegion).not.toBeNull();
    expect(nodeDetail?.closest(".supervisor-details-node-detail-region")).toBe(nodeDetailRegion);
    expect(nodeDetail?.querySelector(".supervisor-node-detail__body")?.tagName).toBe("DL");
    expect(nodeDetail?.querySelectorAll(".supervisor-node-detail__item")).toHaveLength(5);
    expect(
      document
        .querySelector(".supervisor-details-section--plan")
        ?.compareDocumentPosition(nodeDetailRegion as Element) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(document.querySelector('[data-selected-node="true"]')).not.toBeNull();
    expect(within(nodeDetail as HTMLElement).getByText("Node detail")).toBeInTheDocument();
    expect(
      within(nodeDetail as HTMLElement).getByText("Render active leaf path")
    ).toBeInTheDocument();
    expect(
      within(nodeDetail as HTMLElement).getByText("Expose the exact current executable branch")
    ).toBeInTheDocument();
    expect(
      within(nodeDetail as HTMLElement).getByText("A visible active leaf path")
    ).toBeInTheDocument();
    expect(within(nodeDetail as HTMLElement).getByText("Acceptance Criteria")).toBeInTheDocument();
    expect(
      within(nodeDetail as HTMLElement).getByText("The active leaf path is visible")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close node detail" }));

    expect(document.querySelector(".supervisor-node-detail")).toBeNull();
  });

  it("keeps nested plan nodes collapsed until the user expands the parent node", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorsAtom,
      supervisorMap({
        ...createSupervisor(),
        currentTargetMemory: {
          ...createSupervisor().currentTargetMemory,
          planTree: {
            id: "root",
            title: "Reduce mobile regression bugs",
            objective: "Complete the supervised target",
            deliverable: "A verified mobile regression reduction",
            acceptanceCriteria: ["Mobile regression risk is reduced"],
            status: "in_progress" as const,
            taskType: "generic" as const,
            children: [
              {
                id: "stage-1",
                title: "Audit current behavior",
                objective: "Identify the risky mobile details behavior",
                deliverable: "A concrete behavior audit",
                acceptanceCriteria: ["Risky behavior is captured"],
                status: "done" as const,
                taskType: "design" as const,
                children: [
                  {
                    id: "stage-1-1",
                    title: "Capture layout notes",
                    objective: "Record the details panel layout notes",
                    deliverable: "Layout notes",
                    acceptanceCriteria: ["Notes are captured"],
                    status: "done" as const,
                    taskType: "writing" as const,
                    children: [],
                  },
                ],
              },
              {
                id: "stage-2",
                title: "Refine details flow",
                objective: "Split the broad details work into executable units",
                deliverable: "A details flow refinement",
                acceptanceCriteria: ["The flow is easier to verify"],
                status: "in_progress" as const,
                taskType: "coding" as const,
                children: [],
              },
            ],
          },
          activeNodeId: "stage-2",
        },
      })
    );

    render(
      <Provider store={store}>
        <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
      </Provider>
    );

    const rootToggle = screen.getByRole("button", {
      name: "Expand Audit current behavior",
    });

    expect(rootToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Audit current behavior")).toBeInTheDocument();
    expect(screen.queryByText("Capture layout notes")).not.toBeInTheDocument();

    fireEvent.click(rootToggle);

    expect(screen.getByRole("button", { name: "Collapse Audit current behavior" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByText("Capture layout notes")).toBeInTheDocument();
  });

  it("expands a node when the node body is clicked", async () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorsAtom,
      supervisorMap({
        ...createSupervisor(),
        currentTargetMemory: {
          ...createSupervisor().currentTargetMemory,
          planTree: {
            id: "root",
            title: "Reduce mobile regression bugs",
            objective: "Complete the supervised target",
            deliverable: "A verified mobile regression reduction",
            acceptanceCriteria: ["Mobile regression risk is reduced"],
            status: "in_progress" as const,
            taskType: "generic" as const,
            children: [
              {
                id: "stage-1",
                title: "Audit current behavior",
                objective: "Identify the risky mobile details behavior",
                deliverable: "A concrete behavior audit",
                acceptanceCriteria: ["Risky behavior is captured"],
                status: "done" as const,
                taskType: "design" as const,
                children: [
                  {
                    id: "stage-1-1",
                    title: "Capture layout notes",
                    objective: "Record the details panel layout notes",
                    deliverable: "Layout notes",
                    acceptanceCriteria: ["Notes are captured"],
                    status: "done" as const,
                    taskType: "writing" as const,
                    children: [],
                  },
                ],
              },
              {
                id: "stage-2",
                title: "Refine details flow",
                objective: "Split the broad details work into executable units",
                deliverable: "A details flow refinement",
                acceptanceCriteria: ["The flow is easier to verify"],
                status: "in_progress" as const,
                taskType: "coding" as const,
                children: [],
              },
            ],
          },
          activeNodeId: "stage-2",
        },
      })
    );

    render(
      <Provider store={store}>
        <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
      </Provider>
    );

    const expandableNode = screen.getByRole("treeitem", { name: "Audit current behavior" });

    expect(expandableNode).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Capture layout notes")).not.toBeInTheDocument();

    fireEvent.click(expandableNode);

    expect(screen.getByRole("treeitem", { name: "Audit current behavior" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByText("Capture layout notes")).toBeInTheDocument();
  });

  it("provides mind map zoom and expand/collapse controls", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, supervisorMap());

    render(
      <Provider store={store}>
        <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
      </Provider>
    );

    expect(screen.getByLabelText("Mind map zoom level")).toHaveTextContent("100%");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByLabelText("Mind map zoom level")).toHaveTextContent("110%");

    fireEvent.click(screen.getByRole("button", { name: "Fit view" }));
    expect(screen.getByLabelText("Mind map zoom level")).toHaveTextContent("100%");

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(screen.getByRole("treeitem", { name: "Reduce mobile regression bugs" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByText("Audit the mobile sheet layout")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));

    expect(screen.getByRole("treeitem", { name: "Reduce mobile regression bugs" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByText("Audit the mobile sheet layout")).toBeInTheDocument();
  });

  it("uses the React Flow viewport for drag and gesture panning instead of a scroll container", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, supervisorMap());

    render(
      <Provider store={store}>
        <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
      </Provider>
    );

    expect(document.querySelector(".supervisor-mind-map-viewport")).toBeNull();
    expect(document.querySelector(".supervisor-mind-map-flow__viewport")).not.toBeNull();
    expect(document.querySelector(".supervisor-mind-map-flow .react-flow__pane")).not.toBeNull();
  });

  it("keeps basic info focused on evaluator, cycles, and runtime status", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, supervisorMap());

    render(
      <Provider store={store}>
        <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
      </Provider>
    );

    const summaryGrid = document.querySelector(".supervisor-summary-card .supervisor-meta-grid");

    expect(summaryGrid).not.toBeNull();
    expect(summaryGrid).toHaveClass("supervisor-meta-grid", "supervisor-meta-grid--inline");
    expect(summaryGrid?.children).toHaveLength(3);
    expect(document.querySelector(".supervisor-meta-item--objective")).toBeNull();
  });

  it("renders the edit button inside the basic info card header instead of a detached footer row", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, supervisorMap());

    render(
      <Provider store={store}>
        <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
      </Provider>
    );

    const editButton = screen.getByRole("button", { name: "Edit Supervisor" });
    const cardHeader = document.querySelector(".supervisor-details-card-header");
    const detachedActions = document.querySelector(".supervisor-details-actions");

    expect(cardHeader).not.toBeNull();
    expect(cardHeader?.contains(editButton)).toBe(true);
    expect(editButton).toHaveClass("btn", "btn-ghost", "btn-sm", "supervisor-details-edit-btn");
    expect(detachedActions).toBeNull();
  });

  it("renders runtime error details without target reasoning", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorsAtom,
      supervisorMap({
        ...createSupervisor(),
        state: "error" as const,
        errorReason: "Evaluator process exited unexpectedly.",
        recentTargetCycles: [
          {
            cycleId: "target-cycle-2",
            targetId: "tgt-1",
            startedAt: 3,
            completedAt: 4,
            result: "error" as const,
            errorReason: "Model call timed out after 600 seconds.",
          },
          {
            cycleId: "target-cycle-1",
            targetId: "tgt-1",
            startedAt: 1,
            completedAt: 2,
            result: "continue" as const,
            reason: "Need one more implementation step",
          },
        ],
      })
    );

    render(
      <Provider store={store}>
        <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
      </Provider>
    );

    expect(
      document.querySelector(".supervisor-meta-item--runtime .supervisor-meta-label")
    ).toHaveTextContent("Status");
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Error reason")).toBeInTheDocument();
    expect(screen.getByText("Model call timed out after 600 seconds.")).toBeInTheDocument();
    const errorSection = document.querySelector(".supervisor-details-section--error");
    expect(errorSection).not.toBeNull();
    expect(errorSection?.querySelector(".supervisor-error")).not.toBeNull();
    expect(document.querySelector(".supervisor-summary-card .supervisor-error")).toBeNull();
    expect(screen.queryByText("Target cycle reasoning")).not.toBeInTheDocument();
    expect(screen.queryByText("Need one more implementation step")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Status", level: 3 })).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-details-surface--runtime")).toBeNull();
    expect(screen.queryByText("Evaluator process exited unexpectedly.")).not.toBeInTheDocument();
  });
});
