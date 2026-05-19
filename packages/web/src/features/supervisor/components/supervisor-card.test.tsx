import type { Supervisor, SupervisorCycle } from "@coder-studio/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { supervisorCyclesAtom, supervisorsAtom } from "../atoms";
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
      planGenerated: true,
      plan: [{ id: "step-1", title: "Verify the refactor", status: "in_progress" }],
      activeStepId: "step-1",
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

  it("shows the latest cycle history and trigger action", () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
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

    expect(screen.getByText("Persistence and hydration are done.")).toBeInTheDocument();
    expect(screen.getByText("Finish the server refactor")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.queryByText("Verify the refactor")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /collapse/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Target memory")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan ready")).not.toBeInTheDocument();
    expect(screen.queryByText("Validation in progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Need to finish the validation step.")).not.toBeInTheDocument();
    expect(screen.queryByText("65%")).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-progress-track")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trigger Evaluation" }));
    expect(sendCommand).toHaveBeenCalledWith("supervisor.trigger", { id: "sup-1" }, undefined);
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
    expect(screen.getByText("Supervisor 暂时无法判断下一步，已停止自动监督。")).toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "Edit Supervisor" })).toHaveClass(
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
    expect(screen.getByRole("button", { name: "Disable" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "supervisor-icon-btn",
      "supervisor-icon-btn-danger"
    );
    expect(
      screen
        .getByRole("button", { name: "Edit Supervisor" })
        .querySelector('[data-icon-semantic="supervisor.mode.edit"]')
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
    expect(
      screen
        .getByRole("button", { name: "Disable" })
        .querySelector('[data-icon-semantic="supervisor.mode.disable"]')
    ).toBeTruthy();
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

  it("uses the shared tooltip for the supervisor objective text", () => {
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

    const objective = screen.getByText("Finish the server refactor");
    expect(objective).not.toHaveAttribute("title");

    fireEvent.mouseEnter(objective);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Finish the server refactor");
    expect(objective).toHaveAttribute("aria-describedby", tooltip.getAttribute("id") ?? "");
  });

  it('shows "No guidance injected this cycle" for a completed cycle with no result and no errorReason', () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
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

    expect(screen.getByText("No guidance injected this cycle")).toBeInTheDocument();
    expect(screen.queryByText("65%")).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-progress-track")).not.toBeInTheDocument();
  });

  it("shows retry attempt details for an in-flight supervisor cycle", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-16T12:00:00Z"));
      const store = createStore();
      window.localStorage.setItem("ui.locale", JSON.stringify("en"));
      store.set(localeAtom, "en");
      store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
      store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));
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

      expect(
        screen.getByText(/Retrying evaluator in 1s \(1\/3\): rate limited/)
      ).toBeInTheDocument();

      act(() => {
        vi.setSystemTime(new Date("2026-05-16T12:00:01Z"));
        vi.advanceTimersByTime(1000);
      });

      expect(
        screen.getByText(/Retrying evaluator in 0s \(1\/3\): rate limited/)
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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

  it("renders stopped reason and scheduled cancelled cycle details", () => {
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
    expect(screen.getByText("SCHEDULED")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(
      screen.getByText("Objective complete. Supervisor stopped automatically.")
    ).toBeInTheDocument();
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
    expect(screen.getByText("Finish the server refactor")).toBeInTheDocument();
  });
});
