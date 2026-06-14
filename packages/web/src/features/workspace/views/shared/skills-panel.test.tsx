// @vitest-environment jsdom

import { Topics } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { SkillsPanel } from "./skills-panel";

const translations: Record<string, string> = {
  "common.loading": "Loading...",
  "common.cancel": "Cancel",
  "skills.title": "Skill Library",
  "skills.discover_title": "Discover",
  "skills.recommendations_title": "Recommended",
  "skills.recommendations_expand_label": "Expand Recommendations",
  "skills.recommendations_collapse_label": "Collapse Recommendations",
  "skills.no_recommendations": "No recommendations for this workspace yet.",
  "skills.installed_title": "Installed Skills",
  "skills.builtin_title": "Built-in Skills",
  "skills.installed_expand_label": "Expand Installed Skills",
  "skills.installed_collapse_label": "Collapse Installed Skills",
  "skills.builtin_expand_label": "Expand Built-in Skills",
  "skills.builtin_collapse_label": "Collapse Built-in Skills",
  "skills.discover_expand_label": "Expand Discover",
  "skills.discover_collapse_label": "Collapse Discover",
  "skills.search": "Search skills",
  "skills.search_placeholder": "Search by name or slug",
  "skills.search_hint": "Search the Skills Hub to install a skill.",
  "skills.no_search_results": "No skills matched your search.",
  "skills.targets.unconfigured": "Not configured",
  "skills.scan": "Refresh",
  "skills.empty_installed": "No installed skills yet.",
  "skills.empty_builtin": "No built-in skills yet.",
  "skills.available": "Available",
  "skills.installed": "Installed",
  "skills.install": "Install",
  "skills.check_versions": "Check versions",
  "skills.checking_versions": "Checking...",
  "skills.update": "Update",
  "skills.version_up_to_date": "Latest",
  "skills.version_update_available": "Update {{version}}",
  "skills.version_update_available_unknown": "Update available",
  "skills.version_unknown": "Unknown",
  "skills.version_check_failed": "Check failed",
  "skills.uninstall": "Uninstall",
  "skills.uninstall_tooltip":
    "Disable this skill first, then remove it from the shared skill library.",
  "skills.uninstall_confirm_title": "Remove {{name}}?",
  "skills.uninstall_confirm_description":
    "This skill is enabled on {{count}} target(s). Removing it will disable it first, then delete it from the skill library.",
  "skills.uninstall_confirm_confirm": "Remove Skill",
  "skills.enable": "Enable",
  "skills.disable": "Disable",
  "skills.enable_skill": "Toggle {{name}} enabled",
  "skills.enable_skill_tooltip": "Enable this skill for every configured agent.",
  "skills.disable_skill_tooltip": "Disable this skill for enabled agents.",
  "skills.enable_skill_unavailable_tooltip": "No configured agents can use this skill yet.",
  "skills.builtin_enable_setting": "Enabled",
  "skills.builtin_enable_partial": "Partially enabled",
  "skills.builtin_enable_skill": "Toggle {{name}} enabled",
  "skills.builtin_enable_partial_skill": "Toggle partially enabled {{name}}",
  "skills.builtin_enable_targets": "Agents: {{targets}}",
  "skills.builtin_enable_no_targets": "No configured agents",
  "skills.detail_open": "Open {{name}} details",
  "skills.detail_back": "Back to skills",
  "skills.detail_library_path": "Library path",
  "skills.detail_source": "Source",
  "skills.detail_targets": "Agent Status",
  "skills.summary_state.mounted": "Enabled",
  "skills.summary_state.unmounted": "Disabled",
  "skills.summary_state.unconfigured": "Disabled",
  "skills.summary_reason.mounted_path": "Enabled at {{path}}",
  "skills.summary_reason.unconfigured": "No skill directory configured",
  "skills.summary_reason.unmounted_generic": "Not enabled",
  "skills.summary_reason.relation_stale": "Enable state needs repair",
  "skills.summary_reason.relation_missing_source": "Enabled source is missing",
  "skills.summary_reason.relation_missing_target": "Enabled target is missing",
  "skills.summary_reason.relation_failed": "Enable failed",
  "workspace.skills.title": "Skill Library",
  "workspace.skills.empty_title": "No skills in the library yet.",
  "workspace.skills.empty_body": "Install skills to populate this panel.",
  "workspace.skills.load_failed": "Failed to load the skill library",
  "workspace.skills.status.installed": "Installed",
  "workspace.skills.status.installing": "Installing",
  "workspace.skills.status.failed": "Failed",
  "workspace.skills.source.skillhub": "skills-hub",
  "workspace.skills.source.local": "Local",
  "workspace.skills.source.builtin": "Built-in",
  "skills.mount_state.unmounted": "Disabled",
  "skills.mount_state.partially_mounted": "Enabled",
  "skills.mount_state.fully_mounted": "Enabled",
  "skills.mount_state.error": "Error",
};

const translate = (key: string, params?: Record<string, unknown>) => {
  const template = translations[key];
  if (!template) {
    return key;
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => `${params?.[token] ?? ""}`);
};

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => translate,
}));

const activeElementState = {
  current: null as HTMLElement | null,
};

const originalFocus = HTMLElement.prototype.focus;
type SkillLibraryEventHandler = (topic: string, payload: unknown, seq: number) => void;
type SubscribeMock = (topics: string[], handler: SkillLibraryEventHandler) => () => void;

function createSubscribeMock(): SubscribeMock {
  return vi.fn((_topics: string[], _handler: SkillLibraryEventHandler) => () => {});
}

function renderPanel(sendCommand: ReturnType<typeof vi.fn>, subscribe = createSubscribeMock()) {
  const store = createStore();
  store.set(wsClientAtom, { sendCommand, subscribe } as never);

  return render(
    <Provider store={store}>
      <SkillsPanel workspaceId="ws-1" />
    </Provider>
  );
}

