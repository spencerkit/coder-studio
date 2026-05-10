import { render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedAtom, localeAtom } from "../atoms/app-ui";
import { authEnabledAtom, connectionStatusAtom, wsClientAtom } from "../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../atoms/workspaces";
import { DesktopShell } from "./desktop-shell";

vi.mock("../features/welcome", () => ({
  WelcomePage: () => <div>WelcomePage</div>,
}));

vi.mock("../features/settings", () => ({
  SettingsPage: () => <div>SettingsPage</div>,
}));

vi.mock("../features/workspace/views/desktop/workspace-desktop-view", () => ({
  WorkspaceDesktopView: () => <div>WorkspacePage</div>,
}));

vi.mock("../features/command-palette", () => ({
  CommandPalette: () => null,
}));

vi.mock("../features/workspace/views/shared/branch-quick-pick", () => ({
  BranchQuickPick: () => null,
}));

vi.mock("../features/auth", () => ({
  LoginPage: () => <div>LoginPage</div>,
}));

vi.mock("../features/not-found", () => ({
  NotFoundPage: () => <div>Page not found</div>,
}));

vi.mock("../features/notifications", () => ({
  useSessionNotifications: () => {},
  ToastContainer: () => null,
}));

const originalFetch = globalThis.fetch;

function renderShell(store: ReturnType<typeof createStore>) {
  return render(
    <Provider store={store}>
      <BrowserRouter>
        <DesktopShell />
      </BrowserRouter>
    </Provider>
  );
}

describe("DesktopShell auth gating", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("shows a loading shell while auth status is still unknown", () => {
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, null);
    store.set(authenticatedAtom, false);

    renderShell(store);

    expect(screen.getByText("正在连接工作区...")).toBeInTheDocument();
    expect(document.querySelector(".app-loading-shell")).toBeTruthy();
    expect(screen.getByText("CODER STUDIO").closest(".app-loading-card")).toBeTruthy();
    expect(screen.queryByText("LoginPage")).not.toBeInTheDocument();
  });

  it("redirects / to /login when auth is enabled and user is unauthenticated", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);

    renderShell(store);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/login");
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
    });
  });

  it("does not bootstrap workspaces from / before redirecting to /login when auth is enabled and user is unauthenticated", async () => {
    const sendCommand = vi.fn();
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);
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
    store.set(workspacesLoadStateAtom, "ready");
    store.set(wsClientAtom, { sendCommand } as never);

    renderShell(store);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/login");
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
      expect(sendCommand).not.toHaveBeenCalled();
    });
  });

  it("redirects /workspace to /login when auth is enabled and user is unauthenticated", async () => {
    window.history.replaceState({}, "", "/workspace");

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);

    renderShell(store);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/login");
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
    });
  });

  it("renders WorkspacePage on /workspace", () => {
    window.history.replaceState({}, "", "/workspace");

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
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

    renderShell(store);

    expect(screen.getByText("WorkspacePage")).toBeInTheDocument();
  });

  it("shows the shared workspace gate on desktop while /workspace is unresolved", () => {
    window.history.replaceState({}, "", "/workspace");

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(localeAtom, "en");
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, "loading");

    renderShell(store);

    expect(screen.getByText("Loading workspaces")).toBeInTheDocument();
    expect(screen.queryByText("WorkspacePage")).not.toBeInTheDocument();
  });

  it("redirects /workspace to / on desktop when the workspace list is ready but empty while reconnecting", async () => {
    window.history.replaceState({}, "", "/workspace");

    const store = createStore();
    store.set(connectionStatusAtom, "reconnecting");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(localeAtom, "en");
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, "ready");

    renderShell(store);

    expect(screen.queryByText("Loading workspaces")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
      expect(screen.getByText("WelcomePage")).toBeInTheDocument();
    });
  });

  it("keeps the explicit /login route when auth is enabled and user is unauthenticated", async () => {
    window.history.replaceState({}, "", "/login");

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);

    renderShell(store);

    await waitFor(() => {
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
      expect(window.location.pathname).toBe("/login");
    });
  });

  it("redirects /login to / for authenticated users", async () => {
    window.history.replaceState({}, "", "/login");

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, "ready");

    renderShell(store);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
      expect(screen.getByText("WelcomePage")).toBeInTheDocument();
    });
  });

  it("does not preserve the legacy /auth route on desktop", () => {
    window.history.replaceState({}, "", "/auth");

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    renderShell(store);

    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("rewrites /auth to /login on desktop when auth is required and user is unauthenticated", async () => {
    window.history.replaceState({}, "", "/auth");

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);

    renderShell(store);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/login");
      expect(screen.getByText("LoginPage")).toBeInTheDocument();
    });
  });

  it("shows a not found page for unknown frontend routes", () => {
    window.history.replaceState({}, "", "/missing-page");

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    renderShell(store);

    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("shows the reconnecting banner on desktop", () => {
    const store = createStore();
    store.set(connectionStatusAtom, "reconnecting");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    renderShell(store);

    expect(screen.getByText("正在重新连接...")).toBeInTheDocument();
  });

  it("redirects / to /workspace after auth resolves and workspace.list is non-empty", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "workspace.list") {
        return [{ id: "ws-1", path: "/tmp/ws-1", targetRuntime: "native" }];
      }
      return [];
    });
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, "idle");
    store.set(wsClientAtom, { sendCommand } as never);

    renderShell(store);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("workspace.list", {}, undefined);
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/workspace");
    });
  });

  it("redirects / to /workspace on desktop when the workspace list is already ready while reconnecting", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "reconnecting");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
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
    store.set(workspacesLoadStateAtom, "ready");

    renderShell(store);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/workspace");
      expect(screen.getByText("WorkspacePage")).toBeInTheDocument();
    });
  });

  it("keeps / on WelcomePage after auth resolves and workspace.list is empty", async () => {
    const sendCommand = vi.fn().mockResolvedValue([]);
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, "idle");
    store.set(wsClientAtom, { sendCommand } as never);

    renderShell(store);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("workspace.list", {}, undefined);
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
      expect(screen.getByText("WelcomePage")).toBeInTheDocument();
    });
  });

  it("redirects /workspace back to / when auth resolves and workspace.list is empty", async () => {
    window.history.replaceState({}, "", "/workspace");
    const sendCommand = vi.fn().mockResolvedValue([]);
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, "idle");
    store.set(wsClientAtom, { sendCommand } as never);

    renderShell(store);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("workspace.list", {}, undefined);
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
      expect(screen.getByText("WelcomePage")).toBeInTheDocument();
    });
  });
});
