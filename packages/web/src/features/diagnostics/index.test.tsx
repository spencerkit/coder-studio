import type { DiagnosticsCheck, DiagnosticsResponse, Workspace } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastViewedTargetAtom, localeAtom } from "../../atoms/app-ui";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import { sessionsAtom } from "../../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../../atoms/workspaces";
import { paneLayoutAtomFamily } from "../agent-panes/atoms/pane-layout";
import { DiagnosticsPage } from "./page";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-display">{location.pathname}</div>;
}

function createWorkspace(id: string, path: string): Workspace {
  return {
    id,
    name: "repo",
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

function createResponse(
  overrides: Partial<DiagnosticsResponse> = {},
  checks: DiagnosticsCheck[] = []
): DiagnosticsResponse {
  return {
    context: "manual_check",
    canContinue: true,
    checks,
    metadata: {},
    ...overrides,
  };
}

function createStoreWithClient(sendCommand: ReturnType<typeof vi.fn>) {
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);
  store.set(workspacesAtom, {});
  store.set(workspaceOrderAtom, []);
  store.set(workspacesLoadStateAtom, "idle");
  store.set(workspacesLoadErrorAtom, null);
  store.set(activeWorkspaceIdAtom, null);
  store.set(lastViewedTargetAtom, null);
  return store;
}

function renderDiagnostics(
  initialEntry: string,
  sendCommand: ReturnType<typeof vi.fn>,
  seed?: (store: ReturnType<typeof createStoreWithClient>) => void
) {
  const store = createStoreWithClient(sendCommand);
  seed?.(store);

  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="/workspace" element={<LocationDisplay />} />
          <Route path="/settings" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

  return { store, ...view };
}

describe("DiagnosticsPage", () => {
  const clipboardWriteText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    viewportMocks.viewport = "desktop";
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads diagnostics on entry and rechecks when requested", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse(
          {
            context: "manual_check",
            canContinue: true,
          },
          [
            {
              id: "workspace-ready",
              code: "workspace_path_ready",
              status: "ready",
              workspacePath: "/repo",
            },
          ]
        )
      )
      .mockResolvedValueOnce(
        createResponse(
          {
            context: "manual_check",
            canContinue: true,
          },
          [
            {
              id: "provider-ready",
              code: "provider_runtime_ready",
              status: "ready",
              providerId: "claude",
            },
          ]
        )
      );

    renderDiagnostics("/diagnostics?context=manual_check&workspacePath=%2Frepo", sendCommand);

    expect(await screen.findByText("Environment diagnostics")).toBeInTheDocument();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        1,
        "diagnostics.get",
        {
          context: "manual_check",
          workspaceId: undefined,
          workspacePath: "/repo",
          providerId: undefined,
        },
        undefined
      );
    });

    expect(screen.getByText("Workspace path is ready")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Recheck" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        2,
        "diagnostics.recheck",
        {
          context: "manual_check",
          workspaceId: undefined,
          workspacePath: "/repo",
          providerId: undefined,
        },
        undefined
      );
    });

    expect(await screen.findByText("Claude is ready")).toBeInTheDocument();
  });

  it("uses the shared secondary-page chrome instead of the welcome card shell", async () => {
    const sendCommand = vi.fn().mockResolvedValue(
      createResponse(
        {
          context: "manual_check",
          canContinue: true,
        },
        [
          {
            id: "workspace-ready",
            code: "workspace_path_ready",
            status: "ready",
            workspacePath: "/repo",
          },
        ]
      )
    );

    const { rerender } = renderDiagnostics(
      "/diagnostics?context=manual_check&workspacePath=%2Frepo",
      sendCommand
    );

    expect(await screen.findByText("Environment diagnostics")).toBeInTheDocument();

    expect(document.querySelector(".diagnostics-page")).not.toBeNull();
    expect(document.querySelector(".diagnostics-header .page-header")).not.toBeNull();
    expect(document.querySelector(".diagnostics-header .page-header--secondary")).not.toBeNull();
    expect(document.querySelector(".diagnostics-body")).not.toBeNull();
    expect(document.querySelector(".diagnostics-content")).not.toBeNull();
    expect(document.querySelector(".diagnostics-content-surface")).not.toBeNull();
    expect(document.querySelector(".welcome-card")).toBeNull();

    viewportMocks.viewport = "mobile";
    rerender(
      <Provider store={createStoreWithClient(sendCommand)}>
        <MemoryRouter initialEntries={["/diagnostics?context=manual_check&workspacePath=%2Frepo"]}>
          <Routes>
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
            <Route path="/workspace" element={<LocationDisplay />} />
            <Route path="/settings" element={<LocationDisplay />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByText("Environment diagnostics")).toBeInTheDocument();
    expect(document.querySelector(".diagnostics-page--mobile")).not.toBeNull();
    expect(document.querySelector(".diagnostics-header .mobile-page-header")).not.toBeNull();
    expect(document.querySelector(".diagnostics-content--mobile")).not.toBeNull();
    expect(document.querySelector(".welcome-card")).toBeNull();
  });

  it("opens the workspace and updates workspace state when retrying workspace continuation", async () => {
    const workspace = createWorkspace("ws-1", "/repo");
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get") {
        return createResponse(
          {
            context: "workspace_open",
            canContinue: true,
          },
          [
            {
              id: "workspace-ready",
              code: "workspace_path_ready",
              status: "ready",
              workspacePath: "/repo",
            },
          ]
        );
      }

      if (op === "workspace.open") {
        expect(args).toEqual({ path: "/repo" });
        return workspace;
      }

      if (op === "workspace.lastViewedTarget.set") {
        return {
          workspaceId: "ws-1",
          updatedAt: 10,
        };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    const { store } = renderDiagnostics(
      "/diagnostics?context=workspace_open&workspacePath=%2Frepo",
      sendCommand
    );

    expect(await screen.findByText("We couldn't open your workspace")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry Opening Workspace" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-display")).toHaveTextContent("/workspace");
    });

    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-1");
    expect(store.get(workspacesAtom)).toEqual({ "ws-1": workspace });
    expect(store.get(workspaceOrderAtom)).toEqual(["ws-1"]);
    expect(store.get(workspacesLoadStateAtom)).toBe("ready");
    expect(store.get(workspacesLoadErrorAtom)).toBeNull();
    expect(store.get(lastViewedTargetAtom)).toMatchObject({
      workspaceId: "ws-1",
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.lastViewedTarget.set",
      {
        workspaceId: "ws-1",
        sessionId: undefined,
      },
      undefined
    );
  });

  it("shows session-start diagnostics as an environment report with docs and recheck actions", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse(
          {
            context: "session_start",
            canContinue: false,
            metadata: {
              workspaceId: "ws-1",
              providerId: "claude",
            },
          },
          [
            {
              id: "workspace-ready",
              code: "session_workspace_ready",
              status: "ready",
              workspaceId: "ws-1",
              workspacePath: "/repo",
            },
            {
              id: "provider-missing",
              code: "provider_cli_missing",
              status: "needs_attention",
              providerId: "claude",
              missingCommands: ["claude"],
              manualGuideKeys: ["provider.install.claude.manual"],
              docUrl: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
            },
          ]
        )
      )
      .mockResolvedValueOnce(
        createResponse(
          {
            context: "session_start",
            canContinue: false,
            metadata: {
              workspaceId: "ws-1",
              providerId: "claude",
            },
          },
          [
            {
              id: "provider-missing",
              code: "provider_cli_missing",
              status: "needs_attention",
              providerId: "claude",
              missingCommands: ["claude"],
              manualGuideKeys: ["provider.install.claude.manual"],
              docUrl: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
            },
          ]
        )
      );

    renderDiagnostics(
      "/diagnostics?context=session_start&workspaceId=ws-1&providerId=claude",
      sendCommand
    );

    expect(await screen.findByText("Your session is not ready to start")).toBeInTheDocument();
    expect(screen.getByText("Claude CLI is missing")).toBeInTheDocument();
    expect(
      screen.getByText("Then run npm install -g @anthropic-ai/claude-code.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open official docs" })).toHaveAttribute(
      "href",
      "https://docs.anthropic.com/en/docs/claude-code/getting-started"
    );

    fireEvent.click(screen.getByRole("button", { name: "Recheck" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        2,
        "diagnostics.recheck",
        {
          context: "session_start",
          workspaceId: "ws-1",
          workspacePath: undefined,
          providerId: "claude",
        },
        undefined
      );
    });
  });

  it("continues session start when diagnostics are clear and restores the target pane intent", async () => {
    const workspace = createWorkspace("ws-1", "/repo");
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get") {
        return createResponse(
          {
            context: "session_start",
            canContinue: true,
            metadata: {
              workspaceId: "ws-1",
              providerId: "claude",
            },
          },
          [
            {
              id: "workspace-ready",
              code: "session_workspace_ready",
              status: "ready",
              workspaceId: "ws-1",
              workspacePath: "/repo",
            },
            {
              id: "provider-ready",
              code: "provider_runtime_ready",
              status: "ready",
              providerId: "claude",
            },
          ]
        );
      }

      if (op === "session.create") {
        expect(args).toEqual({
          workspaceId: "ws-1",
          providerId: "claude",
        });
        return {
          id: "sess-1",
          workspaceId: "ws-1",
          terminalId: "term-1",
          providerId: "claude",
          state: "starting",
          capability: "full",
          startedAt: 1,
          lastActiveAt: 1,
        };
      }

      if (op === "workspace.lastViewedTarget.set") {
        return {
          workspaceId: "ws-1",
          sessionId: "sess-1",
          updatedAt: 15,
        };
      }

      if (op === "workspace.uiState.set") {
        return {
          ...workspace,
          uiState: args?.uiState,
        };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    const { store } = renderDiagnostics(
      "/diagnostics?context=session_start&workspaceId=ws-1&providerId=claude&paneId=pane-1&launchMode=assign",
      sendCommand,
      (draftStore) => {
        draftStore.set(workspacesAtom, { "ws-1": workspace });
        draftStore.set(paneLayoutAtomFamily("ws-1"), {
          id: "root",
          type: "split",
          direction: "horizontal",
          children: [
            { id: "pane-1", type: "leaf", sessionId: undefined },
            { id: "pane-2", type: "leaf", sessionId: undefined },
          ],
        } as never);
      }
    );

    expect(await screen.findByText("Your session is not ready to start")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue Starting Session" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-display")).toHaveTextContent("/workspace");
    });

    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-1");
    expect(store.get(workspacesLoadStateAtom)).toBe("ready");
    expect(store.get(workspacesLoadErrorAtom)).toBeNull();
    expect(store.get(sessionsAtom)).toHaveProperty("sess-1");
    expect(store.get(lastViewedTargetAtom)).toMatchObject({
      workspaceId: "ws-1",
      sessionId: "sess-1",
    });
    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "pane-1", type: "leaf", sessionId: "sess-1" },
        { id: "pane-2", type: "leaf", sessionId: undefined },
      ],
    });
  });

  it("continues phone handoff by preparing the target and copying the mobile link when diagnostics are clear", async () => {
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get") {
        return createResponse(
          {
            context: "mobile_continue",
            canContinue: true,
            metadata: {
              host: "192.168.1.10",
              authEnabled: true,
              workspaceId: "ws-1",
            },
          },
          [
            {
              id: "mobile-host",
              code: "mobile_host_ready",
              status: "ready",
            },
            {
              id: "mobile-auth",
              code: "server_auth_ready",
              status: "ready",
            },
          ]
        );
      }

      if (op === "workspace.lastViewedTarget.set") {
        expect(args).toEqual({
          workspaceId: "ws-1",
          sessionId: undefined,
        });
        return {
          workspaceId: "ws-1",
          updatedAt: 15,
        };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    renderDiagnostics("/diagnostics?context=mobile_continue&workspaceId=ws-1", sendCommand);

    expect(await screen.findByText("Phone continuation needs a few fixes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue on Phone" }));

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith(
        `http://192.168.1.10:${window.location.port}/workspace`
      );
    });
  });

  it("rechecks instead of copying a link when mobile continuation is still blocked", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse(
          {
            context: "mobile_continue",
            canContinue: false,
            metadata: {
              host: "0.0.0.0",
              authEnabled: true,
              workspaceId: "ws-1",
            },
          },
          [
            {
              id: "mobile-host",
              code: "mobile_host_local_only",
              status: "needs_attention",
            },
          ]
        )
      )
      .mockResolvedValueOnce(
        createResponse(
          {
            context: "mobile_continue",
            canContinue: false,
            metadata: {
              host: "0.0.0.0",
              authEnabled: true,
              workspaceId: "ws-1",
            },
          },
          [
            {
              id: "mobile-host",
              code: "mobile_host_local_only",
              status: "needs_attention",
            },
          ]
        )
      );

    renderDiagnostics("/diagnostics?context=mobile_continue&workspaceId=ws-1", sendCommand);

    expect(await screen.findByText("Phone continuation needs a few fixes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recheck" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Recheck" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        2,
        "diagnostics.recheck",
        {
          context: "mobile_continue",
          workspaceId: "ws-1",
          workspacePath: undefined,
          providerId: undefined,
        },
        undefined
      );
    });

    expect(clipboardWriteText).not.toHaveBeenCalled();
  });

  it("does not copy a localhost fallback URL when mobile diagnostics report a local-only host", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "diagnostics.get") {
        return createResponse(
          {
            context: "mobile_continue",
            canContinue: true,
            metadata: {
              host: "0.0.0.0",
              authEnabled: true,
              workspaceId: "ws-1",
            },
          },
          [
            {
              id: "mobile-host",
              code: "mobile_host_ready",
              status: "ready",
            },
            {
              id: "mobile-auth",
              code: "server_auth_ready",
              status: "ready",
            },
          ]
        );
      }

      if (op === "workspace.lastViewedTarget.set") {
        return {
          workspaceId: "ws-1",
          updatedAt: 15,
        };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    renderDiagnostics("/diagnostics?context=mobile_continue&workspaceId=ws-1", sendCommand);

    expect(await screen.findByText("Phone continuation needs a few fixes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue on Phone" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Diagnostics could not be refreshed right now."
      );
    });

    expect(clipboardWriteText).not.toHaveBeenCalled();
  });
});
