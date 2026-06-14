// @vitest-environment jsdom

import type { UpdatePrepareInstallResponse, UpdateStateView } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serverInfoAtom, wsClientAtom } from "../../../atoms/connection";
import { toastsAtom } from "../../notifications/atoms";
import { updatePrepareInstallAtom, updateStateAtom } from "../../updates/atoms";
import { AboutSettings } from "./about-settings";

function renderAboutSettings({
  dispatch = vi.fn(),
  updateState,
  locale = "zh" as const,
  autoCheckEnabled = true,
  checkIntervalSec = 3600,
  view = "all" as const,
  onAutoCheckEnabledChange = vi.fn<(value: boolean) => void>(),
  onCheckIntervalChange = vi.fn<(value: number) => void>(),
}: {
  dispatch?: ReturnType<typeof vi.fn>;
  updateState?: UpdateStateView | null;
  locale?: "zh" | "en";
  autoCheckEnabled?: boolean;
  checkIntervalSec?: number;
  view?: "all" | "product" | "update-status" | "auto-update";
  onAutoCheckEnabledChange?: (value: boolean) => void;
  onCheckIntervalChange?: (value: number) => void;
} = {}) {
  const store = createStore();
  store.set(wsClientAtom, { sendCommand: dispatch } as never);
  store.set(serverInfoAtom, {
    version: "0.4.0",
    serverInstanceId: "server-123",
  });
  store.set(
    updateStateAtom,
    updateState ?? {
      version: 1,
      currentVersion: "0.4.0",
      latestVersion: "0.5.0",
      availability: "update_available",
      updateStatus: "idle",
      lastCheckedAt: 123,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
      supported: true,
      installKind: "global_npm",
      unsupportedReason: null,
    }
  );

  render(
    <Provider store={store}>
      <AboutSettings
        autoCheckEnabled={autoCheckEnabled}
        checkIntervalSec={checkIntervalSec}
        onAutoCheckEnabledChange={onAutoCheckEnabledChange}
        onCheckIntervalChange={onCheckIntervalChange}
        locale={locale}
        view={view}
      />
    </Provider>
  );

  return { store, dispatch, onAutoCheckEnabledChange, onCheckIntervalChange };
}

describe("AboutSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders current and latest version info", () => {
    renderAboutSettings();

    expect(screen.getByTestId("about-settings")).toBeInTheDocument();
    expect(screen.getByText("Coder Studio")).toBeInTheDocument();
    expect(screen.getByText("v0.4.0")).toBeInTheDocument();
    expect(screen.getByText("v0.5.0")).toBeInTheDocument();
  });

  it("does not render the auto-check section title or description copy", () => {
    renderAboutSettings();

    expect(screen.queryByRole("heading", { name: "自动检查" })).not.toBeInTheDocument();
    expect(
      screen.queryByText("配置后台轮询 npm 的节奏。相关偏好会持久化到设置文件。")
    ).not.toBeInTheDocument();
  });

  it("checks for updates and stores a toast when a newer version is returned", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      version: 1,
      currentVersion: "0.4.0",
      latestVersion: "0.6.0",
      availability: "update_available",
      updateStatus: "idle",
      lastCheckedAt: 321,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
      supported: true,
      installKind: "global_npm",
      unsupportedReason: null,
    } satisfies UpdateStateView);
    const { store } = renderAboutSettings({ dispatch });

    fireEvent.click(screen.getByRole("button", { name: "立即检查" }));

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith("updates.check", {}, undefined);
    });

    await waitFor(() => {
      expect(store.get(updateStateAtom)?.latestVersion).toBe("0.6.0");
    });
    expect(store.get(toastsAtom)).toHaveLength(0);
  });

  it("opens confirmation when active work exists before install", async () => {
    const prepareResponse: UpdatePrepareInstallResponse = {
      version: 1,
      currentVersion: "0.4.0",
      latestVersion: "0.5.0",
      availability: "update_available",
      updateStatus: "idle",
      lastCheckedAt: 123,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
      supported: true,
      installKind: "global_npm",
      unsupportedReason: null,
      canStartInstall: true,
      activity: {
        runningTerminalCount: 1,
        runningSessionCount: 1,
        runningSupervisorCount: 0,
        hasActiveWork: true,
      },
    };
    const dispatch = vi.fn().mockImplementation(async (op: string) => {
      if (op === "updates.prepareInstall") {
        return prepareResponse;
      }
      throw new Error(`unexpected op: ${op}`);
    });
    const { store } = renderAboutSettings({ dispatch });

    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith("updates.prepareInstall", {}, undefined);
    });

    await waitFor(() => {
      expect(screen.getByText("确认更新")).toBeInTheDocument();
    });
    expect(store.get(updatePrepareInstallAtom)?.activity.hasActiveWork).toBe(true);
  });

  it("calls preference change handlers for auto-check controls", () => {
    const onAutoCheckEnabledChange = vi.fn();
    const onCheckIntervalChange = vi.fn();

    renderAboutSettings({
      onAutoCheckEnabledChange,
      onCheckIntervalChange,
    });

    fireEvent.click(screen.getByRole("switch", { name: "自动检查更新" }));
    fireEvent.click(screen.getByRole("tab", { name: "12 小时" }));

    expect(onAutoCheckEnabledChange).toHaveBeenCalledWith(false);
    expect(onCheckIntervalChange).toHaveBeenCalledWith(43200);
  });

  it("disables the interval control when auto-check is off", () => {
    renderAboutSettings({
      autoCheckEnabled: false,
    });

    expect(screen.getByRole("switch", { name: "自动检查更新" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.getByRole("tablist", { name: "检查间隔" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "1 小时" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "6 小时" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "12 小时" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "24 小时" })).toBeDisabled();
  });

  it("disables update actions while a check is already in progress", () => {
    renderAboutSettings({
      updateState: {
        version: 1,
        currentVersion: "0.4.0",
        latestVersion: "0.5.0",
        availability: "update_available",
        updateStatus: "checking",
        lastCheckedAt: 123,
        targetVersion: null,
        startedAt: null,
        finishedAt: null,
        requiresManualStep: false,
        manualCommand: null,
        errorSummary: null,
        supported: true,
        installKind: "global_npm",
        unsupportedReason: null,
      },
    });

    expect(screen.getByRole("button", { name: "立即检查" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "立即更新" })).toBeDisabled();
  });

  it("renders only update status details for the update-status subview", () => {
    renderAboutSettings({ view: "update-status" });

    expect(screen.getByText("最新版本")).toBeInTheDocument();
    expect(screen.queryByText("产品名称")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "自动检查更新" })).not.toBeInTheDocument();
  });

  it("renders only automatic update controls for the auto-update subview", () => {
    renderAboutSettings({ view: "auto-update" });

    expect(screen.getByRole("switch", { name: "自动检查更新" })).toBeInTheDocument();
    expect(screen.queryByText("产品名称")).not.toBeInTheDocument();
    expect(screen.queryByText("最新版本")).not.toBeInTheDocument();
  });
});
