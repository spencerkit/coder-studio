import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activationStatusAtom } from "../../atoms/activation";
import { localeAtom } from "../../atoms/app-ui";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../../atoms/workspaces";
import { MoreFeaturesPage } from "./page";
import { buildMorePath, parseMoreRoute } from "./routes";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

const echartsMock = vi.hoisted(() => {
  const chart = {
    dispose: vi.fn(),
    resize: vi.fn(),
    setOption: vi.fn(),
  };

  return {
    chart,
    init: vi.fn(() => chart),
  };
});

vi.mock("../../hooks/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

vi.mock("echarts", () => ({
  init: echartsMock.init,
}));

vi.mock("../settings/components/config-editor", () => ({
  ConfigEditor: ({ configType }: { configType: "claude" | "codex" }) => (
    <div data-testid={`config-editor-${configType}`}>{configType}</div>
  ),
}));

function LocationProbe() {
  const location = useLocation();

  return <div data-testid="location-display">{location.pathname}</div>;
}

function renderMorePage(
  initialEntries: string[] = ["/more"],
  options: {
    locale?: "en" | "zh";
    viewport?: "desktop" | "mobile";
    sendCommand?: ReturnType<typeof vi.fn>;
    hasActiveWorkspace?: boolean;
  } = {}
) {
  const store = createStore();
  store.set(localeAtom, options.locale ?? "en");
  store.set(connectionStatusAtom, "connected");
  store.set(activationStatusAtom, "active");
  if (options.hasActiveWorkspace ?? true) {
    store.set(workspacesLoadStateAtom, "ready");
    store.set(workspacesAtom, {
      "workspace-1": {
        id: "workspace-1",
        path: "/root/workspace/coder-studio",
        name: "coder-studio",
      },
    } as never);
    store.set(activeWorkspaceIdAtom, "workspace-1");
  }
  store.set(wsClientAtom, {
    sendCommand:
      options.sendCommand ??
      vi.fn().mockImplementation(async (op: string) => {
        if (op === "settings.get") {
          return {};
        }

        if (op === "provider.list") {
          return [];
        }

        if (op === "terminal.profiles.list") {
          return {
            profiles: [
              {
                id: "detected:bash",
                label: "Bash",
                source: "detected",
                runtime: "native",
                icon: "terminal",
              },
            ],
            resolvedDefaultProfileId: "detected:bash",
          };
        }

        if (op === "monitoring.get") {
          return {
            settings: {
              enabled: true,
              hostMetricsEnabled: true,
              runtimeSummaryEnabled: true,
              workspaceAttributionEnabled: true,
              subprocessDrilldownEnabled: false,
              sampleIntervalMs: 2000,
            },
            snapshot: {
              sampledAt: 10,
              mode: "standard",
              host: {
                cpuPercent: 72,
                memoryUsedBytes: 800,
                memoryTotalBytes: 1000,
                memoryAvailableBytes: 200,
                loadAverage: [1, 1, 1],
                uptimeSec: 60,
                pressure: "elevated",
              },
              runtime: {
                serverCpuPercent: 10,
                serverMemoryBytes: 100,
                totalManagedCpuPercent: 30,
                totalManagedMemoryBytes: 300,
                managedProcessCount: 4,
                cpuShareOfHostPercent: 41.67,
                memoryShareOfHostPercent: 30,
              },
              workspaces: [],
              sessions: [],
              subprocessGroups: [],
              backgroundGroups: [],
            },
            history: {
              host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
              runtime: {
                points: [{ sampledAt: 10, cpuPercent: 30, memoryBytes: 300, processCount: 4 }],
              },
              workspaces: {},
              sessions: {},
              subprocessGroups: {},
            },
            capabilities: {
              loadAverageAvailable: true,
              processMetricsAvailable: true,
              subprocessHistoryLimited: false,
            },
            telemetry: null,
          };
        }

        if (op === "work.analysis.dashboard.get") {
          return {
            version: 1,
            queryDigest: "dashboard-more-page",
            query: { timeRange: { preset: "30d" } },
            mode: "auto",
            requestedAt: Date.UTC(2026, 5, 6, 10),
            scanState: {
              mode: "auto",
              status: "succeeded",
              lastStartedAt: Date.UTC(2026, 5, 6, 9),
              lastCompletedAt: Date.UTC(2026, 5, 6, 9, 1),
              nextScheduledAt: Date.UTC(2026, 5, 6, 10),
              sourceDigest: "source-more-page",
              providerStatuses: [
                {
                  providerId: "codex",
                  status: "supported",
                  sessionCount: 1,
                  parseErrorCount: 0,
                  warningCount: 0,
                },
              ],
            },
            dashboard: {
              generatedAt: Date.UTC(2026, 5, 6, 9, 1),
              timeRange: {
                startAt: Date.UTC(2026, 4, 7, 10),
                endAt: Date.UTC(2026, 5, 6, 10),
                label: "30d",
              },
              filters: { timeRange: { preset: "30d" } },
              kpis: [
                { key: "totalTokens", label: "Total tokens", value: 205 },
                { key: "sessions", label: "Sessions", value: 1 },
                { key: "activeTime", label: "Active time", value: 30 * 60 * 1000 },
              ],
              trends: { tokenHourly: [], tokenDaily: [], hourHeatmap: [] },
              rankings: {
                projects: [
                  {
                    key: "/repo/project",
                    label: "/repo/project",
                    totalTokens: 205,
                    shareOfTokens: 1,
                    sessionCount: 1,
                    activeDurationMs: 0,
                    subtitle: "1 session",
                  },
                ],
                models: [
                  {
                    key: "codex/gpt-5-codex",
                    label: "codex / gpt-5-codex",
                    totalTokens: 205,
                    shareOfTokens: 1,
                    sessionCount: 1,
                    activeDurationMs: 0,
                  },
                ],
                agents: [
                  {
                    key: "codex",
                    label: "codex",
                    totalTokens: 205,
                    shareOfTokens: 1,
                    sessionCount: 1,
                    activeDurationMs: 0,
                  },
                ],
              },
              breakdowns: { tasks: [], tools: [], skills: [] },
              quality: {
                providers: [
                  {
                    providerId: "codex",
                    status: "supported",
                    sessionCount: 1,
                    parseErrorCount: 0,
                    warningCount: 0,
                  },
                ],
                warnings: [],
              },
            },
          };
        }

        if (op === "diagnostics.get") {
          return {
            context: "manual_check",
            canContinue: true,
            checks: [
              {
                id: "git-ready",
                code: "git_ready",
                status: "ready",
                version: "git version 2.49.0",
              },
            ],
            metadata: {},
            lspServices: [],
          };
        }

        return {};
      }),
    subscribe: vi.fn(() => () => {}),
  } as never);

  viewportMocks.viewport = options.viewport ?? "desktop";

  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={initialEntries}>
        <LocationProbe />
        <Routes>
          <Route path="/more/*" element={<MoreFeaturesPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

describe("more routes", () => {
  it("builds canonical more paths", () => {
    expect(buildMorePath()).toBe("/more");
    expect(buildMorePath("settings")).toBe("/more/settings");
    expect(buildMorePath("settings", "terminal")).toBe("/more/settings/terminal");
    expect(buildMorePath("analysis", "monitoring")).toBe("/more/analysis/monitoring");
  });

  it("parses valid more route shapes", () => {
    expect(parseMoreRoute("/more")).toEqual({
      isValid: true,
      category: null,
      section: null,
    });
    expect(parseMoreRoute("/more/settings")).toEqual({
      isValid: true,
      category: "settings",
      section: null,
    });
    expect(parseMoreRoute("/more/settings/general")).toEqual({
      isValid: true,
      category: "settings",
      section: "general",
    });
  });

  it("returns an explicit invalid state for malformed more paths", () => {
    expect(parseMoreRoute("/more/unknown")).toEqual({
      isValid: false,
      category: null,
      section: null,
    });
    expect(parseMoreRoute("/more/settings/general/extra")).toEqual({
      isValid: false,
      category: null,
      section: null,
    });
    expect(parseMoreRoute("/more/settings/")).toEqual({
      isValid: false,
      category: null,
      section: null,
    });
  });
});

describe("MoreFeaturesPage", () => {
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    viewportMocks.viewport = "desktop";
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        matches: optionsMatchMedia(query, viewportMocks.viewport),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
        addListener: () => undefined,
        removeListener: () => undefined,
      })),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value:
        originalMatchMedia ??
        vi.fn((query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
          addListener: () => undefined,
          removeListener: () => undefined,
        })),
    });
  });

  function optionsMatchMedia(query: string, viewport: "desktop" | "mobile") {
    if (query === "(max-width: 899px), (pointer: coarse)") {
      return viewport === "mobile";
    }

    return false;
  }

  it("renders desktop category tabs, left nav, and no visible route for deep-linked sections", () => {
    renderMorePage(["/more/analysis/monitoring"]);

    expect(screen.getByTestId("more-features-page")).toBeInTheDocument();
    expect(screen.getByTestId("more-features-page")).toHaveClass(
      "more-features-page--desktop-flush"
    );
    expect(document.querySelector(".more-features-page__frame--compact-top")).toBeTruthy();
    expect(
      document.querySelector(".more-features-page__page-header.page-header--secondary")
    ).toBeTruthy();
    expect(
      document.querySelector(".more-features-page__page-header.page-header--primary")
    ).toBeNull();
    expect(screen.getByRole("tab", { name: "Analysis & Diagnostics" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("button", { name: "Performance monitoring" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(
      document.querySelector(
        '.settings-nav-item-active [data-icon-semantic="nav.settings.monitoring"]'
      )
    ).toBeTruthy();
    expect(document.querySelector(".settings-nav-arrow")).toBeTruthy();
    expect(document.querySelector(".more-features-nav-item__copy")).toBeNull();
    expect(screen.queryByTestId("more-current-route")).not.toBeInTheDocument();
    expect(document.querySelector(".more-features-page__route")).toBeNull();
    expect(document.querySelector(".more-features-page__description")).toBeNull();
    expect(document.querySelector(".more-features-shell__nav-copy")).toBeNull();
    expect(document.querySelector(".more-features-content__title")).toBeNull();
    expect(document.querySelector(".more-features-content__description")).toBeNull();
    expect(document.querySelector(".more-features-shell__content--gutter")).toBeTruthy();
    expect(document.querySelector(".more-features-shell--top-flush")).toBeTruthy();
    expect(document.querySelector(".more-features-shell__nav--top-flush")).toBeTruthy();
    expect(document.querySelector(".more-features-content__panel--top-flush")).toBeTruthy();
    expect(document.querySelector(".more-features-shell__nav--inner-padded")).toBeTruthy();
    expect(document.querySelector(".more-features-shell__content--inner-padded")).toBeTruthy();
    expect(
      document.querySelector(".more-features-nav-item__label.settings-nav-label")
    ).toBeTruthy();
  });

  it("does not render desktop category tab descriptions for the active category", () => {
    renderMorePage(["/more/settings/general"], { locale: "zh" });

    expect(screen.getByRole("tab", { name: "设置" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("调整工作区行为、provider、外观和快捷键。")).not.toBeInTheDocument();
    expect(document.querySelector(".more-features-tab__copy")).toBeNull();
  });

  it("canonicalizes the desktop root route to the default settings section", async () => {
    renderMorePage(["/more"]);

    expect(await screen.findByTestId("location-display")).toHaveTextContent(
      "/more/settings/general"
    );
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("more-current-route")).not.toBeInTheDocument();
  });

  it("canonicalizes category-only desktop routes to that category's default section", async () => {
    renderMorePage(["/more/analysis"]);

    expect(await screen.findByTestId("location-display")).toHaveTextContent(
      "/more/analysis/analytics"
    );
    expect(screen.getByRole("button", { name: "Work Analysis" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.queryByTestId("more-current-route")).not.toBeInTheDocument();
  });

  it("canonicalizes malformed desktop routes to the fallback settings section", async () => {
    renderMorePage(["/more/not-a-category"]);

    expect(await screen.findByTestId("location-display")).toHaveTextContent(
      "/more/settings/general"
    );
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("more-current-route")).not.toBeInTheDocument();
  });

  it("canonicalizes invalid sections within a valid desktop category to that category default", async () => {
    renderMorePage(["/more/analysis/not-a-section"]);

    expect(await screen.findByTestId("location-display")).toHaveTextContent(
      "/more/analysis/analytics"
    );
    expect(screen.getByRole("tab", { name: "Analysis & Diagnostics" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("button", { name: "Work Analysis" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("navigates category tabs to the default section for that category", async () => {
    const user = userEvent.setup();

    renderMorePage(["/more/analysis/monitoring"]);

    await user.click(screen.getByRole("tab", { name: "Settings" }));

    expect(screen.getByTestId("location-display")).toHaveTextContent("/more/settings/general");
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("more-current-route")).not.toBeInTheDocument();
  });

  it("supports keyboard navigation between category tabs using arrow keys", async () => {
    renderMorePage(["/more/settings/general"]);

    const settingsTab = screen.getByRole("tab", { name: "Settings" });
    fireEvent.keyDown(settingsTab, { key: "ArrowRight" });

    expect(screen.getByRole("tab", { name: "Analysis & Diagnostics" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Analysis & Diagnostics" })).toHaveAttribute(
      "tabindex",
      "0"
    );
    expect(screen.getByTestId("location-display")).toHaveTextContent("/more/analysis/analytics");
    expect(screen.queryByTestId("more-current-route")).not.toBeInTheDocument();
  });

  it("renders a desktop back button and falls back to /workspace when no prior history exists", async () => {
    const user = userEvent.setup();

    renderMorePage(["/more/analysis/monitoring"]);

    await user.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-display")).toHaveTextContent("/workspace");
    });
  });

  it("returns to /workspace from the desktop back button even when prior history exists", async () => {
    const user = userEvent.setup();

    renderMorePage(["/more/settings/general", "/more/analysis/monitoring"]);

    await user.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-display")).toHaveTextContent("/workspace");
    });
  });

  it("renders embedded settings content for /more/settings/terminal", async () => {
    renderMorePage(["/more/settings/terminal"]);

    expect(await screen.findByTestId("location-display")).toHaveTextContent(
      "/more/settings/terminal"
    );
    expect(await screen.findByRole("heading", { name: /Terminal renderer/i })).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: /Desktop terminal font size/i })
    ).toBeInTheDocument();
    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
    expect(screen.queryByText("Section placeholder")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Settings" })).not.toBeInTheDocument();
  });

  it("exposes the terminal profiles anchor from the canonical terminal settings route", async () => {
    renderMorePage(["/more/settings/terminal#terminal-profiles"]);

    const terminalProfilesHeading = await screen.findByRole("heading", {
      name: "Terminal Profiles",
    });
    const terminalProfilesSection = document.getElementById("terminal-profiles");

    expect(screen.getByRole("button", { name: "Terminal" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(terminalProfilesSection).not.toBeNull();
    expect(terminalProfilesSection).toContainElement(terminalProfilesHeading);
    expect(terminalProfilesSection).toHaveClass("settings-group");
  });

  it("renders only the product subview for /more/about/product", async () => {
    renderMorePage(["/more/about/product"]);

    expect(await screen.findByText("Product")).toBeInTheDocument();
    expect(screen.queryByText("Latest Version")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /Automatic update checks/i })
    ).not.toBeInTheDocument();
  });

  it("renders analysis content for /more/analysis/analytics", async () => {
    renderMorePage(["/more/analysis/analytics"]);

    expect(await screen.findByText("Total tokens")).toBeInTheDocument();
    expect(screen.queryByText("Section placeholder")).not.toBeInTheDocument();
  });

  it("renders monitoring settings content for /more/analysis/monitoring without standalone chrome", async () => {
    renderMorePage(["/more/analysis/monitoring"]);

    expect(
      await screen.findByRole("switch", { name: "Enable performance monitoring" })
    ).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Time window" })).toBeInTheDocument();
    expect(await screen.findAllByText("Monitoring disabled")).toHaveLength(2);
    expect(
      screen.getByText(
        "No background sampling is running. Enable monitoring in settings before using this page."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 3, name: "Performance monitoring" })
    ).not.toBeInTheDocument();
  });

  it("renders embedded diagnostics content for /more/analysis/diagnostics", async () => {
    renderMorePage(["/more/analysis/diagnostics"]);

    expect(await screen.findByText(/Current version:\s*git version 2\.49\.0/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Diagnostics" })).not.toBeInTheDocument();
  });

  it("uses a progressive mobile drill-in flow from category to section detail", async () => {
    const user = userEvent.setup();

    renderMorePage(["/more"], { viewport: "mobile" });

    await user.click(screen.getByRole("button", { name: /^Settings/ }));
    expect(screen.getByTestId("location-display")).toHaveTextContent("/more/settings");

    await user.click(screen.getByRole("button", { name: /^General/ }));
    expect(screen.getByTestId("location-display")).toHaveTextContent("/more/settings/general");
    expect(await screen.findByText("Notifications")).toBeInTheDocument();
  });

  it("shows a back button on the mobile category root and falls back to /workspace", async () => {
    const user = userEvent.setup();

    renderMorePage(["/more"], { viewport: "mobile" });

    await user.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-display")).toHaveTextContent("/workspace");
    });
  });
});
