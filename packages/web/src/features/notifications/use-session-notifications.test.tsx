import type { SessionState, Workspace } from "@coder-studio/core";
import { act, render, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pendingFocusSessionAtom, visibleMobileSessionIdAtom } from "../../atoms/app-ui";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import { sessionsAtom } from "../../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../../atoms/workspaces";
import { notificationPreferencesAtom, toastsAtom } from "./atoms";
import { useSessionNotifications } from "./use-session-notifications";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

const NotificationMock = vi.fn().mockImplementation(function () {
  return {
    close: vi.fn(),
    onclick: null,
  };
});
Object.assign(NotificationMock, {
  permission: "granted",
  requestPermission: vi.fn(),
}) as unknown;

class OscillatorMock {
  type = "sine";
  frequency = { value: 0 };
  connect(target: unknown) {
    return target;
  }
  start() {}
  stop() {}
}

class GainMock {
  gain = {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect(target: unknown) {
    return target;
  }
}

class AudioContextMock {
  currentTime = 0;
  destination = {};
  createOscillator() {
    return new OscillatorMock();
  }
  createGain() {
    return new GainMock();
  }
  close() {
    return Promise.resolve();
  }
}

class AudioElementMock {
  volume = 1;
  play() {
    return Promise.resolve();
  }
}

function Harness() {
  useSessionNotifications();
  return null;
}

function createSession(id: string, state: SessionState, workspaceId = "ws-1") {
  const now = Date.now();
  return {
    id,
    workspaceId,
    terminalId: "term-1",
    providerId: "codex",
    state,
    capability: "full" as const,
    startedAt: now - 5_000,
    lastActiveAt: now - 1_000,
    endedAt: state === "ended" ? now : undefined,
  };
}

/**
 * jsdom defaults `document.hidden` to `false`. We expose a getter we can
 * override per-test to simulate page-hidden / page-visible cases.
 */
let documentHidden = false;
function setDocumentHidden(value: boolean): void {
  documentHidden = value;
}

/** Seed a session as `running` so the trace will record an `activeSince`. */
function seedRunningSession(
  store: ReturnType<typeof createStore>,
  sessionId: string,
  workspaceId = "ws-1"
): void {
  store.set(sessionsAtom, {
    [sessionId]: createSession(sessionId, "running", workspaceId),
  });
}

/** Seed the workspaces map with a minimal entry so the body assembler can
 *  resolve a label. */
function seedWorkspace(
  store: ReturnType<typeof createStore>,
  id: string,
  overrides: Partial<Workspace> = {}
): void {
  const existing = store.get(workspacesAtom);
  const order = store.get(workspaceOrderAtom);
  const ws: Workspace = {
    id,
    path: `/tmp/${id}`,
    targetRuntime: "native",
    openedAt: 0,
    lastActiveAt: 0,
    uiState: { leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false },
    ...overrides,
  };
  store.set(workspacesAtom, { ...existing, [id]: ws });
  store.set(workspaceOrderAtom, order.includes(id) ? order : [...order, id]);
  store.set(workspacesLoadStateAtom, "ready");
}

describe("useSessionNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-23T00:00:00Z"));
    vi.stubGlobal("Notification", NotificationMock);
    vi.stubGlobal("Audio", AudioElementMock);
    vi.stubGlobal("AudioContext", AudioContextMock);
    viewportMocks.viewport = "desktop";
    setDocumentHidden(false);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => documentHidden,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    setDocumentHidden(false);
  });

  /**
   * Renders the harness, then runs `mutate` to flip the session into its
   * end state. Between mount and mutation we advance fake time so the trace
   * records `activeSince` and the duration check is satisfied.
   */
  function mountAndCompleteTurn(
    store: ReturnType<typeof createStore>,
    mutate: () => void,
    elapsedMs = 5_000
  ): void {
    render(
      <Provider store={store}>
        <Harness />
      </Provider>
    );
    act(() => {
      vi.advanceTimersByTime(elapsedMs);
      mutate();
    });
  }

  it("fires an in-app toast on running → idle when the user is in another workspace and the page is visible", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-other");
    store.set(activeWorkspaceIdAtom, "ws-other");
    store.set(wsClientAtom, {
      sendCommand: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as never);
    seedRunningSession(store, "sess-1", "ws-1");

    mountAndCompleteTurn(store, () => {
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "idle", "ws-1"),
      });
    });

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });

    expect(store.get(toastsAtom)[0]).toMatchObject({
      kind: "success",
      workspaceId: "ws-1",
      sessionId: "sess-1",
    });
    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it("suppresses the notification when the user is already viewing the originating workspace", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-1");
    store.set(activeWorkspaceIdAtom, "ws-1");
    seedRunningSession(store, "sess-1", "ws-1");

    mountAndCompleteTurn(store, () => {
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "idle", "ws-1"),
      });
    });

    await waitFor(() => {
      expect(store.get(sessionsAtom)["sess-1"]?.state).toBe("idle");
    });

    expect(store.get(toastsAtom)).toHaveLength(0);
    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it("keeps desktop behavior unchanged even when a different session is marked active in the same workspace", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-1", {
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
        activeSessionId: "sess-other",
      },
    });
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(visibleMobileSessionIdAtom, "sess-other");
    seedRunningSession(store, "sess-1", "ws-1");

    mountAndCompleteTurn(store, () => {
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "idle", "ws-1"),
      });
    });

    await waitFor(() => {
      expect(store.get(sessionsAtom)["sess-1"]?.state).toBe("idle");
    });

    expect(store.get(toastsAtom)).toHaveLength(0);
    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it("on mobile, visible-page completion in the same workspace still toasts when another session is currently visible", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-1");
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(visibleMobileSessionIdAtom, "sess-visible");
    seedRunningSession(store, "sess-completed", "ws-1");

    mountAndCompleteTurn(store, () => {
      store.set(sessionsAtom, {
        "sess-completed": createSession("sess-completed", "idle", "ws-1"),
      });
    });

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });

    expect(store.get(toastsAtom)[0]).toMatchObject({
      kind: "success",
      workspaceId: "ws-1",
      sessionId: "sess-completed",
    });
    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it("on mobile, visible-page completion stays silent when the completed session is the currently visible one", async () => {
    viewportMocks.viewport = "mobile";
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-1");
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(visibleMobileSessionIdAtom, "sess-1");
    seedRunningSession(store, "sess-1", "ws-1");

    mountAndCompleteTurn(store, () => {
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "idle", "ws-1"),
      });
    });

    await waitFor(() => {
      expect(store.get(sessionsAtom)["sess-1"]?.state).toBe("idle");
    });

    expect(store.get(toastsAtom)).toHaveLength(0);
    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it("uses a system push when the page is hidden, regardless of which workspace is active", async () => {
    setDocumentHidden(true);
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-1");
    store.set(activeWorkspaceIdAtom, "ws-1");
    seedRunningSession(store, "sess-1", "ws-1");

    mountAndCompleteTurn(store, () => {
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "idle", "ws-1"),
      });
    });

    await waitFor(() => {
      expect(NotificationMock).toHaveBeenCalledTimes(1);
    });

    expect(store.get(toastsAtom)).toHaveLength(0);
  });

  it("wires the system notification onclick to set pendingFocusSession and navigate to /workspace", async () => {
    setDocumentHidden(true);
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-current");
    seedWorkspace(store, "ws-target");
    store.set(activeWorkspaceIdAtom, "ws-current");
    window.history.pushState({}, "", "/settings");
    seedRunningSession(store, "sess-target", "ws-target");

    mountAndCompleteTurn(store, () => {
      store.set(sessionsAtom, {
        "sess-target": createSession("sess-target", "idle", "ws-target"),
      });
    });

    await waitFor(() => {
      expect(NotificationMock).toHaveBeenCalledTimes(1);
    });

    // Reach into the constructed notification instance and fire onclick.
    const notification = NotificationMock.mock.results[0]?.value as {
      onclick: (() => void) | null;
      close: () => void;
    };
    expect(notification?.onclick).toBeTypeOf("function");

    act(() => {
      notification.onclick?.();
    });

    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-target");
    expect(store.get(pendingFocusSessionAtom)).toBe("sess-target");
    expect(window.location.pathname).toBe("/workspace");
  });

  it("suppresses the notification when the resolved active workspace matches even if the raw active id is stale", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-1");
    store.set(activeWorkspaceIdAtom, "ws-missing");
    seedRunningSession(store, "sess-1", "ws-1");

    mountAndCompleteTurn(store, () => {
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "idle", "ws-1"),
      });
    });

    await waitFor(() => {
      expect(store.get(sessionsAtom)["sess-1"]?.state).toBe("idle");
    });

    expect(store.get(toastsAtom)).toHaveLength(0);
    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it("does not fire when the running → idle transition happens faster than the min-duration threshold", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-other");
    store.set(activeWorkspaceIdAtom, "ws-other");
    seedRunningSession(store, "sess-1", "ws-1");

    // Only 500ms elapsed — well under the 4s threshold.
    mountAndCompleteTurn(
      store,
      () => {
        store.set(sessionsAtom, {
          "sess-1": createSession("sess-1", "idle", "ws-1"),
        });
      },
      500
    );

    // Let any pending effects settle.
    await act(async () => {
      await Promise.resolve();
    });

    expect(store.get(toastsAtom)).toHaveLength(0);
    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it("still fires on running → ended even if the duration is short (long task crash / forced stop)", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-other");
    store.set(activeWorkspaceIdAtom, "ws-other");
    seedRunningSession(store, "sess-1", "ws-1");

    mountAndCompleteTurn(
      store,
      () => {
        store.set(sessionsAtom, {
          "sess-1": createSession("sess-1", "ended", "ws-1"),
        });
      },
      500
    );

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });
  });

  it("fires once per turn (running → idle → running → idle yields two notifications)", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-other");
    store.set(activeWorkspaceIdAtom, "ws-other");
    seedRunningSession(store, "sess-1", "ws-1");

    render(
      <Provider store={store}>
        <Harness />
      </Provider>
    );

    // Turn 1: running → (5s) → idle
    act(() => {
      vi.advanceTimersByTime(5_000);
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "idle", "ws-1"),
      });
    });

    await waitFor(() => expect(store.get(toastsAtom)).toHaveLength(1));

    // User submits → back to running
    act(() => {
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "running", "ws-1"),
      });
    });

    // Turn 2: running → (5s) → idle  → second notification
    act(() => {
      vi.advanceTimersByTime(5_000);
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "idle", "ws-1"),
      });
    });

    await waitFor(() => expect(store.get(toastsAtom)).toHaveLength(2));
  });

  it("does not retroactively fire when the user re-enables notifications mid-turn", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: false, soundEnabled: true });
    seedWorkspace(store, "ws-other");
    store.set(activeWorkspaceIdAtom, "ws-other");
    seedRunningSession(store, "sess-1", "ws-1");

    render(
      <Provider store={store}>
        <Harness />
      </Provider>
    );

    // While disabled, complete a turn — should be silently recorded.
    act(() => {
      vi.advanceTimersByTime(5_000);
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "idle", "ws-1"),
      });
    });

    // Re-enable — no toast should appear for the *already-completed* turn.
    act(() => {
      store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(store.get(toastsAtom)).toHaveLength(0);
  });

  it("builds a structured body with provider · workspace · duration on the first line", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-other");
    store.set(activeWorkspaceIdAtom, "ws-other");
    seedWorkspace(store, "ws-1", { name: "demo-app" });
    seedRunningSession(store, "sess-1", "ws-1");

    mountAndCompleteTurn(
      store,
      () => {
        store.set(sessionsAtom, {
          "sess-1": { ...createSession("sess-1", "idle", "ws-1"), providerId: "claude" },
        });
      },
      65_000 // 1m 5s elapsed
    );

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });
    const body = store.get(toastsAtom)[0]?.body ?? "";
    const [metaLine] = body.split("\n");
    expect(metaLine).toBe("Claude · demo-app · 1m 5s");
  });

  it("uses the session title for the notification title when one is available", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-other");
    store.set(activeWorkspaceIdAtom, "ws-other");
    store.set(sessionsAtom, {
      "sess-1": {
        ...createSession("sess-1", "running", "ws-1"),
        title: "run tests",
      },
    });

    mountAndCompleteTurn(store, () => {
      store.set(sessionsAtom, {
        "sess-1": {
          ...createSession("sess-1", "idle", "ws-1"),
          title: "run tests",
        },
      });
    });

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });

    expect(store.get(toastsAtom)[0]?.title).toBe("run tests 已完成");
  });

  it("uses the running→idle fixed hint as the body's second line", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-other");
    store.set(activeWorkspaceIdAtom, "ws-other");
    seedWorkspace(store, "ws-1", { name: "demo-app" });
    seedRunningSession(store, "sess-1", "ws-1");

    mountAndCompleteTurn(store, () => {
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "idle", "ws-1"),
      });
    });

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });
    const body = store.get(toastsAtom)[0]?.body ?? "";
    const lines = body.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("会话回合完成");
  });

  it("uses the running→ended fixed hint as the body's second line", async () => {
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
    seedWorkspace(store, "ws-other");
    store.set(activeWorkspaceIdAtom, "ws-other");
    seedWorkspace(store, "ws-1", { name: "demo-app" });
    seedRunningSession(store, "sess-1", "ws-1");

    mountAndCompleteTurn(
      store,
      () => {
        store.set(sessionsAtom, {
          "sess-1": createSession("sess-1", "ended", "ws-1"),
        });
      },
      500
    );

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });
    const body = store.get(toastsAtom)[0]?.body ?? "";
    const lines = body.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("会话已停止运行");
  });

  it("skips the chime when soundEnabled is false but still posts the toast", async () => {
    const playSpy = vi.spyOn(AudioElementMock.prototype, "play");
    const store = createStore();
    store.set(connectionStatusAtom, "disconnected");
    store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: false });
    seedWorkspace(store, "ws-other");
    store.set(activeWorkspaceIdAtom, "ws-other");
    seedRunningSession(store, "sess-1", "ws-1");

    mountAndCompleteTurn(store, () => {
      store.set(sessionsAtom, {
        "sess-1": createSession("sess-1", "idle", "ws-1"),
      });
    });

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });

    expect(playSpy).not.toHaveBeenCalled();
    playSpy.mockRestore();
  });
});
