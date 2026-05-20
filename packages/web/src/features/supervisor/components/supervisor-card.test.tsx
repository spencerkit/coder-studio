import type { Supervisor, SupervisorCycle } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { supervisorCyclesAtom, supervisorDialogAtom, supervisorsAtom } from "../atoms";
import { SupervisorCard } from "../views/shared/supervisor-card";

describe("SupervisorCard", () => {
  const createSupervisor = (): Supervisor => ({
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
      targetId: "tgt-1",
      decompositionGenerated: true,
      decompositionMode: "stage",
      items: [
        {
          id: "stage-1",
          kind: "stage",
          title: "Verify the refactor",
          objective: "Confirm the refactor still behaves correctly",
          deliverable: "A passing focused verification run",
          acceptanceCriteria: ["Focused verification passes"],
          status: "in_progress",
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
        result: "continue",
        reason: "Need to finish the validation step.",
      },
    ],
    cycles: [],
    createdAt: 1,
    updatedAt: 1,
  });

  const createCycle = (overrides?: Partial<SupervisorCycle>): SupervisorCycle => ({
    id: "cycle-1",
    supervisorId: "sup-1",
    sessionId: "sess-1",
    status: "completed",
    trigger: "manual",
    evidenceSource: "transcript",
    objective: "Finish the server refactor",
    evaluatorProviderId: "codex",
    progress: 65,
    createdAt: 1,
    completedAt: 2,
    ...overrides,
  });

  it("shows a unified Supervisor label for the inactive enable button", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map());
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    const button = screen.getByRole("button", { name: "Enable Supervisor" });
    expect(button).toHaveTextContent("Supervisor");
    expect(button.querySelector('[data-icon-semantic="supervisor.entry"]')).toBeTruthy();
  });

  it("opens the enable dialog from the inactive supervisor button", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map());
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable Supervisor" }));

    expect(
      screen.getByRole("heading", { name: "Enable Supervisor", level: 2 })
    ).toBeInTheDocument();
    expect(store.get(supervisorDialogAtom).open).toBe(true);
    expect(store.get(supervisorDialogAtom).mode).toBe("enable");
  });

  it("shows cycle count inside the strip row without inline objective or error details", () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      supervisorsAtom,
      new Map([["sess-1", { ...createSupervisor(), completedSupervisionCount: 3 }]])
    );
    store.set(
      supervisorCyclesAtom,
      new Map([
        [
          "sup-1",
          [
            createCycle({
              result: "Persistence and hydration are done.",
            }),
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    const titleRow = document.querySelector(".supervisor-strip-eyebrow");
    const stripRow = document.querySelector(".supervisor-strip-row");
    const statusCluster = document.querySelector(".supervisor-status-cluster");

    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("Cycles 3")).toBeInTheDocument();
    expect(screen.queryByText("Finish the server refactor")).not.toBeInTheDocument();
    expect(titleRow).not.toBeNull();
    expect(stripRow).not.toBeNull();
    expect(statusCluster).not.toBeNull();
    expect(titleRow?.querySelector(".supervisor-provider-pill")).toHaveTextContent("codex");
    expect(stripRow?.querySelector(".supervisor-objective-row")).toBeNull();
    expect(statusCluster?.querySelector(".supervisor-state-tag")).toHaveTextContent("Idle");
    expect(statusCluster?.querySelector(".supervisor-cycle-count")).toHaveTextContent("Cycles 3");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Latest evaluation")).not.toBeInTheDocument();
    expect(screen.queryByText("Persistence and hydration are done.")).not.toBeInTheDocument();
    expect(screen.queryByText("Verify the refactor")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /collapse/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Target memory")).not.toBeInTheDocument();
    expect(screen.queryByText("Decomposition ready")).not.toBeInTheDocument();
    expect(screen.queryByText("Stages")).not.toBeInTheDocument();
    expect(screen.queryByText("Validation in progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Need to finish the validation step.")).not.toBeInTheDocument();
    expect(screen.queryByText("65%")).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-progress-track")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trigger Evaluation" }));
    expect(sendCommand).toHaveBeenCalledWith("supervisor.trigger", { id: "sup-1" }, undefined);
  });

  it("opens details from the primary supervisor action and exposes edit from details", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Supervisor Details" }));

    expect(
      screen.getByRole("heading", { name: "Supervisor Details", level: 2 })
    ).toBeInTheDocument();
    expect(screen.getByText("Basic Info")).toBeInTheDocument();
    expect(screen.getByText("Target cycle reasoning")).toBeInTheDocument();
    expect(screen.getByText("Progress List")).toBeInTheDocument();
    expect(screen.queryByText("Target progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Active item")).not.toBeInTheDocument();
    expect(screen.getByText("Need to finish the validation step.")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Supervisor" }));

    const dialogState = store.get(supervisorDialogAtom);
    expect(dialogState.open).toBe(true);
    expect(dialogState.mode).toBe("edit");
    expect(screen.getByRole("heading", { name: "Edit Supervisor", level: 2 })).toBeInTheDocument();
  });

  it("returns to supervisor details when cancelling from edit mode", async () => {
    const user = userEvent.setup();
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Supervisor Details" }));
    await user.click(screen.getByRole("button", { name: "Edit Supervisor" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("heading", { name: "Supervisor Details", level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Edit Supervisor", level: 2 })
    ).not.toBeInTheDocument();
  });

  it("returns to supervisor details after restoring from edit mode", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "supervisor.listRecoverableTargets") {
        return {
          targets: [
            {
              targetId: "tgt-restore",
              sessionId: "sess-old",
              workspaceId: "ws-1",
              objective: "Recovered supervisor objective",
              status: "active",
              updatedAt: 1_746_000_000_000,
              progressSummary: "Recovered verification state",
              cycleCount: 4,
            },
          ],
        };
      }

      if (op === "supervisor.restore") {
        return {
          supervisor: {
            ...createSupervisor(),
            objective: "Recovered supervisor objective",
            completedSupervisionCount: 4,
          },
        };
      }

      return undefined;
    });
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Supervisor Details" }));
    await user.click(screen.getByRole("button", { name: "Edit Supervisor" }));
    await user.click(screen.getByRole("button", { name: "Restore from Existing Memory" }));
    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "supervisor.listRecoverableTargets",
        { workspaceId: "ws-1" },
        undefined
      );
    });

    await user.click(screen.getByRole("radio", { name: /Recovered supervisor objective/i }));
    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "supervisor.restore",
        expect.objectContaining({
          sessionId: "sess-1",
          workspaceId: "ws-1",
          sourceTargetId: "tgt-restore",
        }),
        undefined
      );
    });

    expect(
      screen.getByRole("heading", { name: "Supervisor Details", level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Edit Supervisor", level: 2 })
    ).not.toBeInTheDocument();
  });

  it("localizes stop reasons in Chinese", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("zh"));
    store.set(localeAtom, "zh");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorsAtom,
      new Map([
        [
          "sess-1",
          {
            ...createSupervisor(),
            state: "stopped",
            stopReason: "supervisor_uncertain",
            recentTargetCycles: [
              {
                cycleId: "target-cycle-1",
                targetId: "tgt-1",
                startedAt: 1,
                completedAt: 2,
                result: "stop",
                reason: "需要先确认下一步。",
              },
            ],
          },
        ],
      ])
    );
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: /展开/i })).not.toBeInTheDocument();
    expect(screen.queryByText("目标记忆")).not.toBeInTheDocument();
    expect(screen.getByText("轮次 0")).toBeInTheDocument();
    expect(
      screen.queryByText("Supervisor 暂时无法判断下一步，已停止自动监督。")
    ).not.toBeInTheDocument();
  });

  it("uses shared IconButton compatibility classes for supervisor icon actions", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Supervisor Details" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "supervisor-icon-btn"
    );
    expect(screen.getByRole("button", { name: "Pause" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "supervisor-icon-btn"
    );
    expect(screen.getByRole("button", { name: "Trigger Evaluation" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "supervisor-icon-btn"
    );
    expect(
      screen
        .getByRole("button", { name: "Supervisor Details" })
        .querySelector('[data-icon-semantic="supervisor.action.details"]')
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Pause" })
        .querySelector('[data-icon-semantic="supervisor.action.pause"]')
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Trigger Evaluation" })
        .querySelector('[data-icon-semantic="supervisor.action.trigger"]')
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
  });

  it("renders the resume semantic when the supervisor is paused", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map([["sess-1", { ...createSupervisor(), state: "paused" }]]));
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(
      screen
        .getByRole("button", { name: "Resume" })
        .querySelector('[data-icon-semantic="supervisor.action.resume"]')
    ).toBeTruthy();
  });

  it("hides completed cycle guidance text", () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      supervisorsAtom,
      new Map([["sess-1", { ...createSupervisor(), completedSupervisionCount: 1 }]])
    );
    store.set(
      supervisorCyclesAtom,
      new Map([
        [
          "sup-1",
          [
            createCycle({
              result: undefined,
            }),
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByText("Cycles 1")).toBeInTheDocument();
    expect(screen.queryByText("No guidance injected this cycle")).not.toBeInTheDocument();
    expect(screen.queryByText("65%")).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-progress-track")).not.toBeInTheDocument();
  });

  it("hides in-flight retry details", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorsAtom,
      new Map([["sess-1", { ...createSupervisor(), completedSupervisionCount: 1 }]])
    );
    store.set(
      supervisorCyclesAtom,
      new Map([
        [
          "sup-1",
          [
            createCycle({
              status: "evaluating",
              completedAt: undefined,
              runtime: {
                phase: "retry_wait",
                currentAttemptIndex: 0,
                attemptCount: 1,
                maxAttempts: 3,
                lastAttemptError: "rate limited",
                nextRetryAt: Date.now() + 1000,
              },
            }),
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByText("Cycles 1")).toBeInTheDocument();
    expect(
      screen.queryByText(/Retrying evaluator in 1s \(1\/3\): rate limited/)
    ).not.toBeInTheDocument();
  });

  it("keeps pause available while the supervisor is evaluating", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorsAtom,
      new Map([["sess-1", { ...createSupervisor(), state: "evaluating" }]])
    );
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Pause" })).not.toBeDisabled();
  });

  it("keeps manual trigger disabled while an older cycle is still evaluating", () => {
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
            state: "idle",
            objective: "Finish the follow-up refactor",
          },
        ],
      ])
    );
    store.set(
      supervisorCyclesAtom,
      new Map([
        [
          "sup-1",
          [
            createCycle({
              status: "evaluating",
              objective: "Finish the original refactor",
              completedAt: undefined,
            }),
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Trigger Evaluation" })).toBeDisabled();
  });

  it("keeps execution policy metadata hidden", () => {
    const store = createStore();
    const scheduledAt = Date.UTC(2026, 4, 11, 3, 0);
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
            evaluatorModel: "o3",
            maxSupervisionCount: 5,
            scheduledAt,
          },
        ],
      ])
    );
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Evaluator Model")).not.toBeInTheDocument();
    expect(screen.queryByText("o3")).not.toBeInTheDocument();
    expect(screen.queryByText("Max Supervision Count")).not.toBeInTheDocument();
    expect(screen.queryByText("5")).not.toBeInTheDocument();
    expect(screen.queryByText("Scheduled Run Time")).not.toBeInTheDocument();
  });

  it("keeps max supervision count hidden when the limit is disabled", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Max Supervision Count")).not.toBeInTheDocument();
    expect(screen.queryByText("No cap")).not.toBeInTheDocument();
  });

  it("renders stopped reason without cycle detail history", () => {
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
            state: "stopped",
            stopReason: "objective_complete",
            completedSupervisionCount: 2,
          },
        ],
      ])
    );
    store.set(
      supervisorCyclesAtom,
      new Map([
        [
          "sup-1",
          [
            createCycle({
              status: "cancelled",
              trigger: "scheduled",
              completedAt: 3,
            }),
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByText("Stopped")).toHaveClass("supervisor-state-stopped");
    expect(screen.getByText("Cycles 2")).toBeInTheDocument();
    expect(screen.queryByText("SCHEDULED")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Objective complete. Supervisor stopped automatically.")
    ).not.toBeInTheDocument();
  });

  it("does not expose a default details state for preview surfaces", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
    store.set(supervisorCyclesAtom, new Map());

    render(
      <Provider store={store}>
        <SupervisorCard sessionId="sess-1" workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Finish the server refactor")).not.toBeInTheDocument();
  });
});
