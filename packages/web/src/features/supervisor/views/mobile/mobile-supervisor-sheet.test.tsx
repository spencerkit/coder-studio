import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { supervisorDialogAtom, supervisorsAtom } from "../../atoms";
import { MobileSupervisorSheet } from "./mobile-supervisor-sheet";

function setMatchMediaMock(predicate: (query: string) => boolean) {
  const matchMedia = vi.fn((query: string) => ({
    matches: predicate(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
}

describe("MobileSupervisorSheet", () => {
  let originalMatchMedia: typeof window.matchMedia;

  const createDialogState = (
    overrides: Partial<{
      open: boolean;
      sessionId: string | null;
      mode: "enable" | "edit";
      draftObjective: string;
      draftEvaluatorProviderId: "claude" | "codex";
      draftEvaluatorModel: string;
      draftMaxSupervisionCount: string;
      draftScheduledAt: string;
    }> = {}
  ) => ({
    open: false,
    sessionId: null,
    mode: "enable" as const,
    draftObjective: "",
    draftEvaluatorProviderId: "claude" as const,
    draftEvaluatorModel: "",
    draftMaxSupervisionCount: "0",
    draftScheduledAt: "",
    ...overrides,
  });

  const createSupervisor = () => ({
    id: "sup-1",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    targetId: "tgt-1",
    state: "idle" as const,
    objective: "Reduce mobile regression bugs",
    evaluatorProviderId: "claude",
    maxSupervisionCount: 0,
    completedSupervisionCount: 0,
    currentTargetMemory: {
      targetId: "tgt-1",
      decompositionGenerated: true,
      decompositionMode: "stage" as const,
      items: [
        {
          id: "stage-1",
          kind: "stage" as const,
          title: "Verify the refactor",
          objective: "Confirm the refactor still behaves correctly",
          deliverable: "A passing focused verification run",
          acceptanceCriteria: ["Focused verification passes"],
          status: "in_progress" as const,
        },
      ],
      activeItemId: "stage-1",
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

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    setMatchMediaMock(
      (query) => query.includes("max-width: 899px") || query.includes("pointer: coarse")
    );
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders the current session supervisor details directly", () => {
    const store = createStore();

    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));

    render(
      <Provider store={store}>
        <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
      </Provider>
    );

    expect(
      screen.getByRole("heading", { name: "Supervisor Details", level: 2 })
    ).toBeInTheDocument();
    expect(screen.getByText("Basic Info")).toBeInTheDocument();
    expect(screen.getByText("Runtime Status")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Runtime Status", level: 3 })
    ).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-details-surface--runtime")).toBeNull();
    expect(screen.getByText("Target cycle reasoning")).toBeInTheDocument();
    expect(screen.getByText("Progress List")).toBeInTheDocument();
    expect(screen.getByText("Reduce mobile regression bugs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Supervisor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(document.querySelector(".mobile-supervisor-sheet__actions")).toBeNull();
    expect(document.querySelector(".mobile-supervisor-sheet__root")).toBeNull();
    expect(
      document.querySelector(".mobile-supervisor-sheet.mobile-sheet--fullscreen")
    ).not.toBeNull();
    expect(screen.getByText("Verify the refactor")).toBeInTheDocument();
  });

  it("shows runtime status and the error reason in the mobile details flow", () => {
    const store = createStore();

    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorsAtom,
      new Map([
        [
          "sess-1",
          {
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
            ],
          },
        ],
      ])
    );

    render(
      <Provider store={store}>
        <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
      </Provider>
    );

    expect(screen.getByText("Runtime Status")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Error reason")).toBeInTheDocument();
    expect(screen.getByText("Model call timed out after 600 seconds.")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Runtime Status", level: 3 })
    ).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-details-surface--runtime")).toBeNull();
    expect(screen.queryByText("Target cycle reasoning")).not.toBeInTheDocument();
  });

  it("renders the enable form directly when supervisor is not enabled", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ id: "sup-1" });
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
      </Provider>
    );

    expect(screen.getByLabelText("Objective")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Enable Supervisor", level: 2 })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable Objective" })).not.toBeInTheDocument();
    expect(document.querySelectorAll(".mobile-sheet-layer")).toHaveLength(1);
    expect(document.querySelector(".modal-overlay")).toBeNull();
    expect(
      document.querySelector(".mobile-supervisor-sheet.mobile-sheet--fullscreen")
    ).not.toBeNull();
    expect(document.querySelector(".mobile-supervisor-sheet__detail-header")).toBeNull();

    fireEvent.change(screen.getByLabelText("Objective"), {
      target: { value: "Reduce mobile regression bugs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "supervisor.create",
        {
          sessionId: "sess-1",
          workspaceId: "ws-1",
          objective: "Reduce mobile regression bugs",
          evaluatorProviderId: "claude",
          evaluatorModel: undefined,
          maxSupervisionCount: 0,
          scheduledAt: undefined,
        },
        undefined
      );
    });
  });

  it("returns from edit detail view to the supervisor details when tapping back", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
    store.set(supervisorDialogAtom, createDialogState());

    render(
      <Provider store={store}>
        <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
      </Provider>
    );

    expect(document.querySelector(".mobile-supervisor-sheet__detail-header")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Supervisor Details", level: 2 })
    ).toBeInTheDocument();
    expect(screen.getByText("Basic Info")).toBeInTheDocument();
    expect(screen.getByText("Target cycle reasoning")).toBeInTheDocument();
    expect(screen.getByText("Progress List")).toBeInTheDocument();
    expect(screen.queryByText("Target progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Active item")).not.toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Supervisor" }));

    expect(screen.getByRole("heading", { name: "Edit Supervisor", level: 2 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("heading", { name: "Supervisor Details", level: 2 })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Objective")).not.toBeInTheDocument();
  });

  it("renders mobile text actions with shared button compatibility classes", async () => {
    const store = createStore();

    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("btn", "btn-secondary");
    expect(screen.getByRole("button", { name: "Enable" })).toHaveClass("btn", "btn-primary");
  });

  it("opens the evaluator provider picker inside the mobile supervisor detail flow", async () => {
    const user = userEvent.setup();
    const store = createStore();

    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Evaluator Claude" }));

    expect(document.querySelector(".mobile-inline-sheet .page-header__title")).toHaveTextContent(
      "Evaluator"
    );
    expect(document.querySelector(".mobile-inline-sheet")).toBeTruthy();
    expect(document.querySelectorAll(".mobile-sheet-layer")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Codex" }));

    expect(screen.getByRole("button", { name: "Evaluator Codex" })).toBeInTheDocument();
  });

  it("keeps the migrated evaluator trigger compatibility classes in the mobile detail sheet", async () => {
    const store = createStore();

    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
      </Provider>
    );

    const trigger = screen.getByRole("button", { name: "Evaluator Claude" });
    expect(trigger).toHaveClass("input", "mobile-select-trigger");
    expect(trigger.querySelector(".mobile-select-trigger__value")).not.toBeNull();
    expect(trigger.querySelector(".mobile-select-trigger__icon")).not.toBeNull();
  });

  it("does not render a duplicate detail header card after opening edit mode", () => {
    const store = createStore();

    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));

    render(
      <Provider store={store}>
        <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Supervisor" }));

    expect(document.querySelector(".mobile-supervisor-sheet__detail-header")).toBeNull();
    expect(document.querySelector(".mobile-supervisor-sheet__actions")).toBeNull();
    expect(screen.getByRole("heading", { name: "Edit Supervisor", level: 2 })).toBeInTheDocument();
  });
});