function renderPanelWithProps(
  sendCommand: ReturnType<typeof vi.fn>,
  refreshToken?: number,
  subscribe = createSubscribeMock()
) {
  const store = createStore();
  store.set(wsClientAtom, { sendCommand, subscribe } as never);

  const view = render(
    <Provider store={store}>
      <SkillsPanel workspaceId="ws-1" refreshToken={refreshToken} />
    </Provider>
  );

  return { ...view, store };
}

async function expandInstalledSection() {
  const installedHeading = await screen.findByRole("heading", {
    level: 2,
    name: "Installed Skills",
  });
  const installedSection = installedHeading.closest("section");
  if (!installedSection) {
    throw new Error("Installed section not found");
  }

  const toggle = within(installedSection).getByRole("button", {
    name: /Expand Installed Skills|Collapse Installed Skills/,
  });

  if (toggle.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(toggle);
  }

  return installedSection;
}

async function expandBuiltinSection() {
  const builtinHeading = await screen.findByRole("heading", {
    level: 2,
    name: "Built-in Skills",
  });
  const builtinSection = builtinHeading.closest("section");
  if (!builtinSection) {
    throw new Error("Built-in section not found");
  }

  const toggle = within(builtinSection).getByRole("button", {
    name: /Expand Built-in Skills|Collapse Built-in Skills/,
  });

  if (toggle.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(toggle);
  }

  return builtinSection;
}

