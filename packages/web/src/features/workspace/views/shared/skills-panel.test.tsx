// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { SkillsPanel } from "./skills-panel";

const translations: Record<string, string> = {
  "common.loading": "Loading...",
  "skills.title": "Skill Library",
  "skills.discover_title": "Discover",
  "skills.library_title": "Installed Skills",
  "skills.discover_expand_label": "Expand Discover",
  "skills.discover_collapse_label": "Collapse Discover",
  "skills.library_expand_label": "Expand Installed Skills",
  "skills.library_collapse_label": "Collapse Installed Skills",
  "skills.search": "Search skills",
  "skills.search_placeholder": "Search by name or slug",
  "skills.search_hint": "Search the Skills Hub to install a skill.",
  "skills.no_search_results": "No skills matched your search.",
  "skills.targets.unconfigured": "Not configured",
  "skills.scan": "Refresh",
  "skills.empty_library": "No skills in the library yet.",
  "skills.available": "Available",
  "skills.installed": "Installed",
  "skills.install": "Install",
  "skills.uninstall": "Uninstall",
  "skills.mount": "Mount",
  "skills.unmount": "Unmount",
  "skills.repair": "Repair",
  "skills.skill_row_expand_label": "Expand {{name}}",
  "skills.skill_row_collapse_label": "Collapse {{name}}",
  "skills.summary_state.mounted": "Mounted",
  "skills.summary_state.unmounted": "Unmounted",
  "skills.summary_state.unconfigured": "Unconfigured",
  "skills.summary_reason.mounted_path": "Mounted from {{path}}",
  "skills.summary_reason.unconfigured": "No skill directory configured",
  "skills.summary_reason.unmounted_generic": "Not currently mounted",
  "skills.summary_reason.relation_stale": "Mount needs repair",
  "skills.summary_reason.relation_missing_source": "Mounted source is missing",
  "skills.summary_reason.relation_missing_target": "Mounted target is missing",
  "skills.summary_reason.relation_failed": "Mount failed",
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
  "skills.mount_state.unmounted": "Unmounted",
  "skills.mount_state.partially_mounted": "Partially mounted",
  "skills.mount_state.fully_mounted": "Fully mounted",
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

function renderPanel(sendCommand: ReturnType<typeof vi.fn>) {
  const store = createStore();
  store.set(wsClientAtom, { sendCommand } as never);

  return render(
    <Provider store={store}>
      <SkillsPanel workspaceId="ws-1" />
    </Provider>
  );
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
    const skillTitle = await screen.findByText("Code Review");
    const skillCard = skillTitle.closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    expect(skillTitle).toBeInTheDocument();
    expect(within(skillCard).queryByText(/code-review/)).toBeNull();
    expect(within(skillCard).queryByText(/v1\.2\.3/)).toBeNull();
    expect(screen.queryByText("Partially mounted")).not.toBeInTheDocument();
    expect(screen.getByText("Review code changes before merge")).toBeInTheDocument();
    expect(sendCommand).toHaveBeenCalledWith("skills.library.list", {}, undefined);
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

    const descriptionNode = await screen.findByText(description);
    expect(descriptionNode).toHaveClass("skills-panel__card-description");
    expect(descriptionNode).toHaveClass("skills-panel__card-description--truncated");

    fireEvent.mouseEnter(descriptionNode);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(description);
  });

  it("renders discover and installed sections", async () => {
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

    expect(await screen.findByRole("heading", { level: 2, name: "Discover" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Installed Skills" })).toBeInTheDocument();
  });

  it("hides local source labels in installed skill cards", async () => {
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

    const skillCard = (await screen.findByText("Code Review")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    expect(within(skillCard).queryByText(/code-review/)).toBeNull();
    expect(within(skillCard).queryByText("Local")).toBeNull();
  });

  it("shows built-in source labels for built-in skills", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") {
        return [
          {
            slug: "coder-studio-automation",
            displayName: "Coder Studio Automation",
            description: "Teach agents to discover Coder Studio automation",
            version: "1.0.0",
            source: "builtin",
            libraryPath: "/skills/builtin/coder-studio-automation",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            mountedProviderIds: ["codex"],
            mountStatus: "partially_mounted",
            errorCount: 0,
            builtin: { defaultEnabled: true, autoMount: true },
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

    expect(await screen.findByText("Coder Studio Automation")).toBeInTheDocument();
    expect(screen.getByText(/coder-studio-automation/)).toHaveTextContent("Built-in");
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

    await waitFor(() => {
      expect(screen.getByText("No skills in the library yet.")).toBeInTheDocument();
    });
  });

  it("renders the installed section before discover", async () => {
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
      "Discover",
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
            description: "Available result",
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
  });

  it("collapses and expands the installed and discover sections independently", async () => {
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

    expect(within(installedSection).getByRole("button", { name: "Refresh" })).toBeVisible();

    fireEvent.click(
      within(installedSection).getByRole("button", { name: "Collapse Installed Skills" })
    );

    expect(
      within(installedSection).getByRole("button", { name: "Expand Installed Skills" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(within(installedSection).queryByText("Code Review")).toBeNull();

    fireEvent.click(
      within(installedSection).getByRole("button", { name: "Expand Installed Skills" })
    );
    expect(await within(installedSection).findByText("Code Review")).toBeInTheDocument();

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

  it("renders installed skill targets as collapsed summary tokens by default", async () => {
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

    const skillCard = (await screen.findByText("Code Review")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    const expandButton = within(skillCard).getByRole("button", { name: "Expand Code Review" });
    expect(expandButton).toBeVisible();
    expect(expandButton.firstElementChild).toHaveClass("skills-panel__summary-toggle-icon");
    expect(expandButton.children[1]).toHaveClass("skills-panel__summary-tokens");
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
    expect(within(skillCard).queryByText("Codex CLI")).toBeNull();
    expect(within(skillCard).queryByRole("button", { name: "Mount" })).toBeNull();
    expect(within(skillCard).queryByRole("button", { name: "Configure Directory" })).toBeNull();
  });

  it("shows tooltip details for summary tokens and token clicks do not expand the skill card", async () => {
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
              lastHealthError: "Directory permissions blocked",
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
              status: "failed",
              lastError: "Broken symlink",
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

    const skillCard = (await screen.findByText("Code Review")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    const token = within(skillCard).getByText("CC");
    fireEvent.mouseEnter(token);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Claude Code");
    expect(tooltip).toHaveTextContent("Unmounted");
    expect(tooltip).toHaveTextContent("Directory permissions blocked");

    fireEvent.mouseDown(token);
    fireEvent.click(token);

    expect(within(skillCard).getByRole("button", { name: "Expand Code Review" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(within(skillCard).queryByText("Claude Code")).toBeNull();
  });

  it("reveals target details when expanded and unconfigured targets do not show directory configuration actions", async () => {
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
        ];
      }

      if (op === "skills.health.scan") {
        return {
          targets: [
            {
              providerId: "claude",
              displayName: "Claude Code",
              kind: "built_in",
              skillDir: undefined,
              mountPreference: "auto",
              lastHealthState: "unconfigured",
              lastHealthError: null,
              mountedSkillCount: 0,
            },
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
          mounts: [],
        };
      }

      if (op === "skills.targets.list") {
        return [
          {
            providerId: "claude",
            displayName: "Claude Code",
            kind: "built_in",
            skillDir: undefined,
            mountPreference: "auto",
            lastHealthState: "unconfigured",
            lastHealthError: null,
            mountedSkillCount: 0,
          },
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
        ];
      }

      return [];
    });

    renderPanel(sendCommand);

    const skillCard = (await screen.findByText("Code Review")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    fireEvent.click(within(skillCard).getByRole("button", { name: "Expand Code Review" }));

    expect(await within(skillCard).findByText("Claude Code")).toBeInTheDocument();
    expect(within(skillCard).getByRole("button", { name: "Mount" })).toBeVisible();
    expect(within(skillCard).queryByRole("button", { name: "Configure Directory" })).toBeNull();
  });

  it("keeps enabled stale mounts on the repair flow instead of falling back to mount", async () => {
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

    const skillCard = (await screen.findByText("Code Review")).closest("article");
    if (!skillCard) {
      throw new Error("Skill card not found");
    }

    fireEvent.click(within(skillCard).getByRole("button", { name: "Expand Code Review" }));

    expect(await within(skillCard).findByText("Claude Code")).toBeInTheDocument();
    expect(within(skillCard).getByRole("button", { name: "Unmount" })).toBeVisible();
    expect(within(skillCard).getByRole("button", { name: "Repair" })).toBeVisible();
    expect(within(skillCard).queryByRole("button", { name: "Mount" })).toBeNull();
  });
});
