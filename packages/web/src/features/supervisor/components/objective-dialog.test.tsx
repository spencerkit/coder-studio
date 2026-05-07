import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("submits evaluatorProviderId during enable", async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(supervisorDialogAtom, {
      open: true,
      sessionId: "sess-1",
      mode: "enable",
      draftObjective: "Finish the server refactor",
      draftEvaluatorProviderId: "codex",
    });
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    fireEvent.change(screen.getByLabelText("Evaluator"), {
      target: { value: "claude" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "supervisor.create",
        {
          sessionId: "sess-1",
          workspaceId: "ws-1",
          objective: "Finish the server refactor",
          evaluatorProviderId: "claude",
        },
        undefined
      );
    });
  });

  it("renders the migrated shared textarea for the objective field", () => {
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

    expect(screen.getByRole("textbox", { name: "Objective" })).toHaveClass("input", "textarea");
  });

  it("renders disable confirmation mode", () => {
    const store = createStore();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorDialogAtom, {
      open: true,
      sessionId: "sess-1",
      mode: "disable",
      draftObjective: "",
      draftEvaluatorProviderId: "claude",
    });
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
            objective: "Finish the server refactor",
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
        <ObjectiveDialog workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByText("Disabling stops evaluation cycles")).toBeInTheDocument();
    expect(screen.getByText("Finish the server refactor")).toBeInTheDocument();
  });

  it("keeps the centered modal shell on desktop viewports", () => {
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

    expect(document.querySelector(".modal-overlay")).toBeTruthy();
  });

  it("renders nothing on mobile because mobile supervisor detail owns the flow", () => {
    viewportMocks.viewport = "mobile";
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

    const { container } = render(
      <Provider store={store}>
        <ObjectiveDialog workspaceId="ws-1" sessionId="sess-1" />
      </Provider>
    );

    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector(".modal-overlay")).toBeNull();
  });
});
