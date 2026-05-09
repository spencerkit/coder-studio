import type { Supervisor, SupervisorCycle } from "@coder-studio/core";
import { fireEvent, render, screen } from "@testing-library/react";
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
    state: "idle",
    objective: "Finish the server refactor",
    evaluatorProviderId: "codex",
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
    expect(screen.queryByText("65%")).not.toBeInTheDocument();
    expect(document.querySelector(".supervisor-progress-track")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trigger Evaluation" }));
    expect(sendCommand).toHaveBeenCalledWith("supervisor.trigger", { id: "sup-1" }, undefined);
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

    expect(screen.getByRole("button", { name: "Edit Objective" })).toHaveClass(
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
    expect(screen.getByRole("button", { name: "Disable Supervisor" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "supervisor-icon-btn",
      "supervisor-icon-btn-danger"
    );
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
});
