import { fireEvent, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it } from "vitest";
import { focusModeAtom } from "../../workspace/atoms";
import { FocusMode } from "./focus-mode";

function renderFocusModeWithStore(initialFocusMode: boolean) {
  const store = createStore();
  store.set(focusModeAtom, initialFocusMode);

  render(
    <Provider store={store}>
      <FocusMode />
    </Provider>
  );

  return store;
}

describe("FocusMode escape priority", () => {
  it("does not close focus mode while native fullscreen is active", () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => document.body,
    });

    const store = renderFocusModeWithStore(true);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(store.get(focusModeAtom)).toBe(true);
  });

  it("still exits focus mode when fullscreen is not active", () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => null,
    });

    const store = renderFocusModeWithStore(true);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(store.get(focusModeAtom)).toBe(false);
  });
});
