import { expect, type Page, test } from "@playwright/test";

type UpdateRuntimeContext = {
  environment:
    | "desktop-native"
    | "desktop-wsl"
    | "cli-global-npm"
    | "cli-unsupported"
    | "desktop-managed";
  authority: "desktop" | "cli" | "none";
  supported: boolean;
  unsupportedReason: string | null;
};

type UpdateStateView = {
  version: 2;
  currentVersion: string;
  currentPublishedAt: string | null;
  latestVersion: string | null;
  latestPublishedAt: string | null;
  availability: "unknown" | "up_to_date" | "update_available" | "check_failed";
  updateStatus:
    | "idle"
    | "checking"
    | "installing"
    | "restarting"
    | "succeeded"
    | "failed"
    | "manual_required";
  lastCheckedAt: number | null;
  targetVersion: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  requiresManualStep: boolean;
  manualCommand: string | null;
  errorSummary: string | null;
  supported: boolean;
  installKind: "global_npm" | "unsupported";
  unsupportedReason: string | null;
  runtimeContext: UpdateRuntimeContext;
};

type ProductUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "succeeded"
  | "failed"
  | "manual_required"
  | "unsupported";

type ProductUpdateComponent = {
  id: "shell" | "runtime:win32-x64" | "runtime:linux-x64" | "cli";
  kind: "shell" | "runtime" | "cli";
  target: "win32-x64" | "linux-x64" | null;
  currentVersion: string;
  currentPublishedAt: string | null;
  targetVersion: string | null;
  targetPublishedAt: string | null;
  status: ProductUpdateStatus;
  progressPercent: number | null;
  downloaded: boolean;
  verified: boolean;
  errorSummary: string | null;
};

type ProductUpdateState = {
  schemaVersion: 1;
  runtimeContext: UpdateRuntimeContext;
  status: ProductUpdateStatus;
  productVersion: string;
  productPublishedAt: string | null;
  planId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastCheckedAt: number | null;
  components: ProductUpdateComponent[];
  compatibility: { compatible: boolean; code: string | null; summary: string | null };
  diagnostics: {
    failedComponentId: ProductUpdateComponent["id"] | null;
    failedPhase: string | null;
    shellVersion: string | null;
    shellPublishedAt: string | null;
    shellBuiltAt: string | null;
    engineVersion: string | null;
    nodeVersion: string | null;
    runtimeHostApiVersion: number | null;
    apiProtocolVersion: number | null;
    dataSchemaVersion: number | null;
    logLocations: string[];
    recoveryAction: string | null;
  };
  restartRequired: boolean;
  requiresManualStep: boolean;
  manualCommand: string | null;
  errorSummary: string | null;
};

type UpdateActivity = {
  runningTerminalCount: number;
  runningSessionCount: number;
  runningSupervisorCount: number;
  hasActiveWork: boolean;
};

type DesktopFixtureState = {
  state: ProductUpdateState;
  calls: string[];
  listeners: Array<(state: ProductUpdateState) => void>;
};

declare global {
  interface Window {
    __desktopUpdateFixture?: DesktopFixtureState;
  }
}

const CURRENT_PUBLISHED_AT = "2026-08-08T01:02:03.000Z";
const LATEST_PUBLISHED_AT = "2026-09-01T02:03:04.000Z";
const NO_ACTIVE_WORK: UpdateActivity = {
  runningTerminalCount: 0,
  runningSessionCount: 0,
  runningSupervisorCount: 0,
  hasActiveWork: false,
};

function cliState(overrides: Partial<UpdateStateView> = {}): UpdateStateView {
  const runtimeContext: UpdateRuntimeContext = {
    environment: "cli-global-npm",
    authority: "cli",
    supported: true,
    unsupportedReason: null,
  };
  return {
    version: 2,
    currentVersion: "0.6.0",
    currentPublishedAt: CURRENT_PUBLISHED_AT,
    latestVersion: "0.7.0",
    latestPublishedAt: LATEST_PUBLISHED_AT,
    availability: "update_available",
    updateStatus: "idle",
    lastCheckedAt: Date.parse(LATEST_PUBLISHED_AT),
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    supported: true,
    installKind: "global_npm",
    unsupportedReason: null,
    runtimeContext,
    ...overrides,
  };
}

