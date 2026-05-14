import { act, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activationReasonAtom, activationStatusAtom } from "../../atoms/activation";
import { connectionStatusAtom, lastReconnectAttemptAtom } from "../../atoms/connection";
import { ConnectionStatusBanner } from "./connection-status-banner";

function renderBanner() {
  const store = createStore();

  render(
    <Provider store={store}>
      <ConnectionStatusBanner />
    </Provider>
  );

  return store;
}

describe("ConnectionStatusBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the unified reconnect message while reconnecting", () => {
    const store = renderBanner();

    act(() => {
      store.set(connectionStatusAtom, "reconnecting");
    });

    expect(screen.getByText("连接已断开，正在重新连接...")).toBeInTheDocument();
  });

  it("shows the displaced-session message instead of reconnecting when activation is gated", () => {
    const store = renderBanner();

    act(() => {
      store.set(activationStatusAtom, "gated");
      store.set(activationReasonAtom, "displaced");
      store.set(connectionStatusAtom, "disconnected");
    });

    expect(screen.getByText("另一个标签页已激活")).toBeInTheDocument();
    expect(screen.queryByText("连接已断开，正在重新连接...")).not.toBeInTheDocument();
  });

  it("shows the slow recovery hint after 25 seconds", () => {
    const startedAt = new Date("2026-05-14T00:00:00.000Z").getTime();
    vi.setSystemTime(startedAt + 25_000);
    const store = renderBanner();

    act(() => {
      store.set(connectionStatusAtom, "reconnecting");
      store.set(lastReconnectAttemptAtom, startedAt);
    });

    expect(
      screen.getByText("连接恢复较慢，可能是网络问题。如果长时间没有恢复，可以刷新页面。")
    ).toBeInTheDocument();
  });

  it("reveals the slow recovery hint after time passes without another status update", () => {
    const startedAt = new Date("2026-05-14T00:00:00.000Z").getTime();
    vi.setSystemTime(startedAt);
    const store = renderBanner();

    act(() => {
      store.set(connectionStatusAtom, "reconnecting");
      store.set(lastReconnectAttemptAtom, startedAt);
    });

    expect(
      screen.queryByText("连接恢复较慢，可能是网络问题。如果长时间没有恢复，可以刷新页面。")
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(25_000);
    });

    expect(
      screen.getByText("连接恢复较慢，可能是网络问题。如果长时间没有恢复，可以刷新页面。")
    ).toBeInTheDocument();
  });

  it("does not show the slow recovery hint before the threshold", () => {
    const startedAt = new Date("2026-05-14T00:00:00.000Z").getTime();
    vi.setSystemTime(startedAt + 24_000);
    const store = renderBanner();

    act(() => {
      store.set(connectionStatusAtom, "reconnecting");
      store.set(lastReconnectAttemptAtom, startedAt);
    });

    expect(
      screen.queryByText("连接恢复较慢，可能是网络问题。如果长时间没有恢复，可以刷新页面。")
    ).not.toBeInTheDocument();
  });
});
