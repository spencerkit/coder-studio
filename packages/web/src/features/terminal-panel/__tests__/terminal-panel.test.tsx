import { Topics } from "@coder-studio/core";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { type ReactNode, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { activeWorkspaceIdAtom } from "../../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../../test-utils/workspace-state";
import { toastsAtom } from "../../notifications";
import { bottomPanelHeightAtom } from "../../workspace/atoms";
import { useTerminalActions } from "../actions/use-terminal-actions";
import {
  type TerminalMeta,
  terminalActiveIdAtomFamily,
  terminalIdsAtomFamily,
  terminalMetaAtomFamily,
  terminalOutputAtomFamily,
} from "../atoms";
import { TerminalPanel } from "../views/shared/terminal-panel";

const mockXtermHost = vi.fn(
  ({
    terminalId,
    terminalKind,
  }: {
    terminalId: string;
    terminalKind?: "agent" | "shell" | "task";
  }) => (
    <div data-testid="xterm-host" data-terminal-kind={terminalKind}>
      {terminalId}
    </div>
  )
);

vi.mock("../views/shared/xterm-host", () => ({
  XtermHost: (props: { terminalId: string; terminalKind?: "agent" | "shell" | "task" }) =>
    mockXtermHost(props),
}));

type EventHandler = (topic: string, payload: unknown, seq: number) => void;

describe("TerminalPanel", () => {
  let handlers: EventHandler[];

  beforeEach(() => {
    handlers = [];
    mockXtermHost.mockClear();
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setEnglishLocale(store: ReturnType<typeof createStore>) {
    store.set(localeAtom, "en");
  }

  it("keeps rendering when the first terminal is created after mount", async () => {
    const store = createStore();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([
          {
            id: "term_1",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
        ]);
      }

      return Promise.resolve([]);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    const terminalMeta: TerminalMeta = {
      id: "term_1",
      workspaceId: "ws-test",
      kind: "shell",
      alive: true,
      title: "Workspace Shell",
    };
    store.set(terminalMetaAtomFamily("term_1"), terminalMeta);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    expect(screen.getByText("No terminals")).toBeInTheDocument();
    expect(document.querySelector(".bottom-terminal-empty")).toBeTruthy();
    expect(document.querySelector(".bottom-terminal-empty-icon")).toBeTruthy();
    expect(subscribe).toHaveBeenCalledWith([Topics.terminalsAll("ws-test")], expect.any(Function));

    await act(async () => {
      handlers[0]?.(
        "workspace.ws-test.terminal.term_1.created",
        { id: "term_1", kind: "shell" },
        1
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText("Workspace Shell").length).toBeGreaterThan(0);
    });
    expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("renders the new terminal immediately from terminal.create result before the created event arrives", async () => {
    const store = createStore();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([]);
      }

      if (op === "terminal.create") {
        return Promise.resolve({
          id: "term_2",
          workspaceId: "ws-test",
          kind: "shell",
          title: "Workspace Shell",
          cwd: "/tmp/ws-test",
          argv: ["/bin/bash"],
          cols: 120,
          rows: 30,
          alive: true,
          createdAt: 1,
        });
      }

      return Promise.resolve(undefined);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    expect(document.querySelector('[data-icon-semantic="terminal.action.new"]')).toBeTruthy();

    await act(async () => {
      screen.getAllByRole("button", { name: "New Terminal" })[0]?.click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_2");
    });
    expect(mockXtermHost.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        terminalId: "term_2",
        terminalKind: "shell",
      })
    );
    expect(store.get(terminalIdsAtomFamily("ws-test"))).toEqual(["term_2"]);
    expect(store.get(terminalActiveIdAtomFamily("ws-test"))).toBe("term_2");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("renders shared tab semantics for desktop terminal tabs and supports keyboard switching", async () => {
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([
          {
            id: "term_1",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
          {
            id: "term_2",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell 2",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 2,
          },
        ]);
      }

      return Promise.resolve([]);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <TerminalPanel />
        </MemoryRouter>
      </Provider>
    );

    const tablist = await screen.findByRole("tablist", { name: "Terminal Sessions" });
    const firstTab = screen.getByRole("tab", { name: "Workspace Shell" });
    const secondTab = screen.getByRole("tab", { name: "Workspace Shell 2" });

    expect(tablist).toHaveClass("bottom-terminal-tabs");
    expect(firstTab).toHaveAttribute("aria-selected", "true");
    expect(secondTab).toHaveAttribute("aria-selected", "false");

    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: "ArrowRight" });

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_2");
    });

    expect(screen.getByRole("tab", { name: "Workspace Shell 2" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("closes an inactive terminal tab without switching to it first", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([
          {
            id: "term_1",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
          {
            id: "term_2",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell 2",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 2,
          },
        ]);
      }

      return Promise.resolve(undefined);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <TerminalPanel />
        </MemoryRouter>
      </Provider>
    );

    const inactiveTab = await screen.findByRole("tab", { name: "Workspace Shell 2" });
    const inactiveShell = inactiveTab.closest(".terminal-tab-shell");

    expect(inactiveShell).not.toBeNull();
    await user.click(within(inactiveShell as HTMLElement).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.close",
        {
          terminalId: "term_2",
        },
        undefined
      );
    });

    expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    expect(screen.queryByRole("tab", { name: "Workspace Shell 2" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Terminal Sessions" })).toBeNull();
  });

  it("shows an error toast when terminal creation fails", async () => {
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([]);
      }

      if (op === "terminal.create") {
        return Promise.reject(new Error("Terminal spawn failed: posix_spawnp failed."));
      }

      return Promise.resolve(undefined);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    await act(async () => {
      screen.getAllByRole("button", { name: "New Terminal" })[0]?.click();
    });

    await waitFor(() => {
      expect(store.get(toastsAtom)[0]).toMatchObject({
        kind: "error",
        title: "Could not create terminal",
        body: "Terminal spawn failed: posix_spawnp failed.",
      });
    });
  });

  it("ignores agent terminals and keeps the shell panel empty", async () => {
    const store = createStore();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockResolvedValue([]);

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    await act(async () => {
      handlers[0]?.(
        "workspace.ws-test.terminal.term_agent.created",
        { id: "term_agent", kind: "agent" },
        1
      );
    });

    expect(screen.getByText("No terminals")).toBeInTheDocument();
    expect(screen.queryByTestId("xterm-host")).not.toBeInTheDocument();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("shows shell and task terminals but excludes agent terminals", async () => {
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([
          {
            id: "term-shell",
            workspaceId: "ws-test",
            kind: "shell",
            title: "bash",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
          {
            id: "term-task",
            workspaceId: "ws-test",
            kind: "task",
            title: "Task: Verify",
            cwd: "/tmp/ws-test",
            argv: ["pnpm", "ci:verify"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 2,
          },
          {
            id: "term-agent",
            workspaceId: "ws-test",
            kind: "agent",
            title: "Codex",
            cwd: "/tmp/ws-test",
            argv: ["codex"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 3,
          },
        ]);
      }

      return Promise.resolve([]);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    expect((await screen.findAllByText(/bash/i)).length).toBeGreaterThan(0);
    expect(screen.getByText("Task: Verify")).toBeInTheDocument();
    expect(screen.queryByText("Codex")).not.toBeInTheDocument();
  });

  it("renders the empty-state create action with shared button compatibility classes", async () => {
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockResolvedValue([]);

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    const emptyState = await screen.findByText("No terminals");
    const emptyPanel = emptyState.closest(".bottom-terminal-empty");
    expect(emptyPanel).not.toBeNull();
    expect(document.querySelector(".bottom-terminal-empty")).toBeTruthy();
    expect(
      (emptyPanel as HTMLElement).querySelector('[data-icon-semantic="state.emptyTerminal"]')
    ).toBeTruthy();
    expect(
      within(emptyPanel as HTMLElement).getByText(
        "Launch a shell to inspect files and run commands."
      )
    ).toHaveClass("bottom-terminal-empty-hint");

    expect(
      within(emptyPanel as HTMLElement).getByRole("button", { name: "New Terminal" })
    ).toHaveClass("btn", "btn-primary", "btn-sm");
    expect(
      (emptyPanel as HTMLElement).querySelector('[data-icon-semantic="terminal.action.new"]')
    ).toBeTruthy();
  });

  it("mutates the current workspace terminal state after switching workspaces", async () => {
    const store = createStore();
    const subscribe = vi.fn(() => () => {});
    const sendCommand = vi
      .fn()
      .mockImplementation((op: string, args?: { workspaceId?: string }) => {
        if (op === "terminal.list") {
          if (args?.workspaceId === "ws-2") {
            return Promise.resolve([
              {
                id: "term-2a",
                workspaceId: "ws-2",
                kind: "shell",
                title: "Workspace Shell 2",
                cwd: "/tmp/ws-2",
                argv: ["/bin/bash"],
                cols: 120,
                rows: 30,
                alive: true,
                createdAt: 2,
              },
            ]);
          }

          return Promise.resolve([
            {
              id: "term-1a",
              workspaceId: "ws-1",
              kind: "shell",
              title: "Workspace Shell 1",
              cwd: "/tmp/ws-1",
              argv: ["/bin/bash"],
              cols: 120,
              rows: 30,
              alive: true,
              createdAt: 1,
            },
          ]);
        }

        if (op === "terminal.close") {
          return Promise.resolve(true);
        }

        return Promise.resolve(undefined);
      });

    seedReadyWorkspaceState(store, {
      "ws-1": {
        id: "ws-1",
        path: "/tmp/ws-1",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
      "ws-2": {
        id: "ws-2",
        path: "/tmp/ws-2",
        targetRuntime: "native",
        openedAt: 2,
        lastActiveAt: 2,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    const { result, rerender } = renderHook(() => useTerminalActions(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    });

    await waitFor(() => {
      expect(store.get(terminalIdsAtomFamily("ws-1"))).toEqual(["term-1a"]);
      expect(store.get(terminalActiveIdAtomFamily("ws-1"))).toBe("term-1a");
    });

    await act(async () => {
      store.set(activeWorkspaceIdAtom, "ws-2");
      rerender();
    });

    await waitFor(() => {
      expect(store.get(terminalIdsAtomFamily("ws-2"))).toEqual(["term-2a"]);
      expect(store.get(terminalActiveIdAtomFamily("ws-2"))).toBe("term-2a");
    });

    await act(async () => {
      await result.current.handleCloseTerminal("term-2a");
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "terminal.close",
      { terminalId: "term-2a" },
      undefined
    );
    expect(store.get(terminalIdsAtomFamily("ws-1"))).toEqual(["term-1a"]);
    expect(store.get(terminalActiveIdAtomFamily("ws-1"))).toBe("term-1a");
    expect(store.get(terminalIdsAtomFamily("ws-2"))).toEqual([]);
    expect(store.get(terminalActiveIdAtomFamily("ws-2"))).toBeNull();
  });

  it("caches terminal output to atom for shell terminals before xterm-host subscribes", async () => {
    const store = createStore();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockResolvedValue([]);

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    // Set terminal meta before output arrives
    const terminalMeta: TerminalMeta = {
      id: "term_output",
      workspaceId: "ws-test",
      kind: "shell",
      alive: true,
      title: "Shell",
    };
    store.set(terminalMetaAtomFamily("term_output"), terminalMeta);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    // Simulate output event arriving before xterm-host subscribes
    const outputBytes = new TextEncoder().encode("hello from shell\n");
    await act(async () => {
      handlers[0]?.(
        "workspace.ws-test.terminal.term_output.output",
        { transport: "binary", streamId: 1, size: outputBytes.length, bytes: outputBytes },
        18
      );
    });

    // Verify output is cached in the atom
    const outputState = store.get(terminalOutputAtomFamily("term_output"));
    expect(outputState.chunks).toHaveLength(1);
    expect(outputState.chunks[0]).toEqual(outputBytes);
    expect(outputState.lastSeq).toBe(18);

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("leaves the mobile fullscreen title slot blank when no terminal exists", async () => {
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockResolvedValue([]);

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);
    render(
      <Provider store={store}>
        <MemoryRouter>
          <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
            <TerminalPanel chrome="mobile-fullscreen" />
          </div>
        </MemoryRouter>
      </Provider>
    );

    expect(
      document.querySelector(".bottom-terminal--mobile-fullscreen .terminal-toolbar")
    ).toBeTruthy();
    expect(
      document.querySelector(".bottom-terminal--mobile-fullscreen .terminal-toolbar-mobile-row")
    ).toBeTruthy();
    expect(
      document.querySelector(
        ".bottom-terminal--mobile-fullscreen .terminal-toolbar-mobile-placeholder"
      )
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close Terminal" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New Terminal" }).length).toBeGreaterThan(0);
  });

  it("renders the mobile fullscreen terminal toolbar as a single compact chrome row", async () => {
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([
          {
            id: "term_1",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
          {
            id: "term_2",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell 2",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 2,
          },
        ]);
      }

      return Promise.resolve([]);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
            <TerminalPanel chrome="mobile-fullscreen" />
          </div>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    });

    const toolbar = document.querySelector(".bottom-terminal--mobile-fullscreen .terminal-toolbar");
    const mobileRow = document.querySelector(
      ".bottom-terminal--mobile-fullscreen .terminal-toolbar-mobile-row"
    );
    const selector = document.querySelector(
      ".bottom-terminal--mobile-fullscreen .terminal-selector"
    );
    const actions = document.querySelector(
      ".bottom-terminal--mobile-fullscreen .terminal-toolbar-actions"
    );

    expect(toolbar).toBeTruthy();
    expect(mobileRow).toBeTruthy();
    expect(toolbar?.querySelector(".terminal-toolbar-left")).toBeNull();
    expect(toolbar?.querySelector(".terminal-toolbar-right")).toBeNull();
    expect(selector).toBeTruthy();
    expect(actions).toBeTruthy();
  });

  it("renders a static mobile fullscreen title when only one terminal exists", async () => {
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([
          {
            id: "term_1",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
        ]);
      }

      return Promise.resolve([]);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
            <TerminalPanel chrome="mobile-fullscreen" />
          </div>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    });

    expect(screen.getByText("Workspace Shell")).toBeInTheDocument();
    expect(
      document.querySelector(".bottom-terminal--mobile-fullscreen .terminal-selector-btn--static")
    ).toBeTruthy();
    expect(
      document.querySelector(
        ".bottom-terminal--mobile-fullscreen .terminal-toolbar-mobile-placeholder"
      )
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Close Terminal" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New Terminal" }).length).toBeGreaterThan(0);
  });

  it("keeps mobile fullscreen terminal actions together in the toolbar when header actions are available", async () => {
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([
          {
            id: "term_1",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
          {
            id: "term_2",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell 2",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 2,
          },
        ]);
      }

      return Promise.resolve([]);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    function HeaderActionHarness() {
      const [headerActions, setHeaderActions] = useState<ReactNode>(null);

      return (
        <>
          <div data-testid="terminal-header-actions">{headerActions}</div>
          <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
            <TerminalPanel
              chrome="mobile-fullscreen"
              onMobileHeaderActionsChange={setHeaderActions}
            />
          </div>
        </>
      );
    }

    render(
      <Provider store={store}>
        <MemoryRouter>
          <HeaderActionHarness />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    });

    const headerActions = screen.getByTestId("terminal-header-actions");
    const toolbar = document.querySelector(
      ".bottom-terminal--mobile-fullscreen .terminal-toolbar"
    ) as HTMLElement | null;

    expect(
      within(headerActions).queryByRole("button", { name: "New Terminal" })
    ).not.toBeInTheDocument();
    expect(
      within(headerActions).queryByRole("button", { name: "Close Terminal" })
    ).not.toBeInTheDocument();
    expect(toolbar).toBeTruthy();
    expect(
      within(toolbar as HTMLElement).getByRole("button", { name: "Close Terminal" })
    ).toBeInTheDocument();
    expect(
      within(toolbar as HTMLElement).getByRole("button", { name: "New Terminal" })
    ).toBeInTheDocument();
    expect(
      document.querySelector(".bottom-terminal--mobile-fullscreen .terminal-selector")
    ).toBeTruthy();
    expect(
      document.querySelectorAll(".bottom-terminal--mobile-fullscreen .terminal-toolbar-actions")
    ).toHaveLength(2);
  });

  it("keeps only one terminal switcher in mobile fullscreen mode", async () => {
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([
          {
            id: "term_1",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
          {
            id: "term_2",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell 2",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 2,
          },
        ]);
      }

      return Promise.resolve([]);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
            <TerminalPanel chrome="mobile-fullscreen" />
          </div>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    });

    expect(document.querySelectorAll(".terminal-selector-btn")).toHaveLength(1);
    expect(document.querySelector(".bottom-terminal-tabs")).not.toBeInTheDocument();
  });

  it("uses MobileSelectSheet for the mobile terminal selector", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([
          {
            id: "term_1",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
          {
            id: "term_2",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell 2",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 2,
          },
        ]);
      }

      return Promise.resolve([]);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
            <TerminalPanel chrome="mobile-fullscreen" />
          </div>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    });

    const trigger = screen.getByRole("button", { name: "Switch terminal" });
    expect(trigger).toHaveAccessibleName("Switch terminal");
    expect(trigger).toHaveClass("terminal-selector-btn", "input", "mobile-select-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(screen.getByRole("region", { name: "Terminal Sessions sheet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch terminal" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(
      screen.getByRole("button", {
        name: "Workspace Shell",
        description: "Current terminal",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Workspace Shell 2",
        description: "Terminal 2",
      })
    ).toBeInTheDocument();
    expect(document.querySelector(".terminal-selector-dropdown")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch terminal Workspace Shell" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Switch terminal" }));
    expect(
      screen.queryByRole("region", { name: "Terminal Sessions sheet" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch terminal" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    await user.click(screen.getByRole("button", { name: "Switch terminal" }));
    await user.click(
      screen.getByRole("button", {
        name: "Workspace Shell 2",
        description: "Terminal 2",
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_2");
    });

    const updatedTrigger = screen.getByRole("button", { name: "Switch terminal" });
    expect(updatedTrigger).toHaveTextContent("Workspace Shell 2");
    expect(updatedTrigger).toHaveAccessibleName("Switch terminal");
    expect(updatedTrigger).toHaveAttribute("aria-expanded", "false");
  });

  it("uses Popover for the desktop terminal selector open/select/close flow", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([
          {
            id: "term_1",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
          {
            id: "term_2",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell 2",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 2,
          },
        ]);
      }

      return Promise.resolve([]);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <TerminalPanel />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    });

    const getSelectorTrigger = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(".terminal-selector-btn"))[0];

    const trigger = getSelectorTrigger();
    expect(trigger).toBeTruthy();
    expect(trigger).toHaveTextContent("Workspace Shell");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger!);

    const dialog = screen.getByRole("dialog", { name: "Terminal Sessions" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog).toHaveClass("terminal-selector-dropdown");
    expect(document.body).toContainElement(dialog);
    expect(getSelectorTrigger()).toHaveAttribute("aria-expanded", "true");

    await user.click(within(dialog).getByRole("button", { name: "Workspace Shell 2" }));

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_2");
    });

    expect(screen.queryByRole("dialog", { name: "Terminal Sessions" })).toBeNull();
    expect(getSelectorTrigger()).toHaveTextContent("Workspace Shell 2");
    expect(getSelectorTrigger()).toHaveAttribute("aria-expanded", "false");

    await user.click(getSelectorTrigger()!);
    expect(screen.getByRole("dialog", { name: "Terminal Sessions" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Terminal Sessions" })).toBeNull();
    expect(getSelectorTrigger()).toHaveAttribute("aria-expanded", "false");

    await user.click(getSelectorTrigger()!);
    expect(screen.getByRole("dialog", { name: "Terminal Sessions" })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Terminal Sessions" })).toBeNull();
    expect(getSelectorTrigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes an inactive terminal from the desktop selector close action", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([
          {
            id: "term_1",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          },
          {
            id: "term_2",
            workspaceId: "ws-test",
            kind: "shell",
            title: "Workspace Shell 2",
            cwd: "/tmp/ws-test",
            argv: ["/bin/bash"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 2,
          },
        ]);
      }

      return Promise.resolve(undefined);
    });

    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/tmp/ws-test",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(bottomPanelHeightAtom, 240);
    setEnglishLocale(store);
    store.set(wsClientAtom, { subscribe, sendCommand } as never);

    render(
      <Provider store={store}>
        <MemoryRouter>
          <TerminalPanel />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    });

    const trigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".terminal-selector-btn")
    )[0];
    expect(trigger).toBeTruthy();

    await user.click(trigger!);

    const dialog = screen.getByRole("dialog", { name: "Terminal Sessions" });
    const inactiveItem = within(dialog)
      .getByText("Workspace Shell 2")
      .closest(".terminal-selector-item");

    expect(inactiveItem).not.toBeNull();

    await user.click(within(inactiveItem as HTMLElement).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.close",
        {
          terminalId: "term_2",
        },
        undefined
      );
    });

    expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    expect(screen.queryByRole("dialog", { name: "Terminal Sessions" })).toBeNull();
    expect(Array.from(document.querySelectorAll(".terminal-selector-btn"))[0]).toHaveTextContent(
      "Workspace Shell"
    );
  });
});