function desktopManagedState(): UpdateStateView {
  const runtimeContext: UpdateRuntimeContext = {
    environment: "desktop-managed",
    authority: "desktop",
    supported: true,
    unsupportedReason: null,
  };
  return {
    ...cliState(),
    supported: false,
    installKind: "unsupported",
    unsupportedReason: "Managed by Coder Studio Desktop",
    runtimeContext,
  };
}

function unsupportedCliState(): UpdateStateView {
  const runtimeContext: UpdateRuntimeContext = {
    environment: "cli-unsupported",
    authority: "none",
    supported: false,
    unsupportedReason: "Source and bundled installs are read-only",
  };
  return {
    ...cliState({ latestVersion: null, latestPublishedAt: null, availability: "unknown" }),
    supported: false,
    installKind: "unsupported",
    unsupportedReason: runtimeContext.unsupportedReason,
    runtimeContext,
  };
}

function desktopState(
  environment: "desktop-native" | "desktop-wsl" = "desktop-native",
  overrides: Partial<ProductUpdateState> = {}
): ProductUpdateState {
  const runtimeTarget = environment === "desktop-wsl" ? "linux-x64" : "win32-x64";
  const runtimeId = environment === "desktop-wsl" ? "runtime:linux-x64" : "runtime:win32-x64";
  const components: ProductUpdateComponent[] = [
    {
      id: "shell",
      kind: "shell",
      target: "win32-x64",
      currentVersion: "0.2.0",
      currentPublishedAt: "2026-07-01T00:00:00.000Z",
      targetVersion: "0.3.0",
      targetPublishedAt: LATEST_PUBLISHED_AT,
      status: "available",
      progressPercent: null,
      downloaded: false,
      verified: false,
      errorSummary: null,
    },
    {
      id: runtimeId,
      kind: "runtime",
      target: runtimeTarget,
      currentVersion: "0.6.0",
      currentPublishedAt: CURRENT_PUBLISHED_AT,
      targetVersion: "0.7.0",
      targetPublishedAt: LATEST_PUBLISHED_AT,
      status: "available",
      progressPercent: null,
      downloaded: false,
      verified: false,
      errorSummary: null,
    },
  ];
  return {
    schemaVersion: 1,
    runtimeContext: {
      environment,
      authority: "desktop",
      supported: true,
      unsupportedReason: null,
    },
    status: "available",
    productVersion: "0.6.0",
    productPublishedAt: CURRENT_PUBLISHED_AT,
    planId: "desktop-plan-1",
    createdAt: "2026-09-01T02:04:00.000Z",
    updatedAt: "2026-09-01T02:05:00.000Z",
    lastCheckedAt: Date.parse("2026-09-01T02:05:00.000Z"),
    components,
    compatibility: { compatible: true, code: null, summary: null },
    diagnostics: {
      failedComponentId: null,
      failedPhase: null,
      shellVersion: "0.2.0",
      shellPublishedAt: "2026-07-01T00:00:00.000Z",
      shellBuiltAt: "2026-06-30T23:50:00.000Z",
      engineVersion: "engine-abi-2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
      logLocations: [
        "C:\\Users\\acceptance\\AppData\\Roaming\\Coder Studio\\desktop-update.log",
        "C:\\Users\\acceptance\\AppData\\Roaming\\Coder Studio\\desktop-update-plan.json",
      ],
      recoveryAction: null,
    },
    restartRequired: true,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    ...overrides,
  };
}

function withComponentStatus(
  state: ProductUpdateState,
  status: ProductUpdateStatus,
  progressPercent: number | null = null
): ProductUpdateState {
  return {
    ...state,
    status,
    components: state.components.map((component) => ({
      ...component,
      status,
      progressPercent,
      downloaded: status === "ready",
      verified: status === "ready",
    })),
  };
}

type UpdateProtocolFixture = {
  commands: string[];
  waitForHandshake: () => Promise<void>;
};

