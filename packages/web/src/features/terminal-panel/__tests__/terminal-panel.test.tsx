import { type TaskDefinition, Topics } from "@coder-studio/core";
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

  const buildTask = (
    overrides: Partial<TaskDefinition> & Pick<TaskDefinition, "id" | "label" | "displayCommand">
  ): TaskDefinition => ({
    id: overrides.id,
    workspaceId: "ws-test",
    kind: "custom",
    label: overrides.label,
    command: "pnpm",
    args: [overrides.id],
    displayCommand: overrides.displayCommand,
    cwdPath: ".",
    source: "package-json",
    priority: 100,
    ...overrides,
  });

  it("keeps rendering when the first terminal is created after mount", async () => {
    const store = createStore();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([]);
      }

      if (op === "terminal.profiles.list") {
        return Promise.resolve({
          profiles: [
            {
              id: "detected:zsh",
              label: "zsh",
              source: "detected",
              runtime: "native",
              icon: "terminal",
            },
            {
              id: "custom:ops",
              label: "Ops Shell",
              source: "custom",
              runtime: "native",
              icon: "rocket",
            },
          ],
          configuredDefaultProfileId: "custom:ops",
          resolvedDefaultProfileId: "custom:ops",
        });
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

    expect(sendCommand).toHaveBeenCalledWith("terminal.profiles.list", {}, undefined);
    expect(sendCommand).toHaveBeenCalledWith(
      "terminal.create",
      expect.objectContaining({
        workspaceId: "ws-test",
        profileId: "custom:ops",
        themeBackground: expect.any(String),
      }),
      undefined
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_2");
    });
    const lastXtermHostCall = mockXtermHost.mock.calls[mockXtermHost.mock.calls.length - 1];
    expect(lastXtermHostCall?.[0]).toEqual(
      expect.objectContaining({
        terminalId: "term_2",
        terminalKind: "shell",
      })
    );
    expect(store.get(terminalIdsAtomFamily("ws-test"))).toEqual(["term_2"]);
    expect(store.get(terminalActiveIdAtomFamily("ws-test"))).toBe("term_2");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("launches the resolved default profile from the desktop toolbar primary create action", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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

      if (op === "terminal.profiles.list") {
        return Promise.resolve({
          profiles: [
            {
              id: "detected:win:powershell",
              label: "PowerShell",
              source: "detected",
              runtime: "native",
              icon: "terminal",
            },
            {
              id: "detected:win:git-bash",
              label: "Git Bash",
              source: "detected",
              runtime: "native",
              icon: "terminal",
            },
          ],
          configuredDefaultProfileId: "detected:win:git-bash",
          resolvedDefaultProfileId: "detected:win:git-bash",
        });
      }

      if (op === "terminal.create") {
        return Promise.resolve({
          id: "term_git_bash",
          workspaceId: "ws-test",
          kind: "shell",
          title: "Git Bash",
          cwd: "/tmp/ws-test",
          argv: ["C:/Program Files/Git/bin/bash.exe"],
          cols: 120,
          rows: 30,
          alive: true,
          createdAt: 2,
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
        <MemoryRouter>
          <TerminalPanel />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    });

    const toolbarRight = document.querySelector(".terminal-toolbar-right");
    expect(toolbarRight).not.toBeNull();

    await user.click(
      within(toolbarRight as HTMLElement).getByRole("button", { name: "New Terminal" })
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.create",
        expect.objectContaining({
          workspaceId: "ws-test",
          profileId: "detected:win:git-bash",
          themeBackground: expect.any(String),
        }),
        undefined
      );
    });
  });

  it("exposes alternate profiles from the desktop profile chooser", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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

      if (op === "terminal.profiles.list") {
        return Promise.resolve({
          profiles: [
            {
              id: "detected:win:powershell",
              label: "PowerShell",
              source: "detected",
              runtime: "native",
              icon: "terminal",
            },
            {
              id: "detected:win:git-bash",
              label: "Git Bash",
              source: "detected",
              runtime: "native",
              icon: "terminal",
            },
            {
              id: "custom:ops",
              label: "Ops Shell",
              source: "custom",
              runtime: "native",
              icon: "rocket",
            },
          ],
          configuredDefaultProfileId: "detected:win:powershell",
          resolvedDefaultProfileId: "detected:win:powershell",
        });
      }

      if (op === "terminal.create") {
        return Promise.resolve({
          id: "term_git_bash",
          workspaceId: "ws-test",
          kind: "shell",
          title: "Git Bash",
          cwd: "/tmp/ws-test",
          argv: ["C:/Program Files/Git/bin/bash.exe"],
          cols: 120,
          rows: 30,
          alive: true,
          createdAt: 2,
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
        <MemoryRouter>
          <TerminalPanel />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    });
    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("terminal.profiles.list", {}, undefined);
    });

    const toolbarRight = document.querySelector(".terminal-toolbar-right");
    expect(toolbarRight).not.toBeNull();
    const createButtonGroup = (toolbarRight as HTMLElement).querySelector(
      ".terminal-profile-create-button"
    );
    expect(createButtonGroup).not.toBeNull();
    expect(createButtonGroup).toHaveStyle({ gap: "2px" });

    await user.click(
      within(toolbarRight as HTMLElement).getByRole("button", {
        name: "Choose Terminal Profile",
      })
    );

    const chooser = screen.getByRole("dialog", { name: "New Terminal" });
    expect(within(chooser).getByText("Detected")).toBeInTheDocument();
    expect(within(chooser).getByText("Custom")).toBeInTheDocument();
    expect(within(chooser).getByRole("button", { name: /Git Bash/ })).toBeInTheDocument();
    expect(within(chooser).getByRole("button", { name: /Ops Shell/ })).toBeInTheDocument();
    expect(
      within(chooser).getByRole("link", { name: "Configure Terminal Profiles..." })
    ).toHaveAttribute("href", "/more/settings/terminal#terminal-profiles");
    expect(within(chooser).queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();

    await user.click(within(chooser).getByRole("button", { name: /Git Bash/ }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.create",
        expect.objectContaining({
          workspaceId: "ws-test",
          profileId: "detected:win:git-bash",
          themeBackground: expect.any(String),
        }),
        undefined
      );
    });
  });

  it("opens a mobile profile chooser with an explicit default action before other profiles", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendCommand = vi.fn().mockImplementation((op: string) => {
      if (op === "terminal.list") {
        return Promise.resolve([]);
      }

      if (op === "terminal.profiles.list") {
        return Promise.resolve({
          profiles: [
            {
              id: "detected:zsh",
              label: "zsh",
              source: "detected",
              runtime: "native",
              icon: "terminal",
            },
            {
              id: "custom:ops",
              label: "Ops Shell",
              source: "custom",
              runtime: "native",
              icon: "rocket",
            },
            {
              id: "custom:python",
              label: "Python Env",
              source: "custom",
              runtime: "native",
              icon: "code",
            },
          ],
          configuredDefaultProfileId: "custom:ops",
          resolvedDefaultProfileId: "custom:ops",
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
        <MemoryRouter>
          <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
            <TerminalPanel chrome="mobile-fullscreen" />
          </div>
        </MemoryRouter>
      </Provider>
    );

    await user.click(screen.getAllByRole("button", { name: "New Terminal" })[0]!);

    const chooser = screen.getByRole("region", { name: "New Terminal sheet" });
    const profileButtons = ["Open Default: Ops Shell", "zsh", "Python Env"].map((name) =>
      within(chooser).getByRole("button", { name })
    );

    expect(profileButtons[0]).toHaveTextContent("Open Default: Ops Shell");
    expect(profileButtons[1]).toHaveTextContent("zsh");
    expect(profileButtons[2]).toHaveTextContent("Python Env");
    expect(within(chooser).queryByRole("button", { name: "Ops Shell" })).not.toBeInTheDocument();

    act(() => {
      store.set(localeAtom, "zh");
    });

    await waitFor(() => {
      expect(
        within(chooser).getByRole("button", { name: "打开默认配置：Ops Shell" })
      ).toBeInTheDocument();
    });
  });

  it("opens package commands from the toolbar button next to new terminal", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const buildScriptBody =
      "vite build --mode production && tsc -p tsconfig.json --noEmit --pretty false";
    const tasks = [
      buildTask({
        id: "dev",
        label: "dev",
        displayCommand: "vite --host 0.0.0.0",
      }),
      buildTask({
        id: "build",
        label: "build",
        displayCommand: buildScriptBody,
      }),
    ];
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
      handlers.push(handler);
      return () => {
        handlers = handlers.filter((candidate) => candidate !== handler);
      };
    });
    const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
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

      if (op === "task.list") {
        return Promise.resolve(tasks);
      }

      if (op === "task.history") {
        return Promise.resolve([]);
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
    store.set(wsClientAtom, { subscribe, sendCommand, sendTerminalInput } as never);

    render(
      <Provider store={store}>
        <TerminalPanel />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    });

    const toolbarRight = document.querySelector(".terminal-toolbar-right");
    const toolbarButtons = within(toolbarRight as HTMLElement).getAllByRole("button");
    const newTerminalIndex = toolbarButtons.findIndex(
      (button) => button.getAttribute("aria-label") === "New Terminal"
    );
    const profileChooserIndex = toolbarButtons.findIndex(
      (button) => button.getAttribute("aria-label") === "Choose Terminal Profile"
    );
    const commandButtonIndex = toolbarButtons.findIndex(
      (button) => button.getAttribute("aria-label") === "Open Commands"
    );
    expect(profileChooserIndex).toBe(newTerminalIndex + 1);
    expect(commandButtonIndex).toBe(profileChooserIndex + 1);
    const commandButton = toolbarButtons[commandButtonIndex]!;

    await user.click(commandButton);

    const sidePanel = await screen.findByRole("complementary", { name: "Managed commands" });
    expect(sidePanel).toHaveClass("terminal-command-side-panel");
    expect(within(sidePanel).getByText("Managed commands")).toBeInTheDocument();
    expect(within(sidePanel).queryByRole("heading", { name: "Commands" })).not.toBeInTheDocument();
    expect(sidePanel.querySelector(".terminal-command-side-panel__list")).toHaveClass(
      "terminal-command-side-panel__list--scroll"
    );
    expect(within(sidePanel).getByText("pnpm dev")).toBeInTheDocument();
    const buildCommand = within(sidePanel).getByText("pnpm build");
    expect(buildCommand).toBeInTheDocument();
    expect(buildCommand.closest(".terminal-command-side-panel__row")).toHaveAttribute(
      "title",
      "pnpm build"
    );

    await user.click(within(sidePanel).getByRole("button", { name: "Insert build" }));

    await waitFor(() => {
      expect(sendTerminalInput).toHaveBeenCalledTimes(1);
    });
    const [terminalId, bytes, activity, submittedText] = sendTerminalInput.mock.calls[0]!;
    expect(terminalId).toBe("term_1");
    expect(new TextDecoder().decode(bytes)).toBe("pnpm build");
    expect(activity).toBe("typing");
    expect(submittedText).toBeUndefined();
    expect(sendCommand).not.toHaveBeenCalledWith("task.run", expect.anything(), expect.anything());
    expect(store.get(terminalActiveIdAtomFamily("ws-test"))).toBe("term_1");
  });

  it("does not render the desktop terminal tab bar and keeps selector switching", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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

    expect(screen.queryByRole("tablist", { name: "Terminal Sessions" })).toBeNull();
    expect(document.querySelector(".bottom-terminal-tabs")).not.toBeInTheDocument();

    const selectorTrigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".terminal-selector-btn")
    )[0];
    expect(selectorTrigger).toBeTruthy();

    await user.click(selectorTrigger!);
    await user.click(screen.getByRole("button", { name: "Workspace Shell 2" }));

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_2");
    });
  });

  it("does not render desktop terminal tab close controls for inactive terminals", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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

    expect(screen.queryByRole("tab", { name: "Workspace Shell 2" })).toBeNull();
    expect(document.querySelector(".terminal-tab-shell")).not.toBeInTheDocument();

    const selectorTrigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".terminal-selector-btn")
    )[0];
    expect(selectorTrigger).toBeTruthy();

    await user.click(selectorTrigger!);
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
  });

  it("renders a static desktop terminal title when only one terminal exists", async () => {
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
            title: "/bin/zsh",
            cwd: "/tmp/ws-test",
            argv: ["/bin/zsh"],
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
          <TerminalPanel />
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("xterm-host")).toHaveTextContent("term_1");
    });

    expect(document.querySelector(".terminal-selector-btn--static")).toHaveTextContent("zsh — 1");
    expect(
      document.querySelector(
        ".terminal-selector-btn--static svg, .terminal-selector-btn--static .lucide"
      )
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "zsh — 1" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "New Terminal" }));
    expect(sendCommand).toHaveBeenCalledWith(
      "terminal.create",
      expect.objectContaining({
        workspaceId: "ws-test",
        cwdPath: undefined,
        themeBackground: expect.any(String),
      }),
      undefined
    );
  });

  it("shows an error toast when terminal creation fails", async () => {
    const store = createStore();
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const user = userEvent.setup();
    const store = createStore();
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    expect(screen.queryByRole("tablist", { name: "Terminal Sessions" })).toBeNull();

    const selectorTrigger = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".terminal-selector-btn")
    )[0];
    expect(selectorTrigger).toBeTruthy();

    await user.click(selectorTrigger!);

    const dialog = screen.getByRole("dialog", { name: "Terminal Sessions" });
    expect(within(dialog).getByRole("button", { name: /Task: Verify/ })).toBeInTheDocument();
    expect(within(dialog).queryByText("Codex")).not.toBeInTheDocument();
  });

  it("renders the empty-state create action with shared button compatibility classes", async () => {
    const store = createStore();
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
    const subscribe = vi.fn((_topics: string[], handler: EventHandler) => {
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
