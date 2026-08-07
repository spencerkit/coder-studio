import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { EnvironmentSwitcher } from "./environment-switcher";

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
    openEnvironment,
    emitProgress: (event: DesktopEnvironmentProgress) => progressListener?.(event),
  };
}

function renderSwitcher() {
  const store = createStore();
  store.set(localeAtom, "en");
  return render(
    <Provider store={store}>
      <EnvironmentSwitcher />
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
});