async function installUpdateProtocolFixture(
  page: Page,
  options: {
    serverState: UpdateStateView;
    checkState?: UpdateStateView;
    startState?: UpdateStateView;
    prepareActivity?: UpdateActivity;
  }
): Promise<UpdateProtocolFixture> {
  const commands: string[] = [];
  let resolveHandshake: (() => void) | undefined;
  const handshake = new Promise<void>((resolve) => {
    resolveHandshake = resolve;
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
  });
  await page.routeWebSocket(/\/ws$/, (webSocket) => {
    const server = webSocket.connectToServer();
    server.onMessage((message) => {
      if (typeof message === "string") {
        try {
          const parsed = JSON.parse(message) as {
            kind?: string;
            topic?: string;
            data?: { status?: string };
          };
          if (
            parsed.kind === "event" &&
            parsed.topic === "connection.status" &&
            parsed.data?.status === "connected"
          ) {
            resolveHandshake?.();
          }
        } catch {
          // Non-JSON frames are forwarded unchanged below.
        }
      }
      webSocket.send(message);
    });
    webSocket.onMessage((message) => {
      if (typeof message !== "string") {
        server.send(message);
        return;
      }

      let parsed: { kind?: string; id?: string; op?: string; args?: unknown };
      try {
        parsed = JSON.parse(message) as typeof parsed;
      } catch {
        server.send(message);
        return;
      }

      if (parsed.kind !== "command" || !parsed.id || !parsed.op) {
        server.send(message);
        return;
      }

      commands.push(parsed.op);
      if (
        parsed.op !== "updates.getState" &&
        parsed.op !== "updates.check" &&
        parsed.op !== "updates.prepareInstall" &&
        parsed.op !== "updates.startInstall"
      ) {
        server.send(message);
        return;
      }

      let data: unknown = options.serverState;
      if (parsed.op === "updates.check") data = options.checkState ?? options.serverState;
      if (parsed.op === "updates.prepareInstall") {
        data = {
          ...options.serverState,
          canStartInstall: true,
          activity: options.prepareActivity ?? NO_ACTIVE_WORK,
        };
      }
      if (parsed.op === "updates.startInstall") {
        data =
          options.startState ??
          cliState({
            ...options.serverState,
            updateStatus: "restarting",
            targetVersion: options.serverState.latestVersion,
          });
      }
      webSocket.send(JSON.stringify({ kind: "result", id: parsed.id, ok: true, data }));
    });
  });

  return {
    commands,
    waitForHandshake: async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          handshake,
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("Timed out waiting for the real E2E WebSocket handshake")),
              10_000
            );
          }),
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },
  };
}

type DesktopFixture = {
  calls: () => Promise<string[]>;
  emit: (state: ProductUpdateState) => Promise<void>;
  setState: (state: ProductUpdateState) => Promise<void>;
};

