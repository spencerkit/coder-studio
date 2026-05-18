import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { supervisorDialogAtom, supervisorsAtom } from "../atoms";
import { ObjectiveDialog } from "../views/shared/objective-dialog";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

afterEach(() => {
  viewportMocks.viewport = "desktop";
});

describe("ObjectiveDialog", () => {
  const createDialogState = (
    overrides: Partial<{
      open: boolean;
      sessionId: string | null;
      mode: "enable" | "edit" | "disable";
      draftObjective: string;
      draftEvaluatorProviderId: "claude" | "codex";
      draftEvaluatorModel: string;
      draftMaxSupervisionCount: string;
      draftScheduledAt: string;
    }> = {}
  ) => ({
    open: true,
    sessionId: "sess-1",
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
    objective: "Finish the server refactor",
    evaluatorProviderId: "claude",
    maxSupervisionCount: 0,
    completedSupervisionCount: 0,
    recentTargetCycles: [],
    cycles: [],
    createdAt: 1,
    updatedAt: 1,
  });

  it("submits evaluatorProviderId during enable", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      supervisorDialogAtom,
      createDialogState({
        draftObjective: "Finish the server refactor",
        draftEvaluatorProviderId: "codex",
      })
    );
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Evaluator Codex" }));
    await user.click(screen.getByRole("option", { name: "Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "supervisor.create",
        {
          sessionId: "sess-1",
          workspaceId: "ws-1",
          objective: "Finish the server refactor",
          evaluatorProviderId: "claude",
          evaluatorModel: undefined,
          maxSupervisionCount: 0,
          scheduledAt: undefined,
        },
        undefined
      );
    });
  });

  it("blocks submit when maxSupervisionCount is invalid instead of coercing to unlimited", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      supervisorDialogAtom,
      createDialogState({
        draftObjective: "Finish the server refactor",
        draftMaxSupervisionCount: "-1",
      })
    );
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Enable" }));

    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("renders the evaluator field through the shared select trigger with label and helper wiring", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorDialogAtom,
      createDialogState({
        draftObjective: "Ship phase 4B1",
      })
    );
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    const trigger = screen.getByRole("button", { name: "Evaluator Claude" });
    expect(trigger).toHaveClass("input", "mobile-select-trigger");
    expect(trigger).toHaveAccessibleDescription(
      "The provider that evaluates progress and suggests the next step. It can differ from the execution provider."
    );
    expect(trigger.querySelector(".mobile-select-trigger__value")).not.toBeNull();
    expect(trigger.querySelector(".mobile-select-trigger__icon")).not.toBeNull();
  });

  it("renders the migrated shared textarea for the objective field", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorDialogAtom,
      createDialogState({
        draftObjective: "Ship phase 4B1",
      })
    );
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByRole("textbox", { name: "Objective" })).toHaveClass("input", "textarea");
  });

  it("renders disable confirmation mode", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorDialogAtom,
      createDialogState({
        mode: "disable",
      })
    );
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByText("Disabling stops evaluation cycles")).toBeInTheDocument();
    expect(screen.getByText("Finish the server refactor")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveClass("supervisor-dialog--disable");
  });

  it("renders the dialog header through the canonical dialog header anatomy", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorDialogAtom,
      createDialogState({
        mode: "disable",
      })
    );
    store.set(supervisorsAtom, new Map([["sess-1", createSupervisor()]]));

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    const dialog = screen.getByRole("dialog");
    const header = dialog.querySelector(".dialog-header");
    const leading = header?.querySelector(".dialog-header__leading");
    const icon = header?.querySelector(".dialog-header__icon");
    const copy = header?.querySelector(".dialog-header__copy");
    const description = header?.querySelector(".dialog-header__description");
    const closeButton = screen.getByRole("button", { name: "Close" });

    expect(header).not.toBeNull();
    expect(leading).not.toBeNull();
    expect(icon).not.toBeNull();
    expect(copy).not.toBeNull();
    expect(description).toHaveTextContent(
      "Stop automatic evaluation. The current session's supervision cycles will be removed."
    );
    expect(closeButton).toHaveClass("modal-close");
  });

  it("renders footer actions with shared button compatibility classes", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorDialogAtom,
      createDialogState({
        mode: "disable",
      })
    );
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("btn", "btn-secondary");
    expect(screen.getByRole("button", { name: "Disable" })).toHaveClass("btn", "btn-danger");
  });

  it("renders the close action with icon button compatibility classes", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorDialogAtom,
      createDialogState({
        mode: "disable",
      })
    );
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("btn", "btn-ghost", "btn-sm");
  });

  it("renders a dialog role on desktop", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorDialogAtom,
      createDialogState({
        draftObjective: "Ship phase 4B1",
      })
    );
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the centered modal shell on desktop viewports", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorDialogAtom,
      createDialogState({
        draftObjective: "Ship phase 4B1",
      })
    );
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    expect(document.querySelector(".modal-overlay")).toBeTruthy();
  });

  it("renders nothing on mobile because mobile supervisor detail owns the flow", () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      supervisorDialogAtom,
      createDialogState({
        draftObjective: "Ship phase 4B1",
      })
    );
    store.set(supervisorsAtom, new Map());

    const { container } = render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" sessionId="sess-1" />
      </Provider>
    );

    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector(".modal-overlay")).toBeNull();
  });

  it("uses the shared select listbox on desktop when changing evaluator provider", async () => {
    const user = userEvent.setup();
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorDialogAtom, {
      open: true,
      sessionId: "sess-1",
      mode: "enable",
      draftObjective: "Ship phase 4B1",
      draftEvaluatorProviderId: "claude",
    });
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Evaluator Claude" }));

    const listbox = screen.getByRole("listbox", { name: "Evaluator" });
    expect(within(listbox).getByRole("option", { name: "Claude" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await user.click(within(listbox).getByRole("option", { name: "Codex" }));

    expect(screen.getByRole("button", { name: "Evaluator Codex" })).toBeInTheDocument();
  });
});
