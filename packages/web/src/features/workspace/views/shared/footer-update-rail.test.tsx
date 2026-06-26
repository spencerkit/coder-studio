// @vitest-environment jsdom

import type { UpdatePrepareInstallResponse, UpdateStateView } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serverInfoAtom, wsClientAtom } from "../../../../atoms/connection";
import { updatePrepareInstallAtom, updateStateAtom } from "../../../updates/atoms";
import { FooterUpdateRail } from "./footer-update-rail";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function createUpdateState(overrides: Partial<UpdateStateView> = {}): UpdateStateView {
  return {
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
    ...overrides,
  };
}

function renderFooterUpdateRail({
  dispatch = vi.fn(),
  updateState = null,
}: {
  dispatch?: ReturnType<typeof vi.fn>;
  updateState?: UpdateStateView | null;
} = {}) {
  const store = createStore();
  store.set(wsClientAtom, { sendCommand: dispatch } as never);
  store.set(serverInfoAtom, {
    version: "0.4.0",
    serverInstanceId: "server-123",
  });
  store.set(updateStateAtom, updateState);

  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/workspace"]}>
        <FooterUpdateRail />
      </MemoryRouter>
    </Provider>
  );

  return { store, dispatch, ...view };
}

describe("FooterUpdateRail", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders nothing when no footer-relevant update state is active", () => {
    const { container, rerender } = renderFooterUpdateRail({
      updateState: null,
    });

    expect(container).toBeEmptyDOMElement();

    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(serverInfoAtom, {
      version: "0.4.0",
      serverInstanceId: "server-123",
    });
    store.set(
      updateStateAtom,
      createUpdateState({
        availability: "up_to_date",
        updateStatus: "idle",
        latestVersion: null,
      })
    );

    rerender(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <FooterUpdateRail />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByRole("button", { name: "立即更新" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("检测到新版本");
  });

  it("renders discovery UI and starts install immediately when no active work exists", async () => {
    const prepared: UpdatePrepareInstallResponse = {
      ...createUpdateState(),
      canStartInstall: true,
      activity: {
        runningTerminalCount: 0,
        runningSessionCount: 0,
        runningSupervisorCount: 0,
        hasActiveWork: false,
      },
    };
    const started = createUpdateState({
      updateStatus: "installing",
      targetVersion: "0.5.0",
    });
    const dispatch = vi.fn().mockImplementation(async (op: string) => {
      if (op === "updates.prepareInstall") {
        return prepared;
      }
      if (op === "updates.startInstall") {
        return started;
      }
      throw new Error(`unexpected op: ${op}`);
    });
    const { store } = renderFooterUpdateRail({
      dispatch,
      updateState: createUpdateState(),
    });

    expect(screen.getByText("检测到新版本 v0.5.0")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith("updates.prepareInstall", {}, undefined);
    });
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        "updates.startInstall",
        { targetVersion: "0.5.0", force: false },
        undefined
      );
    });
    expect(store.get(updateStateAtom)?.updateStatus).toBe("installing");
    expect(store.get(updatePrepareInstallAtom)?.activity.hasActiveWork).toBe(false);
  });

  it("uses the existing confirmation flow when active work exists", async () => {
    const prepared: UpdatePrepareInstallResponse = {
      ...createUpdateState(),
      canStartInstall: true,
      activity: {
        runningTerminalCount: 1,
        runningSessionCount: 2,
        runningSupervisorCount: 3,
        hasActiveWork: true,
      },
    };
    const started = createUpdateState({
      updateStatus: "installing",
      targetVersion: "0.5.0",
    });
    const dispatch = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "updates.prepareInstall") {
        return prepared;
      }
      if (op === "updates.startInstall") {
        return started;
      }
      throw new Error(`unexpected op: ${op} ${JSON.stringify(args)}`);
    });
    const { store } = renderFooterUpdateRail({
      dispatch,
      updateState: createUpdateState(),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("确认更新")).toBeInTheDocument();
    expect(store.get(updatePrepareInstallAtom)?.activity.hasActiveWork).toBe(true);

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "立即更新" }));
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        "updates.startInstall",
        { targetVersion: "0.5.0", force: true },
        undefined
      );
    });
  });

  it("renders runtime statuses and routes detail actions to settings about", () => {
    const runtimeCases: Array<{
      state: UpdateStateView;
      text: string;
      action?: string;
    }> = [
      {
        state: createUpdateState({ updateStatus: "installing" }),
        text: "更新中...",
      },
      {
        state: createUpdateState({ updateStatus: "restarting" }),
        text: "正在重启服务...",
      },
      {
        state: createUpdateState({
          updateStatus: "failed",
          availability: "check_failed",
          errorSummary: "boom",
        }),
        text: "更新失败",
        action: "查看详情",
      },
      {
        state: createUpdateState({
          updateStatus: "manual_required",
          requiresManualStep: true,
          manualCommand: "npm i -g coder-studio",
        }),
        text: "需要手动处理",
        action: "查看详情",
      },
    ];

    for (const testCase of runtimeCases) {
      const { unmount } = renderFooterUpdateRail({
        dispatch: vi.fn(),
        updateState: testCase.state,
      });

      expect(screen.getByText(testCase.text)).toBeInTheDocument();

      if (testCase.action) {
        fireEvent.click(screen.getByRole("button", { name: testCase.action }));
        expect(navigateMock).toHaveBeenLastCalledWith("/more/about/update-status");
      }

      unmount();
    }
  });

  it("shows success briefly and then hides without mutating update state", async () => {
    vi.useFakeTimers();
    const successState = createUpdateState({
      updateStatus: "succeeded",
      targetVersion: "0.5.0",
    });
    const { store } = renderFooterUpdateRail({
      dispatch: vi.fn(),
      updateState: successState,
    });

    expect(screen.getByText("已更新到 v0.5.0")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText("已更新到 v0.5.0")).not.toBeInTheDocument();
    expect(store.get(updateStateAtom)).toEqual(successState);
  });
});
