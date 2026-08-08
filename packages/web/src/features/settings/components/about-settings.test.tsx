// @vitest-environment jsdom

import type { ProductUpdatePreparation, ProductUpdateState } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { serverInfoAtom } from "../../../atoms/connection";
import { productUpdateStateAtom, updateControllerAtom } from "../../updates/atoms";
import type { UpdateController } from "../../updates/types";
import { AboutSettings, formatReleaseTime } from "./about-settings";

const noActiveWork = {
  runningTerminalCount: 0,
  runningSessionCount: 0,
  runningSupervisorCount: 0,
  hasActiveWork: false,
};

function desktopState(overrides: Partial<ProductUpdateState> = {}): ProductUpdateState {
  return {
    schemaVersion: 1,
    runtimeContext: {
      environment: "desktop-native",
      authority: "desktop",
      supported: true,
      unsupportedReason: null,
    },
    status: "available",
    productVersion: "0.6.0",
    productPublishedAt: "2026-08-08T01:02:03.000Z",
    planId: "plan-1",
    createdAt: "2026-08-08T01:03:00.000Z",
    updatedAt: "2026-08-08T01:04:00.000Z",
    lastCheckedAt: Date.parse("2026-08-08T01:04:00.000Z"),
    components: [
      {
        id: "shell",
        kind: "shell",
        target: "win32-x64",
        currentVersion: "0.2.0",
        currentPublishedAt: "2026-07-01T00:00:00.000Z",
        targetVersion: "0.3.0",
        targetPublishedAt: "2026-08-08T01:02:03.000Z",
        status: "available",
        progressPercent: null,
        downloaded: false,
        verified: false,
        errorSummary: null,
      },
      {
        id: "runtime:win32-x64",
        kind: "runtime",
        target: "win32-x64",
        currentVersion: "0.6.0",
        currentPublishedAt: "2026-07-20T00:00:00.000Z",
        targetVersion: "0.7.0",
        targetPublishedAt: "2026-08-08T01:02:03.000Z",
        status: "available",
        progressPercent: null,
        downloaded: false,
        verified: false,
        errorSummary: null,
      },
    ],
    compatibility: { compatible: true, code: null, summary: null },
    diagnostics: {
      failedComponentId: null,
      failedPhase: null,
      shellVersion: "0.2.0",
      shellPublishedAt: "2026-07-01T00:00:00.000Z",
      shellBuiltAt: "2026-06-30T23:50:00.000Z",
      engineVersion: "2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
      logLocations: ["desktop-update.log"],
      recoveryAction: null,
    },
    restartRequired: true,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    ...overrides,
  };
}

function cliState(overrides: Partial<ProductUpdateState> = {}): ProductUpdateState {
  const state = desktopState({
    runtimeContext: {
      environment: "cli-global-npm",
      authority: "cli",
      supported: true,
      unsupportedReason: null,
    },
    components: [
      {
        id: "cli",
        kind: "cli",
        target: null,
        currentVersion: "0.6.0",
        currentPublishedAt: "2026-07-20T00:00:00.000Z",
        targetVersion: "0.7.0",
        targetPublishedAt: "2026-08-08T01:02:03.000Z",
        status: "available",
        progressPercent: null,
        downloaded: false,
        verified: false,
        errorSummary: null,
      },
    ],
    diagnostics: {
      ...desktopState().diagnostics,
      shellVersion: null,
      shellPublishedAt: null,
      shellBuiltAt: null,
      engineVersion: null,
      nodeVersion: null,
      runtimeHostApiVersion: null,
      apiProtocolVersion: null,
      dataSchemaVersion: null,
      logLocations: [],
    },
  });
  return { ...state, ...overrides };
}

function createController(state: ProductUpdateState, kind: UpdateController["kind"] = "desktop") {
  const prepared: ProductUpdatePreparation = {
    state,
    activity: noActiveWork,
    canProceed: true,
  };
  return {
    kind,
    getState: vi.fn(() => state),
    refresh: vi.fn(async () => state),
    check: vi.fn(async () => state),
    download: vi.fn(async () => state),
    retry: vi.fn(async () => state),
    cancelDownload: vi.fn(async () => state),
    prepare: vi.fn(async () => prepared),
    start: vi.fn(async () => state),
    getSettings: vi.fn(async () => null),
    setSettings: vi.fn(async () => null),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(),
  } satisfies UpdateController;
}

