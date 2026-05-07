import type { Workspace } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
} from "../../../atoms/workspaces";
import { WorkspaceTab } from "./tab";

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
  };
});

function createWorkspace(id: string, path: string): Workspace {
  return {
    id,
    path,
    targetRuntime: "native",
    openedAt: 1,
    lastActiveAt: 1,
    uiState: {
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
    },
  };
}

describe("WorkspaceTab", () => {
  beforeEach(() => {
    routerMocks.navigate.mockReset();
  });

  it("renders the folder basename when workspace name is a full path", () => {
    const workspace = {
      ...createWorkspace("ws-2", "/home/spencer/workspace/coder-studio"),
      name: "/home/spencer/workspace/coder-studio",
    };
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <WorkspaceTab workspace={workspace} isActive={false} />
      </Provider>
    );

    expect(screen.getByText("coder-studio")).toBeInTheDocument();
    expect(screen.queryByText("/home/spencer/workspace/coder-studio")).toBeNull();
  });

  it("sets the active workspace without navigating when a tab is clicked", () => {
    const workspace = createWorkspace("ws-2", "/tmp/two");
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <WorkspaceTab workspace={workspace} isActive={false} />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: /two/i }));

    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("closes the active workspace without route navigation and falls back to the next ordered workspace", async () => {
    const firstWorkspace = createWorkspace("ws-1", "/tmp/one");
    const secondWorkspace = createWorkspace("ws-2", "/tmp/two");
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {
      "ws-1": firstWorkspace,
      "ws-2": secondWorkspace,
    });
    store.set(workspaceOrderAtom, ["ws-1", "ws-2"]);
    store.set(activeWorkspaceIdAtom, "ws-1");

    render(
      <Provider store={store}>
        <WorkspaceTab workspace={firstWorkspace} isActive />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Close Workspace" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.close",
        {
          id: "ws-1",
        },
        undefined
      );
    });

    expect(store.get(workspaceOrderAtom)).toEqual(["ws-2"]);
    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
    expect(store.get(workspacesAtom)["ws-1"]).toBeUndefined();
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("renders unread counts through the shared badge primitive and truncates above max", () => {
    const workspace = {
      ...createWorkspace("ws-2", "/tmp/two"),
      unreadCount: 12,
    };
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <WorkspaceTab workspace={workspace} isActive={false} />
      </Provider>
    );

    expect(screen.getByText("9+")).toHaveClass("topbar-unread");
  });

  it("does not render an unread badge when the count is zero", () => {
    const workspace = {
      ...createWorkspace("ws-2", "/tmp/two"),
      unreadCount: 0,
    };
    const store = createStore();
    store.set(localeAtom, "en");

    render(
      <Provider store={store}>
        <WorkspaceTab workspace={workspace} isActive={false} />
      </Provider>
    );

    expect(document.querySelector(".topbar-unread")).toBeNull();
  });
});
