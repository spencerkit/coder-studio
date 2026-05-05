import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import { ConfigDriftBanner } from "./index";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
  };
});

describe("ConfigDriftBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewportMocks.viewport = "desktop";
    routerMocks.navigate.mockReset();
  });

  it("shows an explicit error when audit loading fails", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockRejectedValue(new Error("boom"));

    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <ConfigDriftBanner />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("Codex 配置检查不可用")).toBeInTheDocument();
    });

    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders a compact global summary on mobile and routes to settings for details", async () => {
    viewportMocks.viewport = "mobile";

    const store = createStore();
    const sendCommand = vi.fn().mockResolvedValue({
      externalConfigAudit: {
        codex: {
          configPath: "/home/spencer/.codex/config.toml",
          exists: true,
          findings: [
            {
              id: "toml_notify",
              type: "toml_notify",
              severity: "warn",
              startLine: 11,
              endLine: 14,
              snippet: 'notify = ["agent-notify", "codex"]',
              message: "top-level notify conflicts with injected notify",
            },
          ],
        },
      },
    });

    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <ConfigDriftBanner />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("Codex 配置冲突（1 项）")).toBeInTheDocument();
    });

    expect(document.querySelector(".config-drift-banner--mobile-compact")).toBeTruthy();
    expect(screen.queryByText("显示详情")).toBeNull();
    expect(screen.queryByText("清理 1 项")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(routerMocks.navigate).toHaveBeenCalledWith("/settings");
  });
});
