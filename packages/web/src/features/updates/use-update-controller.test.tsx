import type { ProductUpdateState, UpdateRuntimeContext, UpdateStateView } from "@coder-studio/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { createUpdateController } from "./controller";
import type { UpdateCommandDispatcher, UpdateController } from "./types";
import { useUpdateController } from "./use-update-controller";

vi.mock("./controller", async (importOriginal) => {
  const original = await importOriginal<typeof import("./controller")>();
  return { ...original, createUpdateController: vi.fn() };
});

function wireState(context: UpdateRuntimeContext, version: string): UpdateStateView {
  return {
    version: 2,
    currentVersion: version,
    currentPublishedAt: null,
    latestVersion: null,
    latestPublishedAt: null,
    availability: "unknown",
    updateStatus: "idle",
    lastCheckedAt: null,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    supported: context.supported,
    installKind: context.environment === "cli-global-npm" ? "global_npm" : "unsupported",
    unsupportedReason: context.unsupportedReason,
    runtimeContext: context,
  };
}

function normalizedState(
  context: UpdateRuntimeContext,
  version: string,
  status: ProductUpdateState["status"] = "idle"
): ProductUpdateState {
  return {
    schemaVersion: 1,
    runtimeContext: context,
    status,
    productVersion: version,
    productPublishedAt: null,
    planId: null,
    createdAt: null,
    updatedAt: null,
    lastCheckedAt: null,
    components: [],
    compatibility: { compatible: true, code: null, summary: null },
    diagnostics: {
      failedComponentId: null,
      failedPhase: null,
      shellVersion: null,
      shellPublishedAt: null,
      shellBuiltAt: null,
      engineVersion: null,
      nodeVersion: null,
      runtimeHostApiVersion: null,
      apiProtocolVersion: null,
      dataSchemaVersion: null,
      logLocations: [],
      recoveryAction: null,
    },
    restartRequired: false,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
  };
}

function fakeController(kind: UpdateController["kind"], state: ProductUpdateState) {
  let listener: ((next: ProductUpdateState) => void) | undefined;
  const unsubscribe = vi.fn();
  const controller: UpdateController = {
    kind,
    getState: () => state,
    refresh: vi.fn(),
    check: vi.fn(),
    download: vi.fn(),
    retry: vi.fn(),
    cancelDownload: vi.fn(),
    prepare: vi.fn(),
    start: vi.fn(),
    getSettings: vi.fn(),
    setSettings: vi.fn(),
    subscribe: vi.fn((next) => {
      listener = next;
      return unsubscribe;
    }),
    dispose: vi.fn(),
  };
  return { controller, unsubscribe, emit: (next: ProductUpdateState) => listener?.(next) };
}

describe("useUpdateController", () => {
  it("disposes replaced controllers and ignores late state from the old authority", async () => {
    const desktopContext: UpdateRuntimeContext = {
      environment: "desktop-managed",
      authority: "desktop",
      supported: false,
      unsupportedReason: "Desktop managed",
    };
    const cliContext: UpdateRuntimeContext = {
      environment: "cli-global-npm",
      authority: "cli",
      supported: true,
      unsupportedReason: null,
    };
    const desktop = fakeController(
      "desktop",
      normalizedState(
        { ...desktopContext, environment: "desktop-native", supported: true },
        "1.0.0"
      )
    );
    const cli = fakeController("cli", normalizedState(cliContext, "2.0.0"));
    vi.mocked(createUpdateController)
      .mockResolvedValueOnce(desktop.controller)
      .mockResolvedValueOnce(cli.controller);
    const dispatch = vi.fn() as unknown as UpdateCommandDispatcher;
    const store = createStore();
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result, rerender, unmount } = renderHook(
      ({ state }) => useUpdateController(state, dispatch),
      { initialProps: { state: wireState(desktopContext, "1.0.0") }, wrapper }
    );

    await waitFor(() => expect(result.current.state?.productVersion).toBe("1.0.0"));
    rerender({ state: wireState(cliContext, "2.0.0") });
    await waitFor(() => expect(result.current.state?.productVersion).toBe("2.0.0"));

    expect(desktop.unsubscribe).toHaveBeenCalledTimes(1);
    expect(desktop.controller.dispose).toHaveBeenCalledTimes(1);

    act(() => desktop.emit(normalizedState(desktopContext, "stale", "failed")));
    expect(result.current.state?.productVersion).toBe("2.0.0");

    unmount();
    expect(cli.unsubscribe).toHaveBeenCalledTimes(1);
    expect(cli.controller.dispose).toHaveBeenCalledTimes(1);
  });
});
