import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    setMatchMediaMock(
      (query) => query.includes("max-width: 899px") || query.includes("pointer: coarse")
    );
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders the current session supervisor details in the root sheet", () => {
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
            id: "sup-1",
            sessionId: "sess-1",
            workspaceId: "ws-1",
            state: "idle",
            objective: "Reduce mobile regression bugs",
            evaluatorProviderId: "claude",
            cycles: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      ])
    );

    render(
      <Provider store={store}>
        <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
      </Provider>
    );

    const rootActions = document.querySelector(".mobile-supervisor-sheet__actions");
    expect(rootActions).not.toBeNull();

    expect(screen.getByText("Reduce mobile regression bugs")).toBeInTheDocument();
    expect(
      within(rootActions as HTMLElement).getByRole("button", { name: "Edit Objective" })
    ).toBeInTheDocument();
    expect(
      within(rootActions as HTMLElement).getByRole("button", { name: "Disable Supervisor" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Supervisor is not enabled")).not.toBeInTheDocument();
  });

  it("opens the enable flow inside the same sheet without rendering a second overlay", async () => {
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

    const emptyState = screen
      .getByText("Supervisor is not enabled")
      .closest(".mobile-supervisor-sheet__empty");

    expect(emptyState).not.toBeNull();
    expect(emptyState).toHaveTextContent("Supervisor");
    expect(emptyState).toHaveTextContent("Supervisor is not enabled");

    fireEvent.click(screen.getByRole("button", { name: "Enable Objective" }));

    expect(screen.getByLabelText("Objective")).toBeInTheDocument();
    expect(document.querySelectorAll(".mobile-sheet-layer")).toHaveLength(1);
    expect(document.querySelector(".modal-overlay")).toBeNull();

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
        },
        undefined
      );
    });
  });

  it("returns from detail view to the supervisor root when tapping back", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map());
    store.set(supervisorDialogAtom, {
      open: false,
      sessionId: null,
      mode: "enable",
      draftObjective: "",
      draftEvaluatorProviderId: "claude",
    });

    render(
      <Provider store={store}>
        <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable Objective" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText("Supervisor is not enabled")).toBeInTheDocument();
    expect(screen.queryByLabelText("Objective")).not.toBeInTheDocument();
  });

  it("renders mobile text actions with shared button compatibility classes", async () => {
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

    expect(screen.getByRole("button", { name: "Enable Objective" })).toHaveClass(
      "btn",
      "btn-primary"
    );

    await user.click(screen.getByRole("button", { name: "Enable Objective" }));

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

    await user.click(screen.getByRole("button", { name: "Enable Objective" }));
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

    await user.click(screen.getByRole("button", { name: "Enable Objective" }));

    const trigger = screen.getByRole("button", { name: "Evaluator Claude" });
    expect(trigger).toHaveClass("input", "mobile-select-trigger");
    expect(trigger.querySelector(".mobile-select-trigger__value")).not.toBeNull();
    expect(trigger.querySelector(".mobile-select-trigger__icon")).not.toBeNull();
  });
});
