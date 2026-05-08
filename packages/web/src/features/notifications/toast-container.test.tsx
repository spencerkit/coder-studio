import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pendingFocusSessionAtom } from "../../atoms/app-ui";
import { activeWorkspaceIdAtom } from "../../atoms/workspaces";
import { type Toast, toastsAtom } from "./atoms";
import { ToastContainer } from "./toast-container";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

describe("ToastContainer", () => {
  beforeEach(() => {
    viewportMocks.viewport = "desktop";
    navigate.mockReset();
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
  });

  /**
   * Seed the toast directly via `toastsAtom` (bypassing `pushToastAtom`)
   * so the container renders with the toast already present on first
   * paint — no need to wrap a post-render store mutation in act/waitFor.
   */
  function renderWithToast(toast: Omit<Toast, "id" | "createdAt">) {
    const store = createStore();
    store.set(toastsAtom, [{ ...toast, id: "toast-test", createdAt: Date.now() }]);
    render(
      <Provider store={store}>
        <MemoryRouter>
          <ToastContainer />
        </MemoryRouter>
      </Provider>
    );
    return store;
  }

  it("clicking a session-bearing toast navigates to the workspace and sets the pending-focus marker", () => {
    const store = renderWithToast({
      kind: "success",
      title: "Session done",
      body: "Claude · demo · 1m",
      workspaceId: "ws-9",
      sessionId: "sess-77",
    });

    fireEvent.click(screen.getByRole("alert"));

    expect(navigate).toHaveBeenCalledWith("/workspace");
    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-9");
    expect(store.get(pendingFocusSessionAtom)).toBe("sess-77");
    expect(window.localStorage.length).toBe(0);
  });

  it("clicking a workspace-only toast (no sessionId) navigates but does not set focus marker", () => {
    const store = renderWithToast({
      kind: "info",
      title: "Heads up",
      workspaceId: "ws-3",
    });

    fireEvent.click(screen.getByRole("alert"));

    expect(navigate).toHaveBeenCalledWith("/workspace");
    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-3");
    expect(store.get(pendingFocusSessionAtom)).toBeNull();
  });

  it("uses the mobile toast container variant on mobile while preserving the rendered toast", () => {
    viewportMocks.viewport = "mobile";

    renderWithToast({
      kind: "success",
      title: "Session done",
      body: "Claude · demo · 1m",
    });

    expect(document.querySelector(".toast-container--mobile")).toBeTruthy();
    expect(screen.getByText("Session done")).toBeInTheDocument();
  });

  it("renders the shared toast compatibility structure and keeps close dismiss isolated from root clicks", () => {
    renderWithToast({
      kind: "error",
      title: "Session failed",
      body: "Claude · demo · 1m",
      workspaceId: "ws-5",
    });

    expect(document.querySelector(".toast-container")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toHaveClass("toast__close");
    expect(document.querySelector(".toast--error .toast__icon")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
