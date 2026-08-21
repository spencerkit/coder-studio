import { render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./app";
import { authenticatedAtom } from "./atoms/app-ui";
import { authEnabledAtom, connectionStatusAtom } from "./atoms/connection";

vi.mock("./app/runtime-shell", () => ({
  RuntimeShell: () => <div data-testid="runtime-shell">RuntimeShell</div>,
}));

vi.mock("./features/canvas/routes/embedded-canvas-route", () => ({
  EmbeddedCanvasRoute: () => <div data-testid="embedded-canvas-route">EmbeddedCanvasRoute</div>,
}));

vi.mock("./features/canvas/routes/embedded-canvas-snapshot-route", () => ({
  EmbeddedCanvasSnapshotRoute: () => (
    <div data-testid="embedded-canvas-snapshot-route">EmbeddedCanvasSnapshotRoute</div>
  ),
}));

function setMatchMediaMock(predicate: (query: string) => boolean) {
  const matchMedia = vi.fn((query: string) => ({
    addEventListener: vi.fn(),
    matches: predicate(query),
    media: query,
    removeEventListener: vi.fn(),
  }));
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
}

describe("App shell selection", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the runtime shell on the app route", async () => {
    setMatchMediaMock(() => false);
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(await screen.findByTestId("runtime-shell")).toBeInTheDocument();
  });

  it("renders the embedded canvas route outside the app shells", async () => {
    setMatchMediaMock(() => false);
    window.history.replaceState(
      {},
      "",
      "/embedded/canvas/ws-1?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc"
    );
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(await screen.findByTestId("embedded-canvas-route")).toBeInTheDocument();
    expect(screen.queryByTestId("runtime-shell")).not.toBeInTheDocument();
  });

  it("renders the embedded canvas snapshot route outside the app shells", async () => {
    setMatchMediaMock(() => false);
    window.history.replaceState({}, "", "/embedded/canvas-snapshot/snapshot_123");
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(await screen.findByTestId("embedded-canvas-snapshot-route")).toBeInTheDocument();
    expect(screen.queryByTestId("runtime-shell")).not.toBeInTheDocument();
  });
});
