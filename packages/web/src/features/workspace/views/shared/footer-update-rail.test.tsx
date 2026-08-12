// @vitest-environment jsdom

import { createDefaultProductUpdateState, type ProductUpdateState } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { productUpdateStateAtom, updateControllerAtom } from "../../../updates/atoms";
import type { UpdateController } from "../../../updates/types";
import { FooterUpdateRail } from "./footer-update-rail";

function productState(status: ProductUpdateState["status"]): ProductUpdateState {
  const state = createDefaultProductUpdateState(
    {
      environment: "desktop-native",
      authority: "desktop",
      supported: true,
      unsupportedReason: null,
    },
    "0.6.0",
    null
  );
  return {
    ...state,
    status,
    components: [
      {
        id: "runtime:win32-x64",
        kind: "runtime",
        target: "win32-x64",
        currentVersion: "0.6.0",
        currentPublishedAt: null,
        targetVersion: "0.7.0",
        targetPublishedAt: null,
        status,
        progressPercent: null,
        downloaded: status === "ready",
        verified: status === "ready",
        errorSummary: null,
      },
    ],
  };
}

function controller(state: ProductUpdateState): UpdateController {
  return {
    kind: "desktop",
    getState: () => state,
    refresh: vi.fn(async () => state),
    check: vi.fn(async () => state),
    download: vi.fn(async () => state),
    retry: vi.fn(async () => state),
    cancelDownload: vi.fn(async () => state),
    prepare: vi.fn(async () => ({
      state,
      activity: {
        runningTerminalCount: 0,
        runningSessionCount: 0,
        runningSupervisorCount: 0,
        hasActiveWork: false,
      },
      canProceed: true,
    })),
    start: vi.fn(async () => state),
    getSettings: vi.fn(async () => null),
    setSettings: vi.fn(async () => null),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(),
  };
}

function renderRail(state: ProductUpdateState) {
  const store = createStore();
  const updateController = controller(state);
  store.set(localeAtom, "en");
  store.set(productUpdateStateAtom, state);
  store.set(updateControllerAtom, updateController);
  const rendered = render(
    <Provider store={store}>
      <MemoryRouter>
        <FooterUpdateRail />
      </MemoryRouter>
    </Provider>
  );
  return { ...rendered, store, controller: updateController };
}

describe("FooterUpdateRail", () => {
  it.each([
    ["available", "Download update"],
    ["ready", "Restart and update"],
    ["failed", "Retry"],
    ["manual_required", "View details"],
  ] as const)("renders actionable %s", (status, action) => {
    renderRail(productState(status));
    expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
  });

  it.each([
    "idle",
    "checking",
    "downloading",
    "restarting",
    "succeeded",
    "unsupported",
  ] as const)("hides non-actionable %s", (status) => {
    const { container } = renderRail(productState(status));
    expect(container).toBeEmptyDOMElement();
  });

  it("routes Desktop available directly to its download adapter", async () => {
    const state = productState("available");
    const result = renderRail(state);
    fireEvent.click(screen.getByRole("button", { name: "Download update" }));
    await waitFor(() => expect(result.controller.download).toHaveBeenCalledTimes(1));
  });
});
