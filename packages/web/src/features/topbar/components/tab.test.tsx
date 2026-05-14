import type { Workspace } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lastViewedTargetAtom, localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
} from "../../../atoms/workspaces";
import { TabList, Tabs } from "../../../components/ui";
import { CommandResultError } from "../../../ws/client";
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

  function renderWorkspaceTab(
    store: ReturnType<typeof createStore>,
    workspace: Workspace,
    options?: {
      isActive?: boolean;
      value?: string;
      onValueChange?: (value: string) => void;
    }
  ) {
    const {
      isActive = false,
      onValueChange = vi.fn(),
      value = isActive ? workspace.id : "ws-1",
    } = options ?? {};

    return render(
      <Provider store={store}>
        <Tabs aria-label="Workspaces" onValueChange={onValueChange} value={value}>
          <TabList className="topbar-tablist">
            <WorkspaceTab workspace={workspace} isActive={isActive} />
          </TabList>
        </Tabs>
      </Provider>
    );
  }

  it("renders the folder basename and uses a shared tooltip for the full path", () => {
    const workspace = {
      ...createWorkspace("ws-2", "/home/spencer/workspace/coder-studio"),
      name: "/home/spencer/workspace/coder-studio",
    };
    const store = createStore();
    store.set(localeAtom, "en");

    renderWorkspaceTab(store, workspace);

    const tab = screen.getByRole("tab", { name: "coder-studio" });
    const label = screen.getByText("coder-studio");

    expect(tab).not.toHaveAttribute("title");
    expect(label).not.toHaveAttribute("title");
    expect(screen.queryByText("/home/spencer/workspace/coder-studio")).toBeNull();

    fireEvent.mouseEnter(label);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("/home/spencer/workspace/coder-studio");
    expect(label).toHaveAttribute("aria-describedby", tooltip.getAttribute("id") ?? "");
  });

  it("sets the active workspace without navigating when a tab is clicked", () => {
    const workspace = createWorkspace("ws-2", "/tmp/two");
    const store = createStore();
    store.set(localeAtom, "en");

    renderWorkspaceTab(store, workspace, { value: "ws-1" });

    fireEvent.click(screen.getByRole("tab", { name: /two/i }));

    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("persists the global last-viewed workspace target when a tab is clicked", async () => {
    const workspace = createWorkspace("ws-2", "/tmp/two");
    const sendCommand = vi.fn().mockResolvedValue({
      workspaceId: "ws-2",
      updatedAt: 10,
    });
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    renderWorkspaceTab(store, workspace, { value: "ws-1" });

    fireEvent.click(screen.getByRole("tab", { name: /two/i }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.lastViewedTarget.set",
        { workspaceId: "ws-2", sessionId: undefined },
        undefined
      );
    });
  });

  it("does not persist again when the active workspace tab is clicked", () => {
    const workspace = createWorkspace("ws-2", "/tmp/two");
    const sendCommand = vi.fn();
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(activeWorkspaceIdAtom, "ws-2");
    store.set(lastViewedTargetAtom, {
      workspaceId: "ws-2",
      updatedAt: 10,
    });

    renderWorkspaceTab(store, workspace, { isActive: true, value: "ws-2" });

    fireEvent.click(screen.getByRole("tab", { name: /two/i }));

    expect(sendCommand).not.toHaveBeenCalledWith(
      "workspace.lastViewedTarget.set",
      expect.anything(),
      undefined
    );
  });

  it("retries persistence for the same workspace after a failed write", async () => {
    const workspace = createWorkspace("ws-2", "/tmp/two");
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(
        new CommandResultError({
          code: "write_failed",
          message: "failed",
        })
      )
      .mockResolvedValueOnce({
        workspaceId: "ws-2",
        updatedAt: 11,
      });
    const store = createStore();

    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);

    const { rerender } = renderWorkspaceTab(store, workspace, { value: "ws-1" });

    fireEvent.click(screen.getByRole("tab", { name: /two/i }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        1,
        "workspace.lastViewedTarget.set",
        { workspaceId: "ws-2", sessionId: undefined },
        undefined
      );
    });

    rerender(
      <Provider store={store}>
        <Tabs aria-label="Workspaces" onValueChange={vi.fn()} value="ws-1">
          <TabList className="topbar-tablist">
            <WorkspaceTab workspace={workspace} isActive={false} />
          </TabList>
        </Tabs>
      </Provider>
    );

    fireEvent.click(screen.getByRole("tab", { name: /two/i }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        2,
        "workspace.lastViewedTarget.set",
        { workspaceId: "ws-2", sessionId: undefined },
        undefined
      );
    });
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

    renderWorkspaceTab(store, firstWorkspace, { isActive: true });

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

  it("closes an inactive workspace without activating it first", async () => {
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

    renderWorkspaceTab(store, secondWorkspace, {
      isActive: false,
      value: "ws-1",
    });

    fireEvent.click(screen.getByRole("button", { name: "Close Workspace" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.close",
        {
          id: "ws-2",
        },
        undefined
      );
    });

    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-1");
    expect(store.get(workspaceOrderAtom)).toEqual(["ws-1"]);
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it("renders unread counts through the shared badge primitive and truncates above max", () => {
    const workspace = {
      ...createWorkspace("ws-2", "/tmp/two"),
      unreadCount: 12,
    };
    const store = createStore();
    store.set(localeAtom, "en");

    renderWorkspaceTab(store, workspace);

    expect(screen.getByText("9+")).toHaveClass("topbar-unread");
  });

  it("does not render an unread badge when the count is zero", () => {
    const workspace = {
      ...createWorkspace("ws-2", "/tmp/two"),
      unreadCount: 0,
    };
    const store = createStore();
    store.set(localeAtom, "en");

    renderWorkspaceTab(store, workspace);

    expect(document.querySelector(".topbar-unread")).toBeNull();
  });
});
