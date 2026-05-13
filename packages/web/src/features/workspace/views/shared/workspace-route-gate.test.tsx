import { render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../../../../atoms/workspaces";
import { WorkspaceRouteGate } from "./workspace-route-gate";

function renderGate(store: ReturnType<typeof createStore>, initialEntry = "/") {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <WorkspaceRouteGate>
          <div>ready</div>
        </WorkspaceRouteGate>
      </MemoryRouter>
    </Provider>
  );
}

describe("WorkspaceRouteGate", () => {
  it("shows a loading shell while workspaces are unresolved", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "loading");

    renderGate(store);

    expect(screen.getByTestId("workspace-resolving-shell")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Loading workspaces")).toBeInTheDocument();
    expect(screen.queryByText("ready")).not.toBeInTheDocument();
  });

  it("shows an error shell when workspace bootstrap fails", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(workspacesLoadStateAtom, "error");
    store.set(workspacesLoadErrorAtom, "Failed to fetch workspace list");

    renderGate(store);

    expect(document.querySelector(".workspace-resolving-shell")).not.toBeNull();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Failed to load workspaces")).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch workspace list")).toBeInTheDocument();
    expect(screen.queryByText("ready")).not.toBeInTheDocument();
  });

  it("renders children when an active workspace is available", () => {
    const store = createStore();
    store.set(workspacesAtom, {
      "ws-1": {
        id: "ws-1",
        path: "/tmp/ws-1",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
      },
    });
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(workspacesLoadStateAtom, "ready");

    renderGate(store);

    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("renders children when the workspace list is ready but empty", () => {
    const store = createStore();
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, "ready");

    renderGate(store);

    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.queryByText("Loading workspaces")).not.toBeInTheDocument();
  });

  it("holds children when MemoryRouter requests /workspace and the list is ready but empty", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, "ready");

    renderGate(store, "/workspace");

    expect(screen.getByTestId("workspace-resolving-shell")).toBeInTheDocument();
    expect(screen.queryByText("ready")).not.toBeInTheDocument();
  });
});