async function installDesktopUpdateFixture(
  page: Page,
  initialState: ProductUpdateState
): Promise<DesktopFixture> {
  await page.addInitScript((state: ProductUpdateState) => {
    const fixture: DesktopFixtureState = { state, calls: [], listeners: [] };
    const record = (method: string) => {
      fixture.calls.push(method);
      return fixture.state;
    };
    const activeEnvironment = {
      id: state.runtimeContext.environment === "desktop-wsl" ? "wsl:Ubuntu" : "native",
      kind: state.runtimeContext.environment === "desktop-wsl" ? "wsl" : "native",
      label: state.runtimeContext.environment === "desktop-wsl" ? "Ubuntu" : "Local Windows",
      distro: state.runtimeContext.environment === "desktop-wsl" ? "Ubuntu" : undefined,
      active: true,
      status: "ready",
      platform: state.runtimeContext.environment === "desktop-wsl" ? "linux" : "win32",
      arch: "x64",
      engineVersion: state.diagnostics.engineVersion ?? undefined,
      runtimeVersion: state.productVersion,
    };
    let settings = { schemaVersion: 1 as const, autoCheckEnabled: true, checkIntervalSec: 21600 };
    const bridge = {
      platform: "win32",
      updateApiVersion: 1 as const,
      getAppVersion: async () => state.diagnostics.shellVersion ?? "0.0.0",
      selectWorkspaceDirectory: async () => null,
      openExternal: async () => true,
      getBackendStatus: async () => ({ source: "managed" as const, url: location.origin, pid: 1 }),
      listEnvironments: async () => [activeEnvironment],
      getActiveEnvironment: async () => activeEnvironment,
      openEnvironment: async () => ({ status: "unchanged" as const }),
      onEnvironmentProgress: () => () => {},
      getUpdateState: async () => fixture.state,
      checkForUpdates: async () => record("checkForUpdates"),
      downloadUpdate: async () => record("downloadUpdate"),
      retryUpdate: async () => record("retryUpdate"),
      cancelUpdateDownload: async () => record("cancelUpdateDownload"),
      prepareUpdateRestart: async () => record("prepareUpdateRestart"),
      restartAndInstallUpdate: async () => {
        fixture.calls.push("restartAndInstallUpdate");
        return true;
      },
      getUpdateSettings: async () => settings,
      setUpdateSettings: async (patch: { autoCheckEnabled: boolean; checkIntervalSec: number }) => {
        settings = { ...settings, ...patch };
        return settings;
      },
      onUpdateStateChanged: (listener: (nextState: ProductUpdateState) => void) => {
        fixture.listeners.push(listener);
        return () => {
          const index = fixture.listeners.indexOf(listener);
          if (index >= 0) fixture.listeners.splice(index, 1);
        };
      },
      getRuntimeUpdateState: async () => ({
        supported: true,
        currentVersion: fixture.state.productVersion,
        latestVersion: fixture.state.components.find((component) => component.kind === "runtime")
          ?.targetVersion,
        pendingVersion: null,
        lastCheckedAt: fixture.state.lastCheckedAt,
        status: "idle" as const,
        errorSummary: null,
        unsupportedReason: null,
      }),
      checkRuntimeUpdate: async () => ({
        supported: true,
        currentVersion: fixture.state.productVersion,
        latestVersion: null,
        pendingVersion: null,
        lastCheckedAt: fixture.state.lastCheckedAt,
        status: "idle" as const,
        errorSummary: null,
        unsupportedReason: null,
      }),
      restartForRuntimeUpdate: async () => true,
      onRuntimeUpdateStateChanged: () => () => {},
    };

    Object.defineProperty(window, "__desktopUpdateFixture", { value: fixture });
    Object.defineProperty(window, "coderStudioDesktop", {
      configurable: false,
      enumerable: true,
      value: Object.freeze(bridge),
      writable: false,
    });
  }, initialState);

  return {
    calls: () => page.evaluate(() => [...(window.__desktopUpdateFixture?.calls ?? [])]),
    emit: (state) =>
      page.evaluate((nextState) => {
        const fixture = window.__desktopUpdateFixture;
        if (!fixture) throw new Error("Desktop update fixture is not installed");
        fixture.state = nextState;
        for (const listener of [...fixture.listeners]) listener(nextState);
      }, state),
    setState: (state) =>
      page.evaluate((nextState) => {
        const fixture = window.__desktopUpdateFixture;
        if (!fixture) throw new Error("Desktop update fixture is not installed");
        fixture.state = nextState;
      }, state),
  };
}

async function openAbout(
  page: Page,
  fixture: UpdateProtocolFixture,
  view: "product" | "update-status" | "auto-update"
) {
  await page.goto(`/more/about/${view}`, { waitUntil: "domcontentloaded" });
  await fixture.waitForHandshake();
  await expect(page.getByTestId("more-features-page")).toBeVisible();
  const about = page.getByTestId("about-settings");
  await expect(about).toBeVisible();
  return about;
}

