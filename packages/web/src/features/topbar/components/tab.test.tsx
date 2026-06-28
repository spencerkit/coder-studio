import type { Session, Workspace } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lastViewedTargetAtom, localeAtom } from "../../../atoms/app-ui";
import { connectionStatusAtom, wsClientAtom } from "../../../atoms/connection";
import { sessionsAtom } from "../../../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
} from "../../../atoms/workspaces";
import { TabList, Tabs } from "../../../components/ui";
import { CommandResultError } from "../../../ws/client";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
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

function createSession(id: string, state: Session["state"], workspaceId: string): Session {
  return {
    id,
    workspaceId,
    terminalId: `term-${id}`,
    providerId: "codex",
    state,
    capability: "full",
    startedAt: 1,
    lastActiveAt: 1,
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

  it("shows a WSL badge for workspaces opened with the wsl runtime", () => {
    const workspace = {
      ...createWorkspace("ws-2", "/home/spencer/workspace/coder-studio"),
      targetRuntime: "wsl" as const,
      wslDistro: "Ubuntu-24.04",
      name: "/home/spencer/workspace/coder-studio",
    };
    const store = createStore();
    store.set(localeAtom, "en");

    renderWorkspaceTab(store, workspace);

    const badge = screen.getByText("WSL");
    const row = screen.getByText("coder-studio").closest(".topbar-tab-name-row");
    const tab = screen.getByRole("tab", { name: "coder-studio" });
    const content = screen.getByText("coder-studio").closest(".topbar-tab-content");

    expect(badge).toBeInTheDocument();
    expect(row).not.toContainElement(badge);
    expect(content).not.toContainElement(badge);
    expect(tab.firstElementChild).toBe(badge);
    expect(tab).toBeInTheDocument();
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

  it("does not render an unread badge even when unread counts exist", () => {
    const workspace = {
      ...createWorkspace("ws-2", "/tmp/two"),
      unreadCount: 12,
    };
    const store = createStore();
    store.set(localeAtom, "en");

    renderWorkspaceTab(store, workspace);

    expect(document.querySelector(".topbar-unread")).toBeNull();
  });

  it("renders the runtime pane layout for the active workspace instead of the stale persisted layout", () => {
    const workspace = {
      ...createWorkspace("ws-2", "/tmp/two"),
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
        paneLayout: { id: "persisted-root", type: "leaf", sessionId: "sess-persisted" },
      },
    };
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(paneLayoutAtomFamily("ws-2"), {
      id: "runtime-root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", sessionId: "sess-running" },
        { id: "right", type: "leaf" },
      ],
    });
    store.set(sessionsAtom, {
      "sess-running": createSession("sess-running", "running", "ws-2"),
    });

    const { container } = renderWorkspaceTab(store, workspace, { isActive: true, value: "ws-2" });
    const content = container.querySelector(".topbar-tab-content");
    const miniMap = container.querySelector(".workspace-session-mini-map");

    expect(container.querySelector(".topbar-dot")).toBeNull();
    expect(miniMap).not.toBeNull();
    expect(content).not.toBeNull();
    expect(content).toContainElement(miniMap as HTMLElement);
    const columns = container.querySelectorAll(".workspace-session-mini-map__column");

    expect(columns).toHaveLength(2);
    expect(columns[0]?.getAttribute("style")).toContain("var(--workspace-session-map-running)");
    expect(columns[1]?.getAttribute("style")).toContain("var(--workspace-session-map-empty)");
  });

  it("hydrates inactive workspace sessions once and renders ended panes as empty cells", async () => {
    const workspace = {
      ...createWorkspace("ws-3", "/tmp/three"),
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
        paneLayout: {
          id: "persisted-root",
          type: "split",
          direction: "vertical",
          children: [
            { id: "top", type: "leaf", sessionId: "sess-starting" },
            { id: "bottom", type: "leaf", sessionId: "sess-ended" },
          ],
        },
      },
    };
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "session.list") {
        expect(args).toEqual({ workspaceId: "ws-3" });
        return [
          createSession("sess-starting", "starting", "ws-3"),
          {
            ...createSession("sess-ended", "ended", "ws-3"),
            endedAt: 2,
          },
        ];
      }

      if (op === "workspace.uiState.set") {
        return {
          ...workspace,
          uiState: args?.uiState as Workspace["uiState"],
        };
      }

      return undefined;
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, { "ws-3": workspace });
    store.set(workspaceOrderAtom, ["ws-1", "ws-3"]);
    store.set(activeWorkspaceIdAtom, "ws-1");

    const { container } = renderWorkspaceTab(store, workspace, { isActive: false, value: "ws-1" });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("session.list", { workspaceId: "ws-3" }, undefined);
    });

    expect(sendCommand.mock.calls.filter(([op]) => op === "session.list")).toHaveLength(1);
    expect(container.querySelector(".topbar-dot")).toBeNull();

    await waitFor(() => {
      expect(container.querySelectorAll(".workspace-session-mini-map__column")).toHaveLength(1);
    });

    expect(container.querySelector(".topbar-tab-content")).toContainElement(
      container.querySelector(".workspace-session-mini-map") as HTMLElement
    );
    const firstColumnStyle = container
      .querySelector(".workspace-session-mini-map__column")
      ?.getAttribute("style");

    expect(firstColumnStyle).toContain("var(--workspace-session-map-starting)");
    expect(firstColumnStyle).toContain("var(--workspace-session-map-empty)");
    expect(store.get(paneLayoutAtomFamily("ws-3"))).toEqual(
      expect.objectContaining({
        id: "persisted-root",
        type: "split",
        direction: "vertical",
        children: [
          expect.objectContaining({ id: "top", sessionId: "sess-starting" }),
          expect.objectContaining({ id: "bottom", sessionId: "sess-ended" }),
        ],
      })
    );
  });
});