describe("SkillsPanel", () => {
  beforeEach(() => {
    activeElementState.current = document.body;

    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => activeElementState.current,
    });

    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      writable: true,
      value: function focus() {
        activeElementState.current = this;
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();

    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      writable: true,
      value: originalFocus,
    });
    Reflect.deleteProperty(document, "activeElement");
  });

  it("loads and renders skill library entries", async () => {
    const sendCommand = vi.fn(async (op: string, _args?: unknown, _options?: unknown) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["codex"],
            mountStatus: "partially_mounted",
            errorCount: 0,
          },
        ];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    expect(
      await screen.findByRole("heading", { level: 2, name: "Installed Skills" })
    ).toBeInTheDocument();
    await expandInstalledSection();
    const skillTitle = await screen.findByText("Code Review");
    const skillCard = skillTitle.closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    expect(skillTitle).toBeInTheDocument();
    expect(within(skillCard).getByText("code-review")).toBeInTheDocument();
    expect(within(skillCard).getByText("v1.2.3")).toBeInTheDocument();
    expect(screen.queryByText("Enabled")).not.toBeInTheDocument();
    expect(screen.getByText("Review code changes before merge")).toBeInTheDocument();
    expect(sendCommand).toHaveBeenCalledWith("skills.library.list", {}, undefined);
  });

  it("refreshes skill state when the server broadcasts a library change", async () => {
    let eventHandler: SkillLibraryEventHandler | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((_topics: string[], handler: SkillLibraryEventHandler) => {
      eventHandler = handler;
      return unsubscribe;
    });
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      return [];
    });

    renderPanel(sendCommand, subscribe);

    await waitFor(() => {
      expect(subscribe).toHaveBeenCalledWith([Topics.skillLibraryChanged], expect.any(Function));
    });

    const libraryCallsBeforeEvent = sendCommand.mock.calls.filter(
      ([op]) => op === "skills.library.list"
    ).length;
    const healthCallsBeforeEvent = sendCommand.mock.calls.filter(
      ([op]) => op === "skills.health.scan"
    ).length;

    eventHandler?.(Topics.skillLibraryChanged, { reason: "builtin_sync" }, 1);

    await waitFor(() => {
      expect(
        sendCommand.mock.calls.filter(([op]) => op === "skills.health.scan").length
      ).toBeGreaterThan(healthCallsBeforeEvent);
      expect(
        sendCommand.mock.calls.filter(([op]) => op === "skills.library.list").length
      ).toBeGreaterThan(libraryCallsBeforeEvent);
    });
  });

  it("checks installed Skill Hub versions and updates an available skill", async () => {
    const sendCommand = vi.fn(async (op: string, args?: unknown) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: [],
            mountStatus: "unmounted",
            errorCount: 0,
          },
        ];
      }

      if (op === "skills.versions.check") {
        return [
          {
            slug: "code-review",
            currentVersion: "1.2.3",
            latestVersion: "1.3.0",
            status: "update_available",
          },
        ];
      }

      if (op === "skills.update.start") {
        expect(args).toEqual({ slug: "code-review" });
        return {
          jobId: "job-update-1",
          slug: "code-review",
          status: "queued",
          steps: [],
        };
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    const installedSection = await expandInstalledSection();

    fireEvent.click(within(installedSection).getByRole("button", { name: "Check versions" }));

    expect(await within(installedSection).findByText("Update v1.3.0")).toBeInTheDocument();

    fireEvent.click(within(installedSection).getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "skills.update.start",
        { slug: "code-review" },
        undefined
      );
    });
  });

  it("truncates skill descriptions to one line and shows the full text on hover", async () => {
    const description =
      "Open any folder or repository inside a container and use the full development environment with all configured tools.";
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "dev-containers",
            displayName: "Dev Containers",
            description,
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/dev-containers",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: [],
            mountStatus: "unmounted",
            errorCount: 0,
          },
        ];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    await expandInstalledSection();
    const descriptionNode = await screen.findByText(description);
    expect(descriptionNode).toHaveClass("skills-panel__card-description");
    expect(descriptionNode).toHaveClass("skills-panel__card-description--truncated");

    fireEvent.mouseEnter(descriptionNode);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(description);
  });

  it("confirms before force deleting a mounted skill", async () => {
    const sendCommand = vi.fn(async (op: string, _args?: unknown, _options?: unknown) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "command-control",
            displayName: "Command Control",
            description: "Coordinate command workflows",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/command-control",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["claude"],
            mountStatus: "partially_mounted",
            errorCount: 0,
          },
        ];
      }

      if (op === "skills.health.scan") {
        return {
          targets: [
            {
              providerId: "claude",
              displayName: "Claude Code",
              kind: "built_in",
              skillDir: "/Users/test/.claude/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              lastHealthError: null,
              mountedSkillCount: 1,
            },
          ],
          mounts: [
            {
              providerId: "claude",
              skillSlug: "command-control",
              enabled: true,
              sourcePath: "/skills/library/command-control",
              targetPath: "/Users/test/.claude/skills/command-control",
              mountModeResolved: "symlink",
              status: "mounted",
            },
          ],
        };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      if (op === "skills.uninstall") {
        return { deleted: true, slug: "command-control" };
      }

      return [];
    });

    renderPanel(sendCommand);

    await expandInstalledSection();
    const skillCard = (await screen.findByText("Command Control")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    fireEvent.click(within(skillCard).getByRole("button", { name: "Uninstall" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Remove Command Control?");
    expect(
      sendCommand.mock.calls.some(
        ([op, args]) =>
          op === "skills.uninstall" &&
          (args as { slug?: string; force?: boolean }).slug === "command-control"
      )
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Remove Skill" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "skills.uninstall",
        { slug: "command-control", force: true },
        undefined
      );
    });
  });

  it("renders installed, built-in, recommendations, and discover sections", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    expect(
      await screen.findByRole("heading", { level: 2, name: "Installed Skills" })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Built-in Skills" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Recommended" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Discover" })).toBeInTheDocument();
  });

  it("renders recommended uninstalled skills", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.recommend") {
        return [
          {
            slug: "vite-testing",
            displayName: "Vite Testing",
            description:
              "Testing Vite apps with a description long enough that it should be constrained to a single visible line.",
            reason:
              "Matches Vite and test scripts with a reason long enough that it should use the same one-line presentation.",
            sourceQuery: "Vite",
            score: 10,
            installed: false,
          },
        ];
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Recommended",
      })
    ).toBeInTheDocument();
    expect(await screen.findByText("Vite Testing")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Testing Vite apps with a description long enough that it should be constrained to a single visible line."
      )
    ).toBeNull();
    expect(
      screen.getByText(
        "Matches Vite and test scripts with a reason long enough that it should use the same one-line presentation."
      )
    ).toHaveClass("skills-panel__card-description--truncated");
    const recommendationCard = screen.getByText("Vite Testing").closest("article");
    if (!recommendationCard) {
      throw new Error("Recommendation card not found");
    }
    const recommendationInstallButton = within(recommendationCard).getByRole("button", {
      name: "Install",
    });
    const recommendationActions = recommendationInstallButton.closest(
      ".skills-panel__card-head-actions"
    );
    expect(recommendationActions).not.toBeNull();
    expect(recommendationActions).toContainElement(
      within(recommendationCard).getByText("Available")
    );
    expect(sendCommand).toHaveBeenCalledWith(
      "skills.recommend",
      { workspaceId: "ws-1" },
      undefined
    );
  });

  it("refreshes recommendations when the panel refresh token changes", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.recommend") {
        return [];
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    const { rerender, store } = renderPanelWithProps(sendCommand, 0);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "skills.recommend",
        { workspaceId: "ws-1" },
        undefined
      );
    });

    const recommendationCallsBeforeRefresh = sendCommand.mock.calls.filter(
      ([op]) => op === "skills.recommend"
    ).length;

    rerender(
      <Provider store={store}>
        <SkillsPanel workspaceId="ws-1" refreshToken={1} />
      </Provider>
    );

    await waitFor(() => {
      const recommendationCallsAfterRefresh = sendCommand.mock.calls.filter(
        ([op]) => op === "skills.recommend"
      ).length;
      expect(recommendationCallsAfterRefresh).toBeGreaterThan(recommendationCallsBeforeRefresh);
    });
  });

  it("shows local skill versions without source labels in installed skill cards", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "local",
            source: "local",
            libraryPath: "/users/spencer/.agents/skills/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: [],
            mountStatus: "unmounted",
            errorCount: 0,
          },
        ];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    await expandInstalledSection();
    const skillCard = (await screen.findByText("Code Review")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    expect(within(skillCard).getByText("code-review")).toBeInTheDocument();
    expect(within(skillCard).getByText("local")).toBeInTheDocument();
    expect(within(skillCard).queryByText("Local")).toBeNull();
  });

  it("separates built-in skills into their own section", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["codex"],
            mountStatus: "partially_mounted",
            errorCount: 0,
          },
          {
            slug: "coder-studio-example-builtin",
            displayName: "Coder Studio Example Builtin",
            description: "Test fixture for built-in skill UI behavior.",
            version: "1.0.0",
            source: "builtin",
            libraryPath: "/skills/builtin/coder-studio-example-builtin",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["codex"],
            mountStatus: "partially_mounted",
            errorCount: 0,
            builtin: { defaultEnabled: true, autoMount: false },
          },
        ];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    const installedSection = await expandInstalledSection();
    const builtinSection = await expandBuiltinSection();

    const installedHeading = await screen.findByRole("heading", {
      level: 2,
      name: "Installed Skills",
    });
    const builtinHeading = screen.getByRole("heading", {
      level: 2,
      name: "Built-in Skills",
    });
    const installedSectionFromHeading = installedHeading.closest("section");
    const builtinSectionFromHeading = builtinHeading.closest("section");
    if (!installedSectionFromHeading || !builtinSectionFromHeading) {
      throw new Error("Skill sections not found");
    }

    expect(within(installedSection).getByText("Code Review")).toBeInTheDocument();
    expect(within(installedSection).getByText("v1.2.3")).toBeInTheDocument();
    expect(within(installedSection).queryByText("Coder Studio Example Builtin")).toBeNull();
    expect(within(builtinSection).getByText("Coder Studio Example Builtin")).toBeInTheDocument();
    expect(within(builtinSection).queryByText("v1.0.0")).toBeNull();
    expect(within(builtinSection).queryByText("Code Review")).toBeNull();
  });

  it("does not render uninstall actions for built-in skills", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: [],
            mountStatus: "unmounted",
            errorCount: 0,
          },
          {
            slug: "coder-studio-example-builtin",
            displayName: "Coder Studio Example Builtin",
            description: "Test fixture for built-in skill UI behavior.",
            version: "1.0.0",
            source: "builtin",
            libraryPath: "/skills/builtin/coder-studio-example-builtin",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: [],
            mountStatus: "unmounted",
            errorCount: 0,
            builtin: { defaultEnabled: true, autoMount: false },
          },
        ];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    const installedSection = await expandInstalledSection();
    const builtinSection = await expandBuiltinSection();

    const installedHeading = await screen.findByRole("heading", {
      level: 2,
      name: "Installed Skills",
    });
    const builtinHeading = screen.getByRole("heading", {
      level: 2,
      name: "Built-in Skills",
    });
    const installedSectionFromHeading = installedHeading.closest("section");
    const builtinSectionFromHeading = builtinHeading.closest("section");
    if (!installedSectionFromHeading || !builtinSectionFromHeading) {
      throw new Error("Skill sections not found");
    }

    expect(within(installedSection).getByRole("button", { name: "Uninstall" })).toBeVisible();
    expect(within(builtinSection).queryByRole("button", { name: "Uninstall" })).toBeNull();
  });

  it("opens a skill detail view from a library row", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["codex"],
            mountStatus: "partially_mounted",
            errorCount: 0,
          },
        ];
      }

      if (op === "skills.health.scan") {
        return {
          targets: [
            {
              providerId: "codex",
              displayName: "Codex",
              kind: "built_in",
              skillDir: "/Users/test/.codex/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              mountedSkillCount: 1,
            },
          ],
          mounts: [
            {
              providerId: "codex",
              skillSlug: "code-review",
              enabled: true,
              sourcePath: "/skills/library/code-review",
              targetPath: "/Users/test/.codex/skills/code-review",
              mountModeResolved: "symlink",
              status: "mounted",
            },
          ],
        };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    await expandInstalledSection();
    fireEvent.click(await screen.findByText("Review code changes before merge"));

    expect(screen.getByRole("heading", { level: 2, name: "Code Review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to skills" })).toBeVisible();
    expect(screen.getByText("code-review")).toBeInTheDocument();
    expect(screen.getByText("Review code changes before merge")).toBeInTheDocument();
    expect(screen.getByText("/skills/library/code-review")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    const enabledStatus = screen.getByText("Enabled");
    const targetHead = enabledStatus.closest(".skills-panel__target-head");
    expect(targetHead).not.toBeNull();
    expect(targetHead).toContainElement(screen.getByText("Codex"));

    fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));

    expect(
      await screen.findByRole("heading", { level: 2, name: "Installed Skills" })
    ).toBeVisible();
  });

  it("toggles built-in skill auto-mount preference from the built-in section", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: [],
            mountStatus: "unmounted",
            errorCount: 0,
          },
          {
            slug: "coder-studio-example-builtin",
            displayName: "Coder Studio Example Builtin",
            description: "Test fixture for built-in skill UI behavior.",
            version: "1.0.0",
            source: "builtin",
            libraryPath: "/skills/builtin/coder-studio-example-builtin",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: [],
            mountStatus: "unmounted",
            errorCount: 0,
            builtin: { defaultEnabled: true, autoMount: false },
          },
        ];
      }

      if (op === "skills.health.scan") {
        return {
          targets: [
            {
              providerId: "claude",
              displayName: "Claude",
              kind: "built_in",
              skillDir: "/Users/test/.claude/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              mountedSkillCount: 0,
            },
            {
              providerId: "codex",
              displayName: "Codex",
              kind: "built_in",
              skillDir: "/Users/test/.codex/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              mountedSkillCount: 0,
            },
          ],
          mounts: [],
        };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      if (op === "skills.builtin.setMountEnabled") {
        return { libraryEntries: [], mounted: [], skipped: [], removed: [] };
      }

      return [];
    });

    renderPanel(sendCommand);

    const builtinSection = await expandBuiltinSection();

    const builtinHeading = await screen.findByRole("heading", {
      level: 2,
      name: "Built-in Skills",
    });
    const builtinSectionFromHeading = builtinHeading.closest("section");
    if (!builtinSectionFromHeading) {
      throw new Error("Built-in section not found");
    }

    expect(within(builtinSection).getAllByRole("switch")).toHaveLength(1);
    const autoMountSwitch = await within(builtinSection).findByRole("switch", {
      name: "Toggle Coder Studio Example Builtin enabled",
    });
    expect(autoMountSwitch).toHaveAttribute("aria-checked", "false");

    fireEvent.click(autoMountSwitch);

    await waitFor(() => {
      const builtinCalls = sendCommand.mock.calls.filter(
        ([op]) => op === "skills.builtin.setMountEnabled"
      );
      expect(builtinCalls).toHaveLength(2);
      expect(builtinCalls).toEqual([
        [
          "skills.builtin.setMountEnabled",
          {
            providerId: "claude",
            skillSlug: "coder-studio-example-builtin",
            enabled: true,
          },
          undefined,
        ],
        [
          "skills.builtin.setMountEnabled",
          {
            providerId: "codex",
            skillSlug: "coder-studio-example-builtin",
            enabled: true,
          },
          undefined,
        ],
      ]);
    });
    expect(
      within(
        screen.getByRole("heading", { level: 2, name: "Installed Skills" }).closest("section")!
      ).queryByRole("switch", { name: "Toggle Coder Studio Example Builtin enabled" })
    ).toBeNull();
  });

  it("disables built-in skills across configured and legacy mounted agents", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "coder-studio-example-builtin",
            displayName: "Coder Studio Example Builtin",
            description: "Test fixture for built-in skill UI behavior.",
            version: "1.0.0",
            source: "builtin",
            libraryPath: "/skills/builtin/coder-studio-example-builtin",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["codex", "claude", "legacy"],
            mountStatus: "fully_mounted",
            errorCount: 0,
            builtin: { defaultEnabled: true, autoMount: false },
          },
        ];
      }

      if (op === "skills.health.scan") {
        return {
          targets: [
            {
              providerId: "codex",
              displayName: "Codex",
              kind: "built_in",
              skillDir: "/Users/test/.codex/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              mountedSkillCount: 1,
            },
            {
              providerId: "claude",
              displayName: "Claude",
              kind: "built_in",
              skillDir: undefined,
              mountPreference: "auto",
              lastHealthState: "unconfigured",
              mountedSkillCount: 1,
            },
          ],
          mounts: [
            {
              providerId: "codex",
              skillSlug: "coder-studio-example-builtin",
              enabled: true,
              sourcePath: "/skills/builtin/coder-studio-example-builtin",
              targetPath: "/Users/test/.codex/skills/coder-studio-example-builtin",
              mountModeResolved: "symlink",
              status: "mounted",
            },
            {
              providerId: "claude",
              skillSlug: "coder-studio-example-builtin",
              enabled: true,
              sourcePath: "/skills/builtin/coder-studio-example-builtin",
              targetPath: "/Users/test/.claude/skills/coder-studio-example-builtin",
              mountModeResolved: "symlink",
              status: "mounted",
            },
            {
              providerId: "legacy",
              skillSlug: "coder-studio-example-builtin",
              enabled: true,
              sourcePath: "/skills/builtin/coder-studio-example-builtin",
              targetPath: "/Users/test/.legacy/skills/coder-studio-example-builtin",
              mountModeResolved: "symlink",
              status: "mounted",
            },
          ],
        };
      }

      if (op === "skills.builtin.setMountEnabled") {
        return { libraryEntries: [], mounted: [], skipped: [], removed: [] };
      }

      if (op === "skills.unmount") {
        return { ok: true };
      }

      return [];
    });

    renderPanel(sendCommand);

    const builtinSection = await expandBuiltinSection();

    const builtinHeading = await screen.findByRole("heading", {
      level: 2,
      name: "Built-in Skills",
    });
    const builtinSectionFromHeading = builtinHeading.closest("section");
    if (!builtinSectionFromHeading) {
      throw new Error("Built-in section not found");
    }

    const switchControl = await within(builtinSection).findByRole("switch", {
      name: "Toggle Coder Studio Example Builtin enabled",
    });
    expect(within(builtinSection).getByText("CX")).toHaveClass(
      "skills-panel__summary-token",
      "skills-panel__summary-token--mounted"
    );
    expect(within(builtinSection).getByText("CC")).toHaveClass(
      "skills-panel__summary-token",
      "skills-panel__summary-token--unconfigured"
    );

    fireEvent.click(switchControl);

    await waitFor(() => {
      const builtinCalls = sendCommand.mock.calls.filter(
        ([op]) => op === "skills.builtin.setMountEnabled"
      );
      expect(builtinCalls).toEqual([
        [
          "skills.builtin.setMountEnabled",
          {
            providerId: "codex",
            skillSlug: "coder-studio-example-builtin",
            enabled: false,
          },
          undefined,
        ],
        [
          "skills.builtin.setMountEnabled",
          {
            providerId: "claude",
            skillSlug: "coder-studio-example-builtin",
            enabled: false,
          },
          undefined,
        ],
        [
          "skills.builtin.setMountEnabled",
          {
            providerId: "legacy",
            skillSlug: "coder-studio-example-builtin",
            enabled: false,
          },
          undefined,
        ],
      ]);
    });

    await waitFor(() => {
      const unmountCalls = sendCommand.mock.calls.filter(([op]) => op === "skills.unmount");
      expect(unmountCalls).toEqual([
        [
          "skills.unmount",
          {
            providerId: "codex",
            skillSlug: "coder-studio-example-builtin",
          },
          undefined,
        ],
        [
          "skills.unmount",
          {
            providerId: "claude",
            skillSlug: "coder-studio-example-builtin",
          },
          undefined,
        ],
        [
          "skills.unmount",
          {
            providerId: "legacy",
            skillSlug: "coder-studio-example-builtin",
          },
          undefined,
        ],
      ]);
    });
  });

  it("shows an empty state when the library has no entries", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    await expandInstalledSection();
    await expandBuiltinSection();

    await waitFor(() => {
      expect(screen.getByText("No installed skills yet.")).toBeInTheDocument();
      expect(screen.getByText("No built-in skills yet.")).toBeInTheDocument();
    });
  });

  it("renders installed, built-in, discover, and recommendations sections in order", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    await screen.findByRole("heading", { level: 2, name: "Installed Skills" });
    const headings = screen.getAllByRole("heading", { level: 2 });

    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Installed Skills",
      "Built-in Skills",
      "Discover",
      "Recommended",
    ]);
  });

  it("sorts search results with installed skills first", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      if (op === "skills.search") {
        return [
          {
            slug: "zeta-tooling",
            displayName: "Zeta Tooling",
            description:
              "Available result with enough detail that the row should still stay aligned to a single visible line.",
            installed: false,
            mountedProviderIds: [],
          },
          {
            slug: "alpha-review",
            displayName: "Alpha Review",
            description: "Installed result",
            installed: true,
            installedVersion: "1.0.0",
            mountedProviderIds: [],
          },
          {
            slug: "beta-helper",
            displayName: "Beta Helper",
            description: "Available result",
            installed: false,
            mountedProviderIds: [],
          },
        ];
      }

      return [];
    });

    const { container } = renderPanel(sendCommand);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), {
      target: { value: "tool" },
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("skills.search", { query: "tool" }, undefined);
    });

    await waitFor(() => {
      const titles = Array.from(
        container.querySelectorAll<HTMLElement>(
          ".skills-panel__list-item--search .skills-panel__card-title"
        )
      );

      expect(titles.map((title) => title.textContent)).toEqual([
        "Alpha Review",
        "Beta Helper",
        "Zeta Tooling",
      ]);
      expect(screen.getByText("alpha-review")).toBeInTheDocument();
    });

    const availableDescription = screen.getByText(
      "Available result with enough detail that the row should still stay aligned to a single visible line."
    );
    expect(availableDescription).toHaveClass("skills-panel__card-description--truncated");
    const availableCard = screen.getByText("Zeta Tooling").closest("article");
    if (!availableCard) {
      throw new Error("Search result card not found");
    }
    const searchInstallButton = within(availableCard).getByRole("button", { name: "Install" });
    const searchActions = searchInstallButton.closest(".skills-panel__card-head-actions");
    expect(searchActions).not.toBeNull();
    expect(searchActions).toContainElement(within(availableCard).getByText("Available"));
  });

  it("opens an available skill detail view from search results", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      if (op === "skills.search") {
        return [
          {
            slug: "beta-helper",
            displayName: "Beta Helper",
            description: "Available result",
            version: "2.0.0",
            installed: false,
            mountedProviderIds: [],
          },
        ];
      }

      if (op === "skills.info") {
        return {
          slug: "beta-helper",
          displayName: "Beta Helper",
          description: "Helps with beta workflow",
          version: "2.0.0",
          installed: false,
          mounts: [],
        };
      }

      return [];
    });

    renderPanel(sendCommand);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), {
      target: { value: "beta" },
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("skills.search", { query: "beta" }, undefined);
    });

    fireEvent.click(await screen.findByText("Available result"));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "skills.info",
        {
          slug: "beta-helper",
        },
        undefined
      );
    });
    expect(screen.getByRole("heading", { level: 2, name: "Beta Helper" })).toBeInTheDocument();
    expect(screen.getByText("Helps with beta workflow")).toBeInTheDocument();
    expect(screen.getByText("v2.0.0")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Agent Status" })).toBeNull();

    const installButton = screen.getByRole("button", { name: "Install" });
    expect(installButton.closest(".skills-panel__card-head-actions")).not.toBeNull();

    fireEvent.click(installButton);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "skills.install.start",
        {
          slug: "beta-helper",
        },
        undefined
      );
    });
  });

  it("collapses and expands installed, built-in, recommendations, and discover sections independently", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: [],
            mountStatus: "unmounted",
            errorCount: 0,
          },
          {
            slug: "coder-studio-example-builtin",
            displayName: "Coder Studio Example Builtin",
            description: "Test fixture for built-in skill UI behavior.",
            version: "1.0.0",
            source: "builtin",
            libraryPath: "/skills/builtin/coder-studio-example-builtin",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: [],
            mountStatus: "unmounted",
            errorCount: 0,
            builtin: { defaultEnabled: true, autoMount: false },
          },
        ];
      }

      if (op === "skills.health.scan") {
        return { targets: [], mounts: [] };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    const installedHeading = await screen.findByRole("heading", {
      level: 2,
      name: "Installed Skills",
    });
    const installedSection = installedHeading.closest("section");
    if (!installedSection) {
      throw new Error("Installed section not found");
    }

    expect(
      within(installedSection).getByRole("button", { name: "Expand Installed Skills" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(within(installedSection).queryByText("Code Review")).toBeNull();
    expect(within(installedSection).getByRole("button", { name: "Refresh" })).toBeVisible();

    fireEvent.click(
      within(installedSection).getByRole("button", { name: "Expand Installed Skills" })
    );

    expect(await within(installedSection).findByText("Code Review")).toBeInTheDocument();

    fireEvent.click(
      within(installedSection).getByRole("button", { name: "Collapse Installed Skills" })
    );

    expect(
      within(installedSection).getByRole("button", { name: "Expand Installed Skills" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(within(installedSection).queryByText("Code Review")).toBeNull();

    const builtinHeading = screen.getByRole("heading", { level: 2, name: "Built-in Skills" });
    const builtinSection = builtinHeading.closest("section");
    if (!builtinSection) {
      throw new Error("Built-in section not found");
    }
    expect(
      within(builtinSection).getByRole("button", { name: "Expand Built-in Skills" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(within(builtinSection).queryByText("Coder Studio Example Builtin")).toBeNull();
    fireEvent.click(within(builtinSection).getByRole("button", { name: "Expand Built-in Skills" }));
    expect(await within(builtinSection).findByText("Coder Studio Example Builtin")).toBeVisible();

    fireEvent.click(
      within(builtinSection).getByRole("button", { name: "Collapse Built-in Skills" })
    );
    expect(
      within(builtinSection).getByRole("button", { name: "Expand Built-in Skills" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(within(builtinSection).queryByText("Coder Studio Example Builtin")).toBeNull();

    const discoverHeading = screen.getByRole("heading", { level: 2, name: "Discover" });
    const discoverSection = discoverHeading.closest("section");
    if (!discoverSection) {
      throw new Error("Discover section not found");
    }

    fireEvent.click(within(discoverSection).getByRole("button", { name: "Collapse Discover" }));

    expect(
      within(discoverSection).getByRole("button", { name: "Expand Discover" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(within(discoverSection).queryByRole("searchbox", { name: "Search skills" })).toBeNull();
    expect(within(discoverSection).queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("renders installed skill agent summaries without per-agent expansion controls", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["codex", "claude"],
            mountStatus: "fully_mounted",
            errorCount: 0,
          },
        ];
      }

      if (op === "skills.health.scan") {
        return {
          targets: [
            {
              providerId: "codex",
              displayName: "Codex CLI",
              kind: "built_in",
              skillDir: "/Users/test/.codex/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              lastHealthError: null,
              mountedSkillCount: 1,
            },
            {
              providerId: "claude",
              displayName: "Claude Code",
              kind: "built_in",
              skillDir: "/Users/test/.claude/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              lastHealthError: null,
              mountedSkillCount: 0,
            },
            {
              providerId: "gemini",
              displayName: "Gemini CLI",
              kind: "built_in",
              skillDir: undefined,
              mountPreference: "auto",
              lastHealthState: "unconfigured",
              lastHealthError: null,
              mountedSkillCount: 0,
            },
          ],
          mounts: [
            {
              providerId: "codex",
              skillSlug: "code-review",
              enabled: true,
              sourcePath: "/skills/library/code-review",
              targetPath: "/Users/test/.codex/skills/code-review",
              mountModeResolved: "symlink",
              status: "mounted",
            },
            {
              providerId: "claude",
              skillSlug: "code-review",
              enabled: true,
              sourcePath: "/skills/library/code-review",
              targetPath: "/Users/test/.claude/skills/code-review",
              mountModeResolved: "symlink",
              status: "mounted",
            },
          ],
        };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    await expandInstalledSection();
    const skillCard = (await screen.findByText("Code Review")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    expect(within(skillCard).queryByRole("button", { name: "Expand Code Review" })).toBeNull();
    const enableSwitch = within(skillCard).getByRole("switch", {
      name: "Toggle Code Review enabled",
    });
    expect(enableSwitch).toHaveAttribute("aria-checked", "true");
    fireEvent.mouseEnter(enableSwitch);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Disable this skill for enabled agents."
    );
    fireEvent.mouseLeave(enableSwitch);
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    const uninstallButton = within(skillCard).getByRole("button", { name: "Uninstall" });
    expect(uninstallButton).toBeVisible();
    expect(uninstallButton).toHaveClass("btn-secondary");
    expect(uninstallButton).not.toHaveClass("btn-ghost");
    fireEvent.mouseEnter(uninstallButton);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Disable this skill first, then remove it from the shared skill library."
    );
    fireEvent.mouseLeave(uninstallButton);
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
    expect(within(skillCard).getByText("CX")).toHaveClass(
      "skills-panel__summary-token",
      "skills-panel__summary-token--mounted"
    );
    expect(within(skillCard).getByText("CC")).toHaveClass(
      "skills-panel__summary-token",
      "skills-panel__summary-token--mounted"
    );
    expect(within(skillCard).getByText("GM")).toHaveClass(
      "skills-panel__summary-token",
      "skills-panel__summary-token--unconfigured"
    );
    expect(within(skillCard).queryByText("Codex CLI")).toBeNull();
    expect(within(skillCard).queryByRole("button", { name: "Mount" })).toBeNull();
    expect(within(skillCard).queryByRole("button", { name: "Unmount" })).toBeNull();
    expect(within(skillCard).queryByRole("button", { name: "Repair" })).toBeNull();
  });

  it("renders built-in skill agent summaries beside the title switch", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "coder-studio-example-builtin",
            displayName: "Coder Studio Example Builtin",
            description: "Test fixture for built-in skill UI behavior.",
            version: "1.0.0",
            source: "builtin",
            libraryPath: "/skills/builtin/coder-studio-example-builtin",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["codex"],
            mountStatus: "partially_mounted",
            errorCount: 0,
            builtin: { defaultEnabled: true, autoMount: false },
          },
        ];
      }

      if (op === "skills.health.scan") {
        return {
          targets: [
            {
              providerId: "codex",
              displayName: "Codex CLI",
              kind: "built_in",
              skillDir: "/Users/test/.codex/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              lastHealthError: null,
              mountedSkillCount: 1,
            },
            {
              providerId: "claude",
              displayName: "Claude Code",
              kind: "built_in",
              skillDir: "/Users/test/.claude/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              lastHealthError: null,
              mountedSkillCount: 0,
            },
            {
              providerId: "gemini",
              displayName: "Gemini CLI",
              kind: "built_in",
              skillDir: undefined,
              mountPreference: "auto",
              lastHealthState: "unconfigured",
              lastHealthError: null,
              mountedSkillCount: 0,
            },
          ],
          mounts: [
            {
              providerId: "codex",
              skillSlug: "coder-studio-example-builtin",
              enabled: true,
              sourcePath: "/skills/builtin/coder-studio-example-builtin",
              targetPath: "/Users/test/.codex/skills/coder-studio-example-builtin",
              mountModeResolved: "symlink",
              status: "mounted",
            },
          ],
        };
      }

      return [];
    });

    renderPanel(sendCommand);

    await expandBuiltinSection();
    const skillCard = (await screen.findByText("Coder Studio Example Builtin")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    expect(
      within(skillCard).getByRole("switch", {
        name: "Toggle partially enabled Coder Studio Example Builtin",
      })
    ).toHaveAttribute("aria-checked", "false");
    expect(skillCard.querySelector(".skills-panel__builtin-enable-toggle-row")).toBeNull();
    expect(
      within(skillCard).queryByRole("button", {
        name: "Expand Coder Studio Example Builtin",
      })
    ).toBeNull();
    expect(within(skillCard).getByText("CX")).toHaveClass(
      "skills-panel__summary-token",
      "skills-panel__summary-token--mounted"
    );
    expect(within(skillCard).getByText("CC")).toHaveClass(
      "skills-panel__summary-token",
      "skills-panel__summary-token--unmounted"
    );
    expect(within(skillCard).getByText("GM")).toHaveClass(
      "skills-panel__summary-token",
      "skills-panel__summary-token--unconfigured"
    );
  });

  it("enables installed skills across all configured agents", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["claude"],
            mountStatus: "partially_mounted",
            errorCount: 0,
          },
        ];
      }

      if (op === "skills.health.scan") {
        return {
          targets: [
            {
              providerId: "claude",
              displayName: "Claude Code",
              kind: "built_in",
              skillDir: "/Users/test/.claude/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              lastHealthError: null,
              mountedSkillCount: 1,
            },
            {
              providerId: "codex",
              displayName: "Codex CLI",
              kind: "built_in",
              skillDir: "/Users/test/.codex/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              lastHealthError: null,
              mountedSkillCount: 0,
            },
            {
              providerId: "gemini",
              displayName: "Gemini CLI",
              kind: "built_in",
              skillDir: undefined,
              mountPreference: "auto",
              lastHealthState: "unconfigured",
              lastHealthError: null,
              mountedSkillCount: 0,
            },
          ],
          mounts: [
            {
              providerId: "claude",
              skillSlug: "code-review",
              enabled: true,
              sourcePath: "/skills/library/code-review",
              targetPath: "/Users/test/.claude/skills/code-review",
              mountModeResolved: "symlink",
              status: "mounted",
            },
          ],
        };
      }

      if (op === "skills.mount") {
        return {
          providerId: "codex",
          skillSlug: "code-review",
          enabled: true,
          sourcePath: "/skills/library/code-review",
          targetPath: "/Users/test/.codex/skills/code-review",
          mountModeResolved: "symlink",
          status: "mounted",
        };
      }

      return [];
    });

    renderPanel(sendCommand);

    await expandInstalledSection();
    const skillCard = (await screen.findByText("Code Review")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    const enableSwitch = within(skillCard).getByRole("switch", {
      name: "Toggle Code Review enabled",
    });
    fireEvent.mouseEnter(enableSwitch);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Enable this skill for every configured agent."
    );
    fireEvent.mouseLeave(enableSwitch);
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    fireEvent.click(enableSwitch);

    await waitFor(() => {
      const mountCalls = sendCommand.mock.calls.filter(([op]) => op === "skills.mount");
      expect(mountCalls).toEqual([
        [
          "skills.mount",
          {
            providerId: "codex",
            skillSlug: "code-review",
            enabled: true,
          },
          undefined,
        ],
      ]);
    });
  });

  it("re-enables stale installed skill mounts instead of leaving them without repair", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["claude"],
            mountStatus: "error",
            errorCount: 1,
          },
        ];
      }

      if (op === "skills.health.scan") {
        return {
          targets: [
            {
              providerId: "claude",
              displayName: "Claude Code",
              kind: "built_in",
              skillDir: "/Users/test/.claude/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              lastHealthError: null,
              mountedSkillCount: 1,
            },
            {
              providerId: "codex",
              displayName: "Codex CLI",
              kind: "built_in",
              skillDir: "/Users/test/.codex/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              lastHealthError: null,
              mountedSkillCount: 0,
            },
          ],
          mounts: [
            {
              providerId: "claude",
              skillSlug: "code-review",
              enabled: true,
              sourcePath: "/skills/library/code-review",
              targetPath: "/Users/test/.claude/skills/code-review",
              mountModeResolved: "symlink",
              status: "stale",
            },
          ],
        };
      }

      if (op === "skills.mount") {
        return {
          providerId: "claude",
          skillSlug: "code-review",
          enabled: true,
          sourcePath: "/skills/library/code-review",
          targetPath: "/Users/test/.claude/skills/code-review",
          mountModeResolved: "symlink",
          status: "mounted",
        };
      }

      return [];
    });

    renderPanel(sendCommand);

    await expandInstalledSection();
    const skillCard = (await screen.findByText("Code Review")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    fireEvent.click(within(skillCard).getByRole("switch", { name: "Toggle Code Review enabled" }));

    await waitFor(() => {
      const mountCalls = sendCommand.mock.calls.filter(([op]) => op === "skills.mount");
      expect(mountCalls).toEqual([
        [
          "skills.mount",
          {
            providerId: "claude",
            skillSlug: "code-review",
            enabled: true,
          },
          undefined,
        ],
        [
          "skills.mount",
          {
            providerId: "codex",
            skillSlug: "code-review",
            enabled: true,
          },
          undefined,
        ],
      ]);
    });
  });

  it("disables installed skills across configured and currently mounted agents", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["codex", "legacy"],
            mountStatus: "fully_mounted",
            errorCount: 0,
          },
        ];
      }

      if (op === "skills.health.scan") {
        return {
          targets: [
            {
              providerId: "codex",
              displayName: "Codex CLI",
              kind: "built_in",
              skillDir: "/Users/test/.codex/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              lastHealthError: null,
              mountedSkillCount: 1,
            },
          ],
          mounts: [
            {
              providerId: "codex",
              skillSlug: "code-review",
              enabled: true,
              sourcePath: "/skills/library/code-review",
              targetPath: "/Users/test/.codex/skills/code-review",
              mountModeResolved: "symlink",
              status: "mounted",
            },
            {
              providerId: "legacy",
              skillSlug: "code-review",
              enabled: true,
              sourcePath: "/skills/library/code-review",
              targetPath: "/Users/test/.legacy/skills/code-review",
              mountModeResolved: "symlink",
              status: "mounted",
            },
          ],
        };
      }

      if (op === "skills.unmount") {
        return { ok: true };
      }

      return [];
    });

    renderPanel(sendCommand);

    await expandInstalledSection();
    const skillCard = (await screen.findByText("Code Review")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    fireEvent.click(within(skillCard).getByRole("switch", { name: "Toggle Code Review enabled" }));

    await waitFor(() => {
      const unmountCalls = sendCommand.mock.calls.filter(([op]) => op === "skills.unmount");
      expect(unmountCalls).toEqual([
        [
          "skills.unmount",
          {
            providerId: "codex",
            skillSlug: "code-review",
          },
          undefined,
        ],
        [
          "skills.unmount",
          {
            providerId: "legacy",
            skillSlug: "code-review",
          },
          undefined,
        ],
      ]);
    });
  });

  it("shows installed skill target details as read-only in the detail view", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/skills/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["claude"],
            mountStatus: "error",
            errorCount: 1,
          },
        ];
      }

      if (op === "skills.health.scan") {
        return {
          targets: [
            {
              providerId: "claude",
              displayName: "Claude Code",
              kind: "built_in",
              skillDir: "/Users/test/.claude/skills",
              mountPreference: "auto",
              lastHealthState: "healthy",
              lastHealthError: null,
              mountedSkillCount: 1,
            },
          ],
          mounts: [
            {
              providerId: "claude",
              skillSlug: "code-review",
              enabled: true,
              sourcePath: "/skills/library/code-review",
              targetPath: "/Users/test/.claude/skills/code-review",
              mountModeResolved: "symlink",
              status: "stale",
            },
          ],
        };
      }

      if (op === "skills.targets.list") {
        return [];
      }

      return [];
    });

    renderPanel(sendCommand);

    await expandInstalledSection();
    const skillCard = (await screen.findByText("Code Review")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    fireEvent.click(within(skillCard).getByRole("button", { name: "Open Code Review details" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Code Review" })).toBeVisible();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Enable state needs repair")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mount" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unmount" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Repair" })).toBeNull();
  });
});