test.describe("unified update routing", () => {
  test.use({ timezoneId: "Asia/Shanghai" });

  test("CLI About shows the npm product version, local release time, and CLI action only", async ({
    page,
  }) => {
    const protocol = await installUpdateProtocolFixture(page, { serverState: cliState() });
    const product = await openAbout(page, protocol, "product");

    await expect(product.getByTestId("product-version")).toHaveText("v0.6.0");
    const localReleaseTime = await page.evaluate((publishedAt) => {
      return new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(Date.parse(publishedAt));
    }, CURRENT_PUBLISHED_AT);
    await expect(product.getByTestId("product-release-time")).toHaveText(localReleaseTime);
    await expect(product.getByTestId("product-release-time")).not.toHaveText(
      "Release time unknown"
    );

    const status = await openAbout(page, protocol, "update-status");
    const actions = status.getByTestId("update-primary-actions");
    await expect(actions.getByRole("button")).toHaveCount(1);
    await expect(actions.getByRole("button", { name: "Update and restart" })).toBeVisible();
    await expect(status.getByText(/Shell v/)).toHaveCount(0);
    const actionCommandIndex = protocol.commands.length;
    await actions.getByRole("button", { name: "Update and restart" }).click();
    await expect
      .poll(() =>
        protocol.commands.slice(actionCommandIndex).filter((op) => op.startsWith("updates."))
      )
      .toEqual(["updates.prepareInstall", "updates.startInstall"]);
  });

  test("Desktop renders one combined plan and one confirmation/restart sequence", async ({
    page,
  }) => {
    const available = desktopState();
    const ready = withComponentStatus(available, "ready");
    const desktop = await installDesktopUpdateFixture(page, available);
    const protocol = await installUpdateProtocolFixture(page, {
      serverState: desktopManagedState(),
      prepareActivity: {
        runningTerminalCount: 1,
        runningSessionCount: 1,
        runningSupervisorCount: 0,
        hasActiveWork: true,
      },
    });
    const status = await openAbout(page, protocol, "update-status");

    const actions = status.getByTestId("update-primary-actions");
    await expect(actions.getByRole("button")).toHaveCount(1);
    await actions.getByRole("button", { name: "Download update" }).click();
    await expect.poll(() => desktop.calls()).toEqual(["downloadUpdate"]);

    await desktop.emit(ready);
    await status.getByRole("button", { name: "Restart and update" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    await dialog.getByRole("button", { name: "Restart and update" }).click();
    await expect
      .poll(() => desktop.calls())
      .toEqual(["downloadUpdate", "prepareUpdateRestart", "restartAndInstallUpdate"]);
  });

  test("external Desktop sidecar is read-only and never falls back to npm", async ({ page }) => {
    const protocol = await installUpdateProtocolFixture(page, {
      serverState: desktopManagedState(),
    });
    const status = await openAbout(page, protocol, "update-status");

    await expect(
      status.getByText("Open Coder Studio Desktop to manage this update.")
    ).toBeVisible();
    await expect(status.getByTestId("update-primary-actions")).toHaveCount(0);
    expect(protocol.commands).not.toContain("updates.check");
    expect(protocol.commands).not.toContain("updates.startInstall");
  });

  test("Desktop WSL exposes host-managed context without a CLI action", async ({ page }) => {
    const wsl = desktopState("desktop-wsl", {
      components: desktopState("desktop-wsl").components.filter(
        (component) => component.kind === "runtime"
      ),
    });
    await installDesktopUpdateFixture(page, wsl);
    const protocol = await installUpdateProtocolFixture(page, {
      serverState: desktopManagedState(),
    });
    const status = await openAbout(page, protocol, "update-status");

    await expect(
      status.getByText("WSL Runtime updates are verified and managed by the Windows host.")
    ).toBeVisible();
    await status.getByRole("button", { name: "Component diagnostics" }).click();
    await expect(status.getByTestId("update-component-diagnostics")).toContainText(
      "Environment: desktop-wsl"
    );
    expect(protocol.commands).not.toContain("updates.check");
    expect(protocol.commands).not.toContain("updates.startInstall");
  });

  test("missing release metadata remains explicitly unknown", async ({ page }) => {
    const protocol = await installUpdateProtocolFixture(page, {
      serverState: cliState({ currentPublishedAt: null }),
    });
    const product = await openAbout(page, protocol, "product");
    await expect(product.getByTestId("product-release-time")).toHaveText("Release time unknown");
  });

  test("component diagnostics expands Shell, Runtime, ABI, and recovery paths", async ({
    page,
  }) => {
    const combined = desktopState();
    await installDesktopUpdateFixture(page, combined);
    const protocol = await installUpdateProtocolFixture(page, {
      serverState: desktopManagedState(),
    });
    const status = await openAbout(page, protocol, "update-status");

    await expect(status.getByText("Shell v0.2.0 → v0.3.0")).toHaveCount(0);
    await status.getByRole("button", { name: "Component diagnostics" }).click();
    const diagnostics = status.getByTestId("update-component-diagnostics");
    await expect(diagnostics).toContainText("Shell v0.2.0 → v0.3.0");
    await expect(diagnostics).toContainText("Runtime (win32-x64) v0.6.0 → v0.7.0");
    await expect(diagnostics).toContainText("Engine ABI: engine-abi-2");
    await expect(diagnostics).toContainText("desktop-update.log");
    await expect(diagnostics).toContainText("desktop-update-plan.json");
  });

  test("Desktop download progress has one cancellable primary action", async ({ page }) => {
    const available = desktopState();
    const downloading = withComponentStatus(available, "downloading", 42);
    const desktop = await installDesktopUpdateFixture(page, available);
    const protocol = await installUpdateProtocolFixture(page, {
      serverState: desktopManagedState(),
    });
    const status = await openAbout(page, protocol, "update-status");

    await desktop.setState(downloading);
    await status.getByRole("button", { name: "Download update" }).click();
    await expect(status.getByText("42%").first()).toBeVisible();
    const actions = status.getByTestId("update-primary-actions");
    await expect(actions.getByRole("button")).toHaveCount(1);
    await actions.getByRole("button", { name: "Cancel download" }).click();
    await expect.poll(() => desktop.calls()).toEqual(["downloadUpdate", "cancelUpdateDownload"]);
  });

  test("Desktop failure retries through the Desktop bridge", async ({ page }) => {
    const available = desktopState();
    const failed = withComponentStatus(available, "failed");
    failed.errorSummary = "Runtime signature verification failed";
    failed.diagnostics.failedComponentId = "runtime:win32-x64";
    failed.diagnostics.failedPhase = "verification";
    const desktop = await installDesktopUpdateFixture(page, failed);
    const protocol = await installUpdateProtocolFixture(page, {
      serverState: desktopManagedState(),
    });
    const status = await openAbout(page, protocol, "update-status");

    await desktop.setState(available);
    await status.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => desktop.calls()).toEqual(["retryUpdate"]);
    await expect(status.getByRole("button", { name: "Download update" })).toBeVisible();
    expect(protocol.commands).not.toContain("updates.check");
  });

  test("CLI manual fallback exposes the exact install command after an attempted update", async ({
    page,
  }) => {
    const initial = cliState();
    const manual = cliState({
      updateStatus: "manual_required",
      targetVersion: "0.7.0",
      requiresManualStep: true,
      manualCommand: "npm install -g @spencer-kit/coder-studio@0.7.0",
      errorSummary: "Automatic update requires elevated permissions",
    });
    const protocol = await installUpdateProtocolFixture(page, {
      serverState: initial,
      startState: manual,
    });
    const status = await openAbout(page, protocol, "update-status");

    await status.getByRole("button", { name: "Update and restart" }).click();
    await expect(status.getByText("npm install -g @spencer-kit/coder-studio@0.7.0")).toBeVisible();
    await expect(status.getByText("Automatic update requires elevated permissions")).toBeVisible();
    await expect(status.getByTestId("update-primary-actions")).toHaveCount(0);
    expect(protocol.commands).toContain("updates.startInstall");
  });

  test("unsupported CLI is read-only", async ({ page }) => {
    const protocol = await installUpdateProtocolFixture(page, {
      serverState: unsupportedCliState(),
    });
    const status = await openAbout(page, protocol, "update-status");

    await expect(status.getByText("Updates unavailable")).toBeVisible();
    await expect(status.getByText("Source and bundled installs are read-only")).toBeVisible();
    await expect(status.getByTestId("update-primary-actions")).toHaveCount(0);
    expect(protocol.commands).not.toContain("updates.check");
    expect(protocol.commands).not.toContain("updates.startInstall");
  });
});
