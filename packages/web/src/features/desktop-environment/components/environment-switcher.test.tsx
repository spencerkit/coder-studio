import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { EnvironmentSwitcher, type EnvironmentSwitcherVariant } from "./environment-switcher";

const nativeEnvironment: DesktopEnvironmentSummary = {
  id: "native",
  kind: "native",
  label: "Local: Windows",
  active: true,
  status: "ready",
  platform: "win32",
  runtimeVersion: "0.5.7-acceptance.local",
};

const wslEnvironment: DesktopEnvironmentSummary = {
  id: "wsl:ubuntu",
  kind: "wsl",
  label: "WSL: Ubuntu-24.04",
  distro: "Ubuntu-24.04",
  active: false,
  status: "not-installed",
  platform: "linux",
  arch: "x64",
  runtimeVersion: "0.5.7-acceptance.local",
};

function installDesktopApi() {
  let progressListener: ((event: DesktopEnvironmentProgress) => void) | undefined;
  const openEnvironment = vi.fn().mockResolvedValue({ status: "opened" as const });
  const api: CoderStudioDesktopApi = {
    platform: "win32",
    updateApiVersion: 1,
    getAppVersion: vi.fn().mockResolvedValue("0.1.0"),
    selectWorkspaceDirectory: vi.fn().mockResolvedValue(null),
    openExternal: vi.fn().mockResolvedValue(true),
    getBackendStatus: vi.fn().mockResolvedValue(null),
    listEnvironments: vi.fn().mockResolvedValue([nativeEnvironment, wslEnvironment]),
    getActiveEnvironment: vi.fn().mockResolvedValue(nativeEnvironment),
    openEnvironment,
    onEnvironmentProgress: vi.fn((listener) => {
      progressListener = listener;
      return () => {
        progressListener = undefined;
      };
    }),
    getUpdateState: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    retryUpdate: vi.fn(),
    cancelUpdateDownload: vi.fn(),
    prepareUpdateRestart: vi.fn(),
    restartAndInstallUpdate: vi.fn(),
    getUpdateSettings: vi.fn(),
    setUpdateSettings: vi.fn(),
    onUpdateStateChanged: vi.fn(() => () => {}),
    getRuntimeUpdateState: vi.fn(),
    checkRuntimeUpdate: vi.fn(),
    restartForRuntimeUpdate: vi.fn(),
    onRuntimeUpdateStateChanged: vi.fn(() => () => {}),
  };
  Object.defineProperty(window, "coderStudioDesktop", {
    configurable: true,
    value: api,
  });
  return {
    api,
    openEnvironment,
    emitProgress: (event: DesktopEnvironmentProgress) => progressListener?.(event),
  };
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function renderSwitcher(
  variant: EnvironmentSwitcherVariant = "topbar",
  locale: "en" | "zh" = "en"
) {
  const store = createStore();
  store.set(localeAtom, locale);
  return render(
    <Provider store={store}>
      <EnvironmentSwitcher variant={variant} />
    </Provider>
  );
}

describe("EnvironmentSwitcher", () => {
  beforeEach(() => {
    delete window.coderStudioDesktop;
  });

  afterEach(() => {
    delete window.coderStudioDesktop;
  });

  it("renders the active environment as optional welcome-page context", async () => {
    installDesktopApi();
    renderSwitcher("welcome");

    expect(await screen.findByText("Local: Windows")).toBeInTheDocument();
    expect(screen.getByText("Current window environment")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Open another environment from Local: Windows",
      })
    ).toBeInTheDocument();
  });

  it("localizes the welcome environment context in Chinese", async () => {
    installDesktopApi();
    renderSwitcher("welcome", "zh");

    expect(await screen.findByText("Local: Windows")).toBeInTheDocument();
    expect(screen.getByText("当前窗口环境")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "从 Local: Windows 打开另一个运行环境",
      })
    ).toBeInTheDocument();
  });

  it("shows a stable checking state while welcome environment data loads", async () => {
    const { api } = installDesktopApi();
    const environments = deferred<DesktopEnvironmentSummary[]>();
    const activeEnvironment = deferred<DesktopEnvironmentSummary>();
    vi.mocked(api.listEnvironments).mockReturnValueOnce(environments.promise);
    vi.mocked(api.getActiveEnvironment).mockReturnValueOnce(activeEnvironment.promise);

    renderSwitcher("welcome");

    expect(await screen.findByText("Checking environment…")).toBeInTheDocument();
    expect(screen.getByTestId("welcome-environment-context")).toBeInTheDocument();

    environments.resolve([nativeEnvironment, wslEnvironment]);
    activeEnvironment.resolve(nativeEnvironment);
    expect(await screen.findByText("Current window environment")).toBeInTheDocument();
  });

  it("keeps welcome launch feedback reachable after the popover closes", async () => {
    const user = userEvent.setup();
    const { openEnvironment } = installDesktopApi();
    const opening = deferred<{ status: "opened" }>();
    openEnvironment.mockReturnValueOnce(opening.promise);
    renderSwitcher("welcome");

    const trigger = await screen.findByRole("button", {
      name: "Open another environment from Local: Windows",
    });
    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: /WSL: Ubuntu-24\.04/ }));
    await user.click(trigger);

    expect(screen.queryByRole("dialog", { name: "Coder Studio environment" })).toBeNull();
    expect(screen.getByText("Opening WSL: Ubuntu-24.04…")).toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Coder Studio environment" })).toBeInTheDocument();

    opening.resolve({ status: "opened" });
    await waitFor(() =>
      expect(screen.queryByText("Opening WSL: Ubuntu-24.04…")).not.toBeInTheDocument()
    );
    expect(screen.getByText("Local: Windows")).toBeInTheDocument();
  });

  it("offers inline retry for the last failed environment", async () => {
    const user = userEvent.setup();
    const { openEnvironment } = installDesktopApi();
    openEnvironment
      .mockRejectedValueOnce(new Error("Unable to launch WSL instance"))
      .mockResolvedValueOnce({ status: "opened" });
    renderSwitcher("welcome");

    await user.click(
      await screen.findByRole("button", {
        name: "Open another environment from Local: Windows",
      })
    );
    await user.click(await screen.findByRole("button", { name: /WSL: Ubuntu-24\.04/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to launch WSL instance");
    const trigger = screen.getByRole("button", {
      name: "Open another environment from Local: Windows",
    });
    await user.click(trigger);
    await user.click(trigger);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to launch WSL instance");

    const retry = await screen.findByRole("button", {
      name: "Retry opening WSL: Ubuntu-24.04",
    });
    await user.click(retry);

    expect(openEnvironment).toHaveBeenNthCalledWith(2, "wsl:ubuntu");
  });

  it("omits both variants outside Windows Desktop", () => {
    const { container: missingBridge } = renderSwitcher("welcome");
    expect(missingBridge).toBeEmptyDOMElement();

    installDesktopApi();
    Object.defineProperty(window, "coderStudioDesktop", {
      configurable: true,
      value: { ...window.coderStudioDesktop, platform: "linux" },
    });
    const { container: nonWindows } = renderSwitcher("welcome");
    expect(nonWindows).toBeEmptyDOMElement();
  });

  it("keeps the current window and opens WSL as another environment instance", async () => {
    const user = userEvent.setup();
    const { openEnvironment } = installDesktopApi();
    renderSwitcher();

    expect(await screen.findByText("Local: Windows")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Coder Studio environment" }));
    await user.click(await screen.findByRole("button", { name: /WSL: Ubuntu-24\.04/ }));

    expect(openEnvironment).toHaveBeenCalledWith("wsl:ubuntu");
    await waitFor(() =>
      expect(screen.queryByText("Open another environment")).not.toBeInTheDocument()
    );
  });

  it("keeps showing opening progress until the target window reports ready", async () => {
    const user = userEvent.setup();
    const { openEnvironment } = installDesktopApi();
    const opening = deferred<{ status: "opened" }>();
    openEnvironment.mockReturnValueOnce(opening.promise);
    renderSwitcher();

    expect(await screen.findByText("Local: Windows")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Coder Studio environment" });
    await user.click(trigger);
    const wslButton = await screen.findByRole("button", { name: /WSL: Ubuntu-24\.04/ });
    await user.click(wslButton);

    expect(wslButton).toBeDisabled();
    expect(screen.getByText("Opening…")).toBeInTheDocument();

    await user.click(trigger);
    expect(
      screen.queryByRole("dialog", { name: "Coder Studio environment" })
    ).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Coder Studio environment" })).toBeInTheDocument();
    expect(screen.getByText("Opening…")).toBeInTheDocument();

    opening.resolve({ status: "opened" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Coder Studio environment" })
      ).not.toBeInTheDocument()
    );

    await user.click(trigger);
    const reopenedWslButton = await screen.findByRole("button", { name: /WSL: Ubuntu-24\.04/ });
    expect(reopenedWslButton).toBeEnabled();
    expect(screen.queryByText("Opening…")).not.toBeInTheDocument();
    expect(screen.queryByText("Checking environment…")).not.toBeInTheDocument();
  });

  it("renders installation progress reported by the Desktop host", async () => {
    const { emitProgress } = installDesktopApi();
    renderSwitcher();
    await screen.findByText("Local: Windows");

    emitProgress({
      environmentId: "wsl:ubuntu",
      phase: "downloading",
      message: "Downloading WSL Engine…",
      percent: 25,
    });
    await userEvent.click(screen.getByRole("button", { name: "Coder Studio environment" }));

    await waitFor(() => expect(screen.getByText("Downloading WSL Engine…")).toBeInTheDocument());
  });

  it("shows the Product Runtime version for each Desktop environment", async () => {
    installDesktopApi();
    renderSwitcher();

    await screen.findByText("Local: Windows");
    await userEvent.click(screen.getByRole("button", { name: "Coder Studio environment" }));

    expect(screen.getAllByText("Product Runtime v0.5.7-acceptance.local")).toHaveLength(2);
  });

  it("keeps the menu actionable when opening another instance fails", async () => {
    const user = userEvent.setup();
    const { openEnvironment } = installDesktopApi();
    openEnvironment.mockRejectedValueOnce(new Error("Unable to launch WSL instance"));
    renderSwitcher();

    await screen.findByText("Local: Windows");
    await user.click(screen.getByRole("button", { name: "Coder Studio environment" }));
    const wslButton = await screen.findByRole("button", { name: /WSL: Ubuntu-24\.04/ });
    await user.click(wslButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to launch WSL instance");
    expect(wslButton).toBeEnabled();
  });

  it("re-enables retry after a launch readiness timeout", async () => {
    const user = userEvent.setup();
    const { openEnvironment } = installDesktopApi();
    const opening = deferred<{ status: "opened" }>();
    openEnvironment.mockReturnValueOnce(opening.promise);
    renderSwitcher();

    await screen.findByText("Local: Windows");
    await user.click(screen.getByRole("button", { name: "Coder Studio environment" }));
    const wslButton = await screen.findByRole("button", { name: /WSL: Ubuntu-24\.04/ });
    await user.click(wslButton);

    opening.reject(new Error("Timed out waiting for WSL: Ubuntu-24.04 to open"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Timed out waiting");
    expect(wslButton).toBeEnabled();
    await user.click(wslButton);
    expect(openEnvironment).toHaveBeenCalledTimes(2);
  });
});
