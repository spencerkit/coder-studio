import type { DiagnosticsCheck, DiagnosticsResponse, Workspace } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activationStatusAtom } from "../../atoms/activation";
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
    expect(document.querySelector(".diagnostics-summary--mobile")).not.toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "Environment diagnostics" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).toBeNull();
    expect(document.querySelector(".welcome-card")).toBeNull();
  });

  it("shows git and nodejs diagnostics with current versions on manual check", async () => {
    const sendCommand = vi.fn().mockResolvedValue(
      createResponse(
        {
          context: "manual_check",
          canContinue: true,
        },
        [
          {
            id: "git-ready",
            code: "git_ready",
            status: "ready",
            version: "git version 2.49.0",
          },
          {
            id: "nodejs-ready",
            code: "nodejs_ready",
            status: "ready",
            version: "v24.1.0",
          },
        ] as DiagnosticsCheck[]
      )
    );

    renderDiagnostics("/diagnostics?context=manual_check", sendCommand);

    expect(await screen.findByText("Git is ready")).toBeInTheDocument();
    expect(screen.getByText("Node.js is ready")).toBeInTheDocument();
    expect(screen.getByText("Current version: git version 2.49.0")).toBeInTheDocument();
    expect(screen.getByText("Current version: v24.1.0")).toBeInTheDocument();
  });

  it("installs a missing git dependency inline, accepts a sudo password, and rechecks on success", async () => {
    let diagnosticsCallCount = 0;
    let subscriptionHandler: ((topic: string, payload: unknown) => void) | undefined;
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get" || op === "diagnostics.recheck") {
        diagnosticsCallCount += 1;
        if (diagnosticsCallCount === 1) {
          return createResponse({ context: "manual_check", canContinue: false }, [
            {
              id: "git-missing",
              code: "git_missing",
              status: "needs_attention",
              dependencyId: "git",
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: ["system_deps.install.git.manual"],
              docUrl: "https://git-scm.com/downloads",
            },
          ] as DiagnosticsCheck[]);
        }

        return createResponse({ context: "manual_check", canContinue: true }, [
          {
            id: "git-ready",
            code: "git_ready",
            status: "ready",
            dependencyId: "git",
            version: "git version 2.49.0",
          },
        ] as DiagnosticsCheck[]);
      }

      if (op === "systemDeps.install.start") {
        expect(args).toEqual({ dependencyId: "git" });
        return {
          jobId: "job-1",
          dependencyId: "git",
          status: "waiting_input",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [],
          interaction: {
            kind: "sudo_password",
            promptExcerpt: "[sudo] password for spencer:",
            echo: false,
          },
        };
      }

      if (op === "systemDeps.install.input") {
        expect(args).toEqual({ jobId: "job-1", text: "hunter2\n" });
        return {
          jobId: "job-1",
          dependencyId: "git",
          status: "running",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [],
          interaction: { kind: "none", echo: false },
        };
      }

      if (op === "systemDeps.install.get") {
        return {
          jobId: "job-1",
          dependencyId: "git",
          status: "succeeded",
          packageManager: "apt-get",
          currentStepId: "verify-git",
          steps: [],
          interaction: { kind: "none", echo: false },
        };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    const store = createStoreWithClient(sendCommand);
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn((_topics: string[], handler: (topic: string, payload: unknown) => void) => {
        subscriptionHandler = handler;
        return () => {
          subscriptionHandler = undefined;
        };
      }),
    } as never);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/diagnostics?context=manual_check"]}>
          <Routes>
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByText("Git is missing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install Git" }));
    expect(await screen.findByText("Package manager: apt-get")).toBeInTheDocument();
    expect(screen.getByLabelText("Administrator password")).toHaveAttribute("type", "password");

    act(() => {
      subscriptionHandler?.("systemDeps.install.job-1.output", {
        jobId: "job-1",
        chunk: "downloading git\n",
        seq: 1,
      });
    });

    expect(await screen.findByText("downloading git")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Administrator password"), {
      target: { value: "hunter2" },
    });
    fireEvent.submit(screen.getByTestId("system-dependency-password-form"));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "systemDeps.install.get",
        { jobId: "job-1" },
        undefined
      );
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "diagnostics.recheck",
      {
        context: "manual_check",
        workspaceId: undefined,
        workspacePath: undefined,
        providerId: undefined,
      },
      undefined
    );
    expect(await screen.findByText("Git is ready")).toBeInTheDocument();
  });

  it("keeps polling while waiting for input so a failed install converges without new output", async () => {
    let installGetCalls = 0;
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get") {
        return createResponse({ context: "manual_check", canContinue: false }, [
          {
            id: "git-missing",
            code: "git_missing",
            status: "needs_attention",
            dependencyId: "git",
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: ["system_deps.install.git.manual"],
            docUrl: "https://git-scm.com/downloads",
          },
        ] as DiagnosticsCheck[]);
      }

      if (op === "systemDeps.install.start") {
        expect(args).toEqual({ dependencyId: "git" });
        return {
          jobId: "job-waiting",
          dependencyId: "git",
          status: "waiting_input",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [
            {
              id: "install-git",
              titleKey: "system_deps.install.step.install.git",
              kind: "install",
              command: "/bin/sh",
              args: ["-lc", "sudo apt-get install -y git"],
              status: "running",
              startedAt: 1,
            },
          ],
          interaction: {
            kind: "sudo_password",
            promptExcerpt: "[sudo] password for spencer:",
            echo: false,
          },
        };
      }

      if (op === "systemDeps.install.get") {
        installGetCalls += 1;
        if (installGetCalls === 1) {
          return {
            jobId: "job-waiting",
            dependencyId: "git",
            status: "waiting_input",
            packageManager: "apt-get",
            currentStepId: "install-git",
            steps: [
              {
                id: "install-git",
                titleKey: "system_deps.install.step.install.git",
                kind: "install",
                command: "/bin/sh",
                args: ["-lc", "sudo apt-get install -y git"],
                status: "running",
                startedAt: 1,
              },
            ],
            interaction: {
              kind: "sudo_password",
              promptExcerpt: "[sudo] password for spencer:",
              echo: false,
            },
          };
        }

        return {
          jobId: "job-waiting",
          dependencyId: "git",
          status: "failed",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [
            {
              id: "install-git",
              titleKey: "system_deps.install.step.install.git",
              kind: "install",
              command: "/bin/sh",
              args: ["-lc", "sudo apt-get install -y git"],
              status: "failed",
              startedAt: 1,
              finishedAt: 2,
              exitCode: 1,
              stderrExcerpt: "sudo: 3 incorrect password attempts",
            },
          ],
          interaction: { kind: "none", echo: false },
          failure: {
            code: "permission_denied",
            dependencyId: "git",
            failedStepId: "install-git",
            message: "Install failed for git",
            command: "/bin/sh",
            args: ["-lc", "sudo apt-get install -y git"],
            exitCode: 1,
            packageManager: "apt-get",
            manualGuideKeys: ["system_deps.install.git.manual"],
            docUrl: "https://git-scm.com/downloads",
            stderrExcerpt: "sudo: 3 incorrect password attempts",
          },
        };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    renderDiagnostics("/diagnostics?context=manual_check", sendCommand);

    expect(await screen.findByText("Git is missing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install Git" }));
    expect(await screen.findByText("Package manager: apt-get")).toBeInTheDocument();

    await screen.findByText("Install failed");
    await waitFor(() => {
      expect(installGetCalls).toBeGreaterThanOrEqual(2);
    });

    expect(screen.getByText(/Failure reason:\s*Permission denied/)).toBeInTheDocument();
    expect(screen.getByText(/sudo: 3 incorrect password attempts/)).toBeInTheDocument();
  });

  it("disables the install action while an install is already active", async () => {
    let startCalls = 0;
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get") {
        return createResponse({ context: "manual_check", canContinue: false }, [
          {
            id: "git-missing",
            code: "git_missing",
            status: "needs_attention",
            dependencyId: "git",
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: ["system_deps.install.git.manual"],
            docUrl: "https://git-scm.com/downloads",
          },
        ] as DiagnosticsCheck[]);
      }

      if (op === "systemDeps.install.start") {
        startCalls += 1;
        expect(args).toEqual({ dependencyId: "git" });
        return {
          jobId: "job-active",
          dependencyId: "git",
          status: "waiting_input",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [],
          interaction: {
            kind: "sudo_password",
            promptExcerpt: "[sudo] password for spencer:",
            echo: false,
          },
        };
      }

      if (op === "systemDeps.install.get") {
        return {
          jobId: "job-active",
          dependencyId: "git",
          status: "waiting_input",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [],
          interaction: {
            kind: "sudo_password",
            promptExcerpt: "[sudo] password for spencer:",
            echo: false,
          },
        };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    renderDiagnostics("/diagnostics?context=manual_check", sendCommand);

    const installButton = await screen.findByRole("button", { name: "Install Git" });
    expect(installButton).toBeEnabled();

    fireEvent.click(installButton);

    expect(await screen.findByText("Package manager: apt-get")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install Git" })).toBeDisabled();
    expect(startCalls).toBe(1);
  });

  it("blocks starting a second dependency install while another dependency install is active", async () => {
    const startCalls: string[] = [];
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get") {
        return createResponse({ context: "manual_check", canContinue: false }, [
          {
            id: "git-missing",
            code: "git_missing",
            status: "needs_attention",
            dependencyId: "git",
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: ["system_deps.install.git.manual"],
            docUrl: "https://git-scm.com/downloads",
          },
          {
            id: "node-missing",
            code: "nodejs_missing",
            status: "needs_attention",
            dependencyId: "node",
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: ["system_deps.install.node.manual"],
            docUrl: "https://nodejs.org/en/download",
          },
        ] as DiagnosticsCheck[]);
      }

      if (op === "systemDeps.install.start") {
        const dependencyId = String(args?.dependencyId);
        startCalls.push(dependencyId);
        return {
          jobId: "job-global-guard",
          dependencyId,
          status: "waiting_input",
          packageManager: dependencyId === "git" ? "apt-get" : "brew",
          currentStepId: `install-${dependencyId}`,
          steps: [],
          interaction: {
            kind: "sudo_password",
            promptExcerpt: "[sudo] password for spencer:",
            echo: false,
          },
        };
      }

      if (op === "systemDeps.install.get") {
        return {
          jobId: "job-global-guard",
          dependencyId: "git",
          status: "waiting_input",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [],
          interaction: {
            kind: "sudo_password",
            promptExcerpt: "[sudo] password for spencer:",
            echo: false,
          },
        };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    renderDiagnostics("/diagnostics?context=manual_check", sendCommand);

    const installGitButton = await screen.findByRole("button", { name: "Install Git" });
    const installNodeButton = screen.getByRole("button", { name: "Install Node.js" });
    expect(installGitButton).toBeEnabled();
    expect(installNodeButton).toBeEnabled();

    fireEvent.click(installGitButton);

    expect(await screen.findByText("Package manager: apt-get")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install Git" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Install Node.js" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Install Node.js" }));
    expect(startCalls).toEqual(["git"]);
  });

  it("pauses failed polling while disconnected and resumes after reconnect", async () => {
    let disconnected = false;
    let installGetCalls = 0;
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "diagnostics.get") {
        return createResponse({ context: "manual_check", canContinue: false }, [
          {
            id: "git-missing",
            code: "git_missing",
            status: "needs_attention",
            dependencyId: "git",
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: ["system_deps.install.git.manual"],
            docUrl: "https://git-scm.com/downloads",
          },
        ] as DiagnosticsCheck[]);
      }

      if (op === "systemDeps.install.start") {
        return {
          jobId: "job-reconnect",
          dependencyId: "git",
          status: "running",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [],
          interaction: { kind: "none", echo: false },
        };
      }

      if (op === "systemDeps.install.get") {
        installGetCalls += 1;
        if (disconnected) {
          throw new Error("socket closed");
        }

        return {
          jobId: "job-reconnect",
          dependencyId: "git",
          status: "succeeded",
          packageManager: "apt-get",
          currentStepId: "verify-git",
          steps: [],
          interaction: { kind: "none", echo: false },
        };
      }

      if (op === "diagnostics.recheck") {
        return createResponse({ context: "manual_check", canContinue: true }, [
          {
            id: "git-ready",
            code: "git_ready",
            status: "ready",
            dependencyId: "git",
            version: "git version 2.49.0",
          },
        ] as DiagnosticsCheck[]);
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    const store = createStoreWithClient(sendCommand);
    store.set(activationStatusAtom, "active");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/diagnostics?context=manual_check"]}>
          <Routes>
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    expect(await screen.findByText("Git is missing")).toBeInTheDocument();
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install Git" }));
      await Promise.resolve();
    });

    act(() => {
      disconnected = true;
      store.set(connectionStatusAtom, "disconnected");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(installGetCalls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(installGetCalls).toBe(1);

    await act(async () => {
      disconnected = false;
      store.set(connectionStatusAtom, "connected");
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(installGetCalls).toBe(2);
    expect(sendCommand).toHaveBeenCalledWith(
      "diagnostics.recheck",
      {
        context: "manual_check",
        workspaceId: undefined,
        workspacePath: undefined,
        providerId: undefined,
      },
      undefined
    );
    expect(screen.getByText("Git is ready")).toBeInTheDocument();
  });

  it("stops polling after an install.get command error while still connected", async () => {
    let installGetCalls = 0;
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "diagnostics.get") {
        return createResponse({ context: "manual_check", canContinue: false }, [
          {
            id: "git-missing",
            code: "git_missing",
            status: "needs_attention",
            dependencyId: "git",
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: ["system_deps.install.git.manual"],
            docUrl: "https://git-scm.com/downloads",
          },
        ] as DiagnosticsCheck[]);
      }

      if (op === "systemDeps.install.start") {
        return {
          jobId: "job-command-error",
          dependencyId: "git",
          status: "running",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [],
          interaction: { kind: "none", echo: false },
        };
      }

      if (op === "systemDeps.install.get") {
        installGetCalls += 1;
        throw new Error("job lookup failed");
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    renderDiagnostics("/diagnostics?context=manual_check", sendCommand);

    expect(await screen.findByText("Git is missing")).toBeInTheDocument();
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install Git" }));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });

    expect(installGetCalls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(installGetCalls).toBe(1);
  });

  it("shows the current step and structured failure details for failed installs", async () => {
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get") {
        return createResponse({ context: "manual_check", canContinue: false }, [
          {
            id: "node-missing",
            code: "nodejs_missing",
            status: "needs_attention",
            dependencyId: "node",
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: ["system_deps.install.node.manual"],
            docUrl: "https://nodejs.org/en/download",
          },
        ] as DiagnosticsCheck[]);
      }

      if (op === "systemDeps.install.start") {
        expect(args).toEqual({ dependencyId: "node" });
        return {
          jobId: "job-node-failed",
          dependencyId: "node",
          status: "failed",
          packageManager: "brew",
          currentStepId: "verify-node",
          steps: [
            {
              id: "install-node",
              titleKey: "system_deps.install.step.install.node",
              kind: "install",
              command: "/bin/sh",
              args: ["-lc", "brew install node"],
              status: "succeeded",
              startedAt: 1,
              finishedAt: 2,
              exitCode: 0,
            },
            {
              id: "verify-node",
              titleKey: "system_deps.install.step.verify.node",
              kind: "verify",
              command: "node",
              args: ["--version"],
              status: "failed",
              startedAt: 3,
              finishedAt: 4,
              stderrExcerpt: "node: command not found",
            },
          ],
          interaction: { kind: "none", echo: false },
          failure: {
            code: "verification_failed",
            dependencyId: "node",
            failedStepId: "verify-node",
            message: "Verification failed for node",
            command: "node",
            args: ["--version"],
            packageManager: "brew",
            manualGuideKeys: ["system_deps.install.node.manual"],
            docUrl: "https://nodejs.org/en/download",
            stderrExcerpt: "node: command not found",
          },
        };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    renderDiagnostics("/diagnostics?context=manual_check", sendCommand);

    expect(await screen.findByText("Node.js is missing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install Node.js" }));

    expect(await screen.findByText("Package manager: brew")).toBeInTheDocument();
    expect(screen.getByText("Install failed")).toBeInTheDocument();
    expect(screen.getByText("Verification failed for node")).toBeInTheDocument();
    expect(screen.getByText(/node: command not found/)).toBeInTheDocument();
    expect(screen.getByText(/Current step:\s*Verify Node\.js/)).toBeInTheDocument();
  });

  it("allows retrying a failed install from the diagnostics card", async () => {
    let startCalls = 0;
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get") {
        return createResponse({ context: "manual_check", canContinue: false }, [
          {
            id: "git-missing",
            code: "git_missing",
            status: "needs_attention",
            dependencyId: "git",
            autoInstallSupported: true,
            installReadiness: "ready",
            manualGuideKeys: ["system_deps.install.git.manual"],
            docUrl: "https://git-scm.com/downloads",
          },
        ] as DiagnosticsCheck[]);
      }

      if (op === "systemDeps.install.start") {
        startCalls += 1;
        expect(args).toEqual({ dependencyId: "git" });
        return {
          jobId: `job-retry-${startCalls}`,
          dependencyId: "git",
          status: "failed",
          packageManager: "apt-get",
          currentStepId: "install-git",
          steps: [
            {
              id: "install-git",
              titleKey: "system_deps.install.step.install.git",
              kind: "install",
              command: "/bin/sh",
              args: ["-lc", "sudo apt-get install -y git"],
              status: "failed",
              startedAt: 1,
              finishedAt: 2,
              exitCode: 1,
              stderrExcerpt: `attempt ${startCalls} failed`,
            },
          ],
          interaction: { kind: "none", echo: false },
          failure: {
            code: "command_failed",
            dependencyId: "git",
            failedStepId: "install-git",
            message: `Install failed for git (attempt ${startCalls})`,
            command: "/bin/sh",
            args: ["-lc", "sudo apt-get install -y git"],
            exitCode: 1,
            packageManager: "apt-get",
            manualGuideKeys: ["system_deps.install.git.manual"],
            docUrl: "https://git-scm.com/downloads",
            stderrExcerpt: `attempt ${startCalls} failed`,
          },
        };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    renderDiagnostics("/diagnostics?context=manual_check", sendCommand);

    expect(await screen.findByText("Git is missing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install Git" }));
    expect(await screen.findByText("Install failed")).toBeInTheDocument();
    expect(screen.getByText(/attempt 1 failed/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install Git" }));
    expect(await screen.findByText(/attempt 2 failed/)).toBeInTheDocument();
    expect(startCalls).toBe(2);
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

  it("shows missing git on workspace open without disabling the retry action", async () => {
    const workspace = createWorkspace("ws-1", "/repo");
    const sendCommand = vi.fn(async (op: string, args?: Record<string, unknown>) => {
      if (op === "diagnostics.get") {
        return createResponse({ context: "workspace_open", canContinue: true }, [
          {
            id: "workspace-ready",
            code: "workspace_path_ready",
            status: "ready",
            workspacePath: "/repo",
          },
          {
            id: "git-missing",
            code: "git_missing",
            status: "needs_attention",
            dependencyId: "git",
            autoInstallSupported: true,
            installReadiness: "ready",
          },
        ] as DiagnosticsCheck[]);
      }

      if (op === "workspace.open") {
        return workspace;
      }

      if (op === "workspace.lastViewedTarget.set") {
        return { workspaceId: "ws-1", updatedAt: 1 };
      }

      throw new Error(`Unexpected op: ${op}`);
    });

    renderDiagnostics("/diagnostics?context=workspace_open&workspacePath=%2Frepo", sendCommand);

    expect(await screen.findByText("Git is missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Opening Workspace" })).toBeEnabled();
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