function renderAbout({
  state = desktopState(),
  controller = createController(state),
  view = "all" as const,
}: {
  state?: ProductUpdateState;
  controller?: UpdateController;
  view?: "all" | "product" | "update-status" | "auto-update";
} = {}) {
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(serverInfoAtom, { version: state.productVersion, serverInstanceId: "server-1" });
  store.set(productUpdateStateAtom, state);
  store.set(updateControllerAtom, controller);
  render(
    <Provider store={store}>
      <AboutSettings
        autoCheckEnabled
        checkIntervalSec={21600}
        locale="en"
        onAutoCheckEnabledChange={vi.fn()}
        onCheckIntervalChange={vi.fn()}
        view={view}
      />
    </Provider>
  );
  return { store, controller };
}

describe("AboutSettings unified updates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows Runtime as the Desktop product version and Shell only in diagnostics", () => {
    renderAbout();
    expect(screen.getByTestId("product-version")).toHaveTextContent("v0.6.0");
    expect(screen.queryByText("Shell v0.2.0 → v0.3.0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Component diagnostics" }));
    expect(screen.getByText("Shell v0.2.0 → v0.3.0")).toBeInTheDocument();
    expect(screen.getByText(/Authority: desktop/)).toBeInTheDocument();
    expect(screen.getByText(/Environment: desktop-native/)).toBeInTheDocument();
    expect(screen.getByText(/Plan ID: plan-1/)).toBeInTheDocument();
  });

  it("renders trusted UTC release time locally and preserves unknown", () => {
    const known = renderAbout();
    expect(screen.getByTestId("product-release-time")).toHaveTextContent("2026");
    act(() => known.store.set(productUpdateStateAtom, desktopState({ productPublishedAt: null })));
    expect(screen.getByTestId("product-release-time")).toHaveTextContent("Release time unknown");
    expect(formatReleaseTime("invalid", "en", "Release time unknown")).toBe("Release time unknown");
  });

  it.each([
    ["desktop available", desktopState(), "desktop", "Download update", "download"],
    [
      "desktop ready",
      desktopState({ status: "ready" }),
      "desktop",
      "Restart and update",
      "prepare",
    ],
    ["desktop failed", desktopState({ status: "failed" }), "desktop", "Retry", "retry"],
    ["CLI available", cliState(), "cli", "Update and restart", "prepare"],
  ] as const)("routes the primary action for %s", async (_name, state, kind, label, method) => {
    const controller = createController(state, kind);
    renderAbout({ state, controller });
    const actions = screen.getByTestId("update-primary-actions");
    expect(within(actions).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(actions).getByRole("button", { name: label }));
    await waitFor(() => expect(controller[method]).toHaveBeenCalled());
  });

  it("supports Desktop progress cancellation without exposing a second primary action", async () => {
    const state = desktopState({
      status: "downloading",
      components: desktopState().components.map((component) => ({
        ...component,
        status: "downloading",
        progressPercent: 42,
      })),
    });
    const controller = createController(state);
    renderAbout({ state, controller });
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));
    await waitFor(() => expect(controller.cancelDownload).toHaveBeenCalledTimes(1));
  });

  it("confirms active work and preserves the exact prepared state for a forced restart", async () => {
    const state = desktopState({ status: "ready" });
    const controller = createController(state);
    vi.mocked(controller.prepare).mockResolvedValue({
      state,
      activity: { ...noActiveWork, runningTerminalCount: 1, hasActiveWork: true },
      canProceed: true,
    });
    renderAbout({ state, controller });
    fireEvent.click(screen.getByRole("button", { name: "Restart and update" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restart and update" }));
    await waitFor(() => expect(controller.start).toHaveBeenCalledWith(expect.anything(), true));
  });

  it("keeps readonly sidecar updates non-mutating and shows Desktop guidance", () => {
    const state = desktopState({
      runtimeContext: {
        environment: "desktop-managed",
        authority: "desktop",
        supported: false,
        unsupportedReason: "Open this update in Coder Studio Desktop",
      },
      status: "unsupported",
    });
    const controller = createController(state, "readonly");
    renderAbout({ state, controller, view: "update-status" });
    expect(
      screen.getByText("Open Coder Studio Desktop to manage this update.")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("update-primary-actions")).not.toBeInTheDocument();
  });

  it("shows manual CLI recovery without an install action", () => {
    const state = cliState({
      status: "manual_required",
      requiresManualStep: true,
      manualCommand: "npm install -g coder-studio@0.7.0",
      errorSummary: "Automatic update unavailable",
    });
    renderAbout({ state, controller: createController(state, "cli") });
    expect(screen.getByText("npm install -g coder-studio@0.7.0")).toBeInTheDocument();
    expect(screen.queryByTestId("update-primary-actions")).not.toBeInTheDocument();
  });
});
