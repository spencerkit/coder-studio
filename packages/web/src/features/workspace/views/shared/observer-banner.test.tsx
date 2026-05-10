import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { fencingStateAtom } from "../../../../atoms/fencing";
import { ObserverBanner } from "./observer-banner";

const requestTakeoverMock = vi.fn();

vi.mock("../../../../hooks/use-fencing", () => ({
  useFencing: () => ({
    requestTakeover: requestTakeoverMock,
  }),
}));

describe("ObserverBanner", () => {
  it("renders the takeover action with shared button semantics", () => {
    const store = createStore();
    store.set(
      fencingStateAtom,
      new Map([
        [
          "ws-1",
          {
            isController: false,
            reason: "another_tab_active",
            tabId: "tab-1",
            lastHeartbeat: Date.now(),
          },
        ],
      ])
    );

    render(
      <Provider store={store}>
        <ObserverBanner workspaceId="ws-1" />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "接管控制" })).toHaveAttribute("type", "button");
  });

  it("disables the takeover action while a takeover request is in flight", async () => {
    let resolveTakeover: (() => void) | undefined;
    requestTakeoverMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveTakeover = resolve;
        })
    );

    const store = createStore();
    store.set(
      fencingStateAtom,
      new Map([
        [
          "ws-1",
          {
            isController: false,
            reason: "another_tab_active",
            tabId: "tab-1",
            lastHeartbeat: Date.now(),
          },
        ],
      ])
    );

    render(
      <Provider store={store}>
        <ObserverBanner workspaceId="ws-1" />
      </Provider>
    );

    const takeoverButton = screen.getByRole("button", { name: "接管控制" });
    fireEvent.click(takeoverButton);

    expect(requestTakeoverMock).toHaveBeenCalledTimes(1);
    expect(takeoverButton).toBeDisabled();
    expect(takeoverButton).toHaveTextContent("接管中...");

    resolveTakeover?.();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "接管控制" })).not.toBeDisabled();
    });
  });
});
