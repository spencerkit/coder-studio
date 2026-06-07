// @vitest-environment jsdom

import type { Workspace } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { workspacesAtom } from "../../../../atoms/workspaces";
import { CommandResultError } from "../../../../ws/client";
import { openFilesAtomFamily } from "../../atoms";
import { AgentInstructionsSection } from "./agent-instructions-section";

const openLocationSpy = vi.fn();
const agentInstructionsPath = ".coder-studio/agent.md";

type TestStatus = {
  project?: { exists: boolean; stale: boolean; path: string; displayPath?: string };
  system?: TestSystemStatusEntry[];
  document: { exists: boolean; stale: boolean; path: string; displayPath?: string };
};

type TestSystemStatusEntry = {
  providerId: "codex" | "claude" | "gemini" | "opencode";
  displayName: string;
  path?: string;
  displayPath: string;
  exists: boolean;
  editable: boolean;
  status: "ready" | "missing" | "unsupported" | "error";
  reason?: string;
};

type TestProviderListItem = {
  id: string;
  displayName: string;
  badge: string;
  kind: "built_in" | "preset" | "custom";
  capability: "full" | "limited" | "unsupported";
  capabilities: [];
  requiredCommands: string[];
  supportsAgentInstructionsGeneration?: boolean;
};

type TestRuntimeProvider = {
  providerId: string;
  available: boolean;
  missingCommands: string[];
  missingPrerequisites: string[];
  autoInstallSupported: boolean;
  installReadiness: "ready" | "missing_prerequisite" | "unsupported_platform";
  manualGuideKeys: string[];
  docUrls: {
    provider: string;
    prerequisites: Record<string, string>;
  };
  supportsAgentInstructionsGeneration?: boolean;
};

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      "action.close": "Close",
      "action.cancel": "Cancel",
      "action.confirm": "Confirm",
      "label.file": "File",
      "workspace.agent_instructions.title": "agent.md",
      "workspace.agent_instructions.project_title": "Project Agent.md",
      "workspace.agent_instructions.system_title": "System Agent.md",
      "workspace.agent_instructions.system_status.ready": "Ready",
      "workspace.agent_instructions.system_status.missing": "Missing",
      "workspace.agent_instructions.system_status.unsupported": "Unsupported",
      "workspace.agent_instructions.system_status.error": "Error",
      "workspace.agent_instructions.system_unsupported": "Not editable",
      "workspace.agent_instructions.empty_title":
        "Add a project brief for AI agents so they can quickly understand your project, coding conventions, and workflow.",
      "workspace.agent_instructions.status.ready": "agent.md: Ready",
      "workspace.agent_instructions.status.regenerating": "agent.md: Regenerating",
      "workspace.agent_instructions.status.stale": "agent.md: Stale",
      "workspace.agent_instructions.status.missing": "agent.md: Missing",
      "workspace.agent_instructions.summary": "AI agents read this before they start working.",
      "workspace.agent_instructions.summary_help": "What is agent.md?",
      "workspace.agent_instructions.summary_tooltip":
        "agent.md is a project brief for AI agents. Use it for project context, coding conventions, and workflow notes. We automatically sync it to the files different agents actually read.",
      "workspace.agent_instructions.system_help": "What do system Agent.md files affect?",
      "workspace.agent_instructions.system_tooltip":
        "These files are each agent's global instruction defaults. Editing one affects every workspace that agent runs on this machine, but does not change this project's .coder-studio/agent.md.",
      "workspace.agent_instructions.generate": "Generate agent.md",
      "workspace.agent_instructions.generate_short": "Generate",
      "workspace.agent_instructions.generate_title": "Generate agent.md",
      "workspace.agent_instructions.generate_body":
        "Choose a generation agent and optional model before writing .coder-studio/agent.md.",
      "workspace.agent_instructions.view": "Open agent.md",
      "workspace.agent_instructions.view_short": "Open",
      "workspace.agent_instructions.edit": "Edit agent.md",
      "workspace.agent_instructions.edit_short": "Edit",
      "workspace.agent_instructions.regenerate": "Regenerate",
      "workspace.agent_instructions.regenerate_short": "Regenerate",
      "workspace.agent_instructions.regenerate_title": "Regenerate agent.md?",
      "workspace.agent_instructions.regenerate_body":
        "This will regenerate .coder-studio/agent.md from the current workspace and overwrite your manual edits. The updated file will then be synced to the agent read locations.",
      "workspace.agent_instructions.regenerate_dialog_title": "Regenerate agent.md",
      "workspace.agent_instructions.regenerate_dialog_body":
        "Choose a generation agent and optional model before overwriting .coder-studio/agent.md.",
      "workspace.agent_instructions.provider_label": "Agent",
      "workspace.agent_instructions.model_label": "Model (optional)",
      "workspace.agent_instructions.model_placeholder":
        "Leave blank to use the provider default model",
      "workspace.agent_instructions.model_helper": "Leave blank to use the provider default model.",
      "workspace.agent_instructions.providers_load_failed":
        "Failed to load available generation agents",
      "workspace.agent_instructions.no_generation_provider":
        "No installed provider can generate agent.md right now.",
      "workspace.agent_instructions.failed": "Agent instructions action failed",
      "workspace.agent_instructions.status_load_failed": "Failed to load agent instructions status",
      "workspace.agent_instructions.generate_failed": "Failed to generate agent.md",
      "workspace.agent_instructions.generate_timeout":
        "Timed out waiting for agent.md generation. The selected agent may be slow or waiting on authentication.",
      "workspace.agent_instructions.generate_no_output":
        "The selected agent finished without returning any generated agent.md content.",
      "workspace.agent_instructions.edit_failed": "Failed to open agent.md",
      "workspace.agent_instructions.system_edit_failed": "Failed to open system Agent.md",
      "workspace.agent_instructions.attach_failed":
        "Failed to attach agent.md to the current session",
      "workspace.agent_instructions.expand_failed":
        "Failed to update the Agent Instructions panel state",
      "workspace.agent_instructions.toggle_expand": "Toggle Project Agent.md",
      "workspace.agent_instructions.expand_label": "Expand Project Agent.md",
      "workspace.agent_instructions.collapse_label": "Collapse Project Agent.md",
      "workspace.agent_instructions.system_expand_label": "Expand System Agent.md",
      "workspace.agent_instructions.system_collapse_label": "Collapse System Agent.md",
      "workspace.agent_instructions.token_trend.title": "Token Trend",
      "common.loading": "Loading...",
    };

    if (key === "workspace.agent_instructions.section_count") {
      return `${params?.title ?? "Agent Instructions"} (${params?.count ?? 0})`;
    }
    if (key === "workspace.agent_instructions.system_edit") {
      return `Edit ${params?.name ?? "agent"} system Agent.md`;
    }

    return translations[key] ?? key;
  },
}));

vi.mock("../../../code-editor/actions/use-open-location", () => ({
  useOpenLocation: () => ({
    openLocation: openLocationSpy,
    clearPendingNavigation: vi.fn(),
  }),
}));

function createProvider(
  overrides: Partial<TestProviderListItem> & Pick<TestProviderListItem, "id">
): TestProviderListItem {
  return {
    id: overrides.id,
    displayName: overrides.displayName ?? overrides.id,
    badge: overrides.badge ?? overrides.displayName ?? overrides.id,
    kind: overrides.kind ?? "built_in",
    capability: overrides.capability ?? "full",
    capabilities: overrides.capabilities ?? [],
    requiredCommands: overrides.requiredCommands ?? [],
    supportsAgentInstructionsGeneration: overrides.supportsAgentInstructionsGeneration ?? true,
  };
}

function createRuntimeProvider(
  overrides: Partial<TestRuntimeProvider> & Pick<TestRuntimeProvider, "providerId">
): TestRuntimeProvider {
  return {
    providerId: overrides.providerId,
    available: overrides.available ?? true,
    missingCommands: overrides.missingCommands ?? [],
    missingPrerequisites: overrides.missingPrerequisites ?? [],
    autoInstallSupported: overrides.autoInstallSupported ?? false,
    installReadiness: overrides.installReadiness ?? "ready",
    manualGuideKeys: overrides.manualGuideKeys ?? [],
    docUrls: overrides.docUrls ?? { provider: "", prerequisites: {} },
    supportsAgentInstructionsGeneration: overrides.supportsAgentInstructionsGeneration ?? true,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

function createWorkspaceStore(uiState?: Record<string, unknown>) {
  const store = createStore();
  store.set(workspacesAtom, {
    "ws-1": {
      id: "ws-1",
      path: "/workspace",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
        ...uiState,
      },
    },
  } as never);

  return store;
}

function installDispatchIntoStore(
  store: ReturnType<typeof createStore>,
  dispatchImpl: ReturnType<typeof vi.fn>
) {
  const dispatchCommand = dispatchImpl as unknown as (
    op: string,
    args: unknown,
    options?: { timeoutMs?: number }
  ) => Promise<{
    ok: boolean;
    data?: unknown;
    error?: { message?: string };
  }>;

  store.set(wsClientAtom, {
    sendCommand: vi
      .fn()
      .mockImplementation(async (op: string, args: unknown, options?: { timeoutMs?: number }) => {
        const result = await dispatchCommand(op, args, options);
        if (!result.ok) {
          throw new CommandResultError({
            code: result.error?.code ?? "command_failed",
            message: result.error?.message || "command failed",
          });
        }
        return result.data;
      }),
    subscribe: vi.fn(() => () => {}),
  } as never);
}

function expectGenerateTimeoutCall(dispatch: ReturnType<typeof vi.fn>, expectedTimeoutMs: number) {
  expect(dispatch).toHaveBeenCalledWith(
    "agentInstructions.generateAndWriteByAgent",
    expect.any(Object),
    expect.objectContaining({ timeoutMs: expectedTimeoutMs })
  );
}

function createDefaultSystemStatus(): TestSystemStatusEntry[] {
  return [
    {
      providerId: "codex",
      displayName: "Codex",
      path: ".codex/AGENTS.md",
      displayPath: "~/.codex/AGENTS.md",
      exists: true,
      editable: true,
      status: "ready",
    },
    {
      providerId: "claude",
      displayName: "Claude Code",
      path: ".claude/CLAUDE.md",
      displayPath: "~/.claude/CLAUDE.md",
      exists: false,
      editable: true,
      status: "missing",
    },
    {
      providerId: "gemini",
      displayName: "Gemini CLI",
      path: ".gemini/GEMINI.md",
      displayPath: "~/.gemini/GEMINI.md",
      exists: false,
      editable: true,
      status: "missing",
    },
    {
      providerId: "opencode",
      displayName: "OpenCode",
      path: ".config/opencode/AGENTS.md",
      displayPath: "~/.config/opencode/AGENTS.md",
      exists: false,
      editable: true,
      status: "missing",
    },
  ];
}

function renderWithStore(store: ReturnType<typeof createStore>) {
  render(
    <Provider store={store}>
      <AgentInstructionsSection workspaceId="ws-1" />
    </Provider>
  );
}

function renderSection({
  status,
  uiState,
  dispatchImpl,
  providerList,
  runtimeProviders,
}: {
  status?: TestStatus;
  uiState?: Record<string, unknown>;
  dispatchImpl?: ReturnType<typeof vi.fn>;
  providerList?: TestProviderListItem[];
  runtimeProviders?: Record<string, TestRuntimeProvider>;
}) {
  const store = createWorkspaceStore(uiState);
  const dispatch =
    dispatchImpl ??
    vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "agentInstructions.status") {
        return {
          ok: true,
          data: status ?? {
            project: {
              exists: false,
              stale: false,
              path: agentInstructionsPath,
              displayPath: "Project Agent.md",
            },
            system: createDefaultSystemStatus(),
            document: {
              exists: false,
              stale: false,
              path: agentInstructionsPath,
              displayPath: "Project Agent.md",
            },
          },
        };
      }

      if (op === "workspace.uiState.set") {
        const payload = args as { workspaceId: string; uiState: Record<string, unknown> };
        const currentWorkspaces = store.get(workspacesAtom);
        const current = currentWorkspaces[payload.workspaceId];
        if (!current) {
          throw new Error(`Missing workspace in test store: ${payload.workspaceId}`);
        }

        const next: Workspace = {
          ...current,
          uiState: {
            ...current.uiState,
            ...payload.uiState,
          },
        };
        store.set(workspacesAtom, {
          ...currentWorkspaces,
          [payload.workspaceId]: next,
        } as typeof currentWorkspaces);
        return { ok: true, data: next };
      }

      if (op === "provider.list") {
        return {
          ok: true,
          data: providerList ?? [
            createProvider({ id: "codex", displayName: "Codex", badge: "Codex" }),
          ],
        };
      }

      if (op === "provider.runtimeStatus") {
        return {
          ok: true,
          data: {
            providers: runtimeProviders ?? {
              codex: createRuntimeProvider({ providerId: "codex" }),
            },
          },
        };
      }

      if (op === "agentInstructions.write") {
        return {
          ok: true,
          data: {
            path: agentInstructionsPath,
            exists: true,
            content: "# Agent Instructions\n",
            baseHash: "hash-custom",
          },
        };
      }

      if (op === "agentInstructions.system.write") {
        const payload = args as { providerId?: string; content?: string };
        return {
          ok: true,
          data: {
            providerId: payload.providerId ?? "codex",
            path: ".codex/AGENTS.md",
            displayPath: "~/.codex/AGENTS.md",
            exists: true,
            content: payload.content ?? "# Agent Instructions\n",
            baseHash: "hash-system",
          },
        };
      }

      if (op === "agentInstructions.generateAndWriteByAgent") {
        return {
          ok: true,
          data: {
            document: {
              path: agentInstructionsPath,
              exists: true,
              content: "# Agent Instructions\n",
              baseHash: "hash-custom",
            },
            meta: {
              providerId: "codex",
              model: "o3",
            },
          },
        };
      }

      if (op === "agentInstructions.attachToSession") {
        return {
          ok: true,
          data: {
            injected: true,
            sessionId: "sess-1",
            effectiveHash: "hash-effective",
            mode: "manual",
          },
        };
      }

      return { ok: true, data: undefined };
    });

  installDispatchIntoStore(store, dispatch);
  renderWithStore(store);

  return { dispatch, store };
}

describe("AgentInstructionsSection", () => {
  beforeEach(() => {
    openLocationSpy.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the empty state and starts expanded by default", async () => {
    renderSection({});

    await screen.findByRole("heading", { level: 2, name: "Project Agent.md" });
    expect(screen.getByText("agent.md: Missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate agent.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit agent.md" })).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Toggle Project Agent.md" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("does not render the token trend inside the AGENT.MD section", async () => {
    renderSection({});

    await screen.findByRole("heading", { level: 2, name: "Project Agent.md" });

    expect(
      screen.queryByRole("heading", { level: 3, name: "Token Trend" })
    ).not.toBeInTheDocument();
  });

  it("renders project and system agent instruction groups", async () => {
    renderSection({});

    expect(
      await screen.findByRole("heading", { level: 2, name: "Project Agent.md" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Project Agent.md" })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "System Agent.md" })).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("~/.codex/AGENTS.md")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("~/.claude/CLAUDE.md")).toBeInTheDocument();
    expect(screen.queryByText("Cursor Agent")).toBeNull();
    expect(screen.queryByText("Cursor Settings > Rules")).toBeNull();
  });

  it("renders the system group with shared section chrome and supports collapsing it", async () => {
    renderSection({});

    const systemToggle = await screen.findByRole("button", {
      name: "Collapse System Agent.md",
    });
    const systemHeading = screen.getByRole("heading", { level: 3, name: "System Agent.md" });

    expect(systemToggle).toHaveClass("workspace-sidebar-section__chevron");
    expect(systemToggle).toHaveAttribute("aria-expanded", "true");
    expect(systemHeading).toHaveClass("workspace-sidebar-section__title");

    fireEvent.click(systemToggle);

    await waitFor(() => {
      expect(screen.queryByText("Codex")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Expand System Agent.md" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("renders a system agent explanation as a title info icon", async () => {
    renderSection({});

    const infoButton = await screen.findByRole("button", {
      name: "What do system Agent.md files affect?",
    });
    expect(infoButton).toHaveClass("workspace-agent-instructions__title-help");

    fireEvent.mouseEnter(infoButton);

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "These files are each agent's global instruction defaults. Editing one affects every workspace that agent runs on this machine, but does not change this project's .coder-studio/agent.md."
    );
  });

  it("opens an existing system agent file by virtual editor path", async () => {
    renderSection({});

    fireEvent.click(await screen.findByRole("button", { name: "Edit Codex system Agent.md" }));

    await waitFor(() => {
      expect(openLocationSpy).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        path: "agent-system:codex",
        source: "manual",
      });
    });
  });

  it("opens a missing system agent file without creating it until save", async () => {
    const { dispatch, store } = renderSection({});

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Claude Code system Agent.md" })
    );

    await waitFor(() => {
      expect(openLocationSpy).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        path: "agent-system:claude",
        source: "manual",
      });
    });

    expect(dispatch.mock.calls.some(([op]) => op === "agentInstructions.system.write")).toBe(false);
    expect(store.get(openFilesAtomFamily("ws-1"))["agent-system:claude"]).toMatchObject({
      kind: "text",
      path: "agent-system:claude",
      displayPath: "~/.claude/CLAUDE.md",
      content: expect.stringContaining("# Agent Instructions"),
      savedContent: "",
      baseHash: "",
      isDirty: true,
    });
  });

  it("renders the agent-read explanation as a title info icon instead of inline copy", async () => {
    renderSection({});

    const heading = await screen.findByRole("heading", { level: 2, name: "Project Agent.md" });
    expect(
      screen.queryByText("AI agents read this before they start working.")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Add a project brief for AI agents so they can quickly understand your project, coding conventions, and workflow."
      )
    ).not.toBeInTheDocument();

    const infoButton = screen.getByRole("button", { name: "What is agent.md?" });
    expect(infoButton).toHaveClass("workspace-agent-instructions__title-help");
    expect(heading.parentElement).toContainElement(infoButton);
    fireEvent.mouseEnter(infoButton);

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "agent.md is a project brief for AI agents. Use it for project context, coding conventions, and workflow notes. We automatically sync it to the files different agents actually read."
    );
  });

  it("reuses the shared file-panel header chrome instead of a custom title row", async () => {
    renderSection({});

    const heading = await screen.findByRole("heading", { level: 2, name: "Project Agent.md" });
    const toggle = screen.getByRole("button", { name: "Toggle Project Agent.md" });

    expect(heading).toHaveClass("workspace-sidebar-section__title");
    expect(toggle).toHaveClass("workspace-sidebar-section__chevron");
    expect(screen.queryByText("File")).not.toBeInTheDocument();
  });

  it("keeps missing-state actions inline with the status row instead of stretching a full-width footer", async () => {
    renderSection({});

    const statusRow = await screen.findByLabelText("Project Agent.md");
    const statusMain = statusRow.querySelector(".workspace-agent-instructions__status-main");

    expect(statusMain).not.toBeNull();
    expect(
      within(statusMain as HTMLElement).getByRole("button", { name: "Generate agent.md" })
    ).toBeInTheDocument();
    expect(
      within(statusMain as HTMLElement).getByRole("button", { name: "Edit agent.md" })
    ).toBeInTheDocument();
  });

  it("keeps existing-state actions inline with the status row instead of rendering a second action row", async () => {
    renderSection({
      status: {
        document: { exists: true, stale: false, path: agentInstructionsPath },
      },
    });

    const statusRow = await screen.findByLabelText("Project Agent.md");
    const statusMain = statusRow.querySelector(".workspace-agent-instructions__status-main");

    expect(statusMain).not.toBeNull();
    expect(
      within(statusMain as HTMLElement).getByRole("button", { name: "Regenerate" })
    ).toBeInTheDocument();
    expect(
      within(statusMain as HTMLElement).getByRole("button", { name: "Edit agent.md" })
    ).toBeInTheDocument();
    expect(document.querySelector(".workspace-agent-instructions__actions")).toBeNull();
  });

  it("does not render a separate open action once agent.md exists", async () => {
    const { dispatch } = renderSection({
      status: {
        document: { exists: true, stale: false, path: agentInstructionsPath },
      },
    });

    await screen.findByText("agent.md: Ready");

    expect(screen.queryByRole("button", { name: "Open agent.md" })).toBeNull();
    expect(dispatch.mock.calls.some(([op]) => op === "agentInstructions.effective.refresh")).toBe(
      false
    );
    expect(openLocationSpy).not.toHaveBeenCalled();
  });

  it("does not render attach actions in the panel", async () => {
    renderSection({
      status: {
        document: { exists: true, stale: false, path: agentInstructionsPath },
      },
    });

    await screen.findByText("agent.md: Ready");
    expect(screen.queryByRole("button", { name: /attach/i })).not.toBeInTheDocument();
  });

  it("opens a missing agent.md without creating it until save", async () => {
    const { dispatch, store } = renderSection({});

    fireEvent.click(await screen.findByRole("button", { name: "Edit agent.md" }));

    await waitFor(() => {
      expect(openLocationSpy).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        path: agentInstructionsPath,
        source: "manual",
      });
    });

    expect(dispatch.mock.calls.some(([op]) => op === "agentInstructions.write")).toBe(false);
    expect(store.get(openFilesAtomFamily("ws-1"))[agentInstructionsPath]).toMatchObject({
      kind: "text",
      path: agentInstructionsPath,
      content: expect.stringContaining("# Agent Instructions"),
      savedContent: "",
      baseHash: "",
      isDirty: true,
    });
  });

  it("opens a generation dialog instead of dispatching generation immediately", async () => {
    const { dispatch } = renderSection({
      providerList: [createProvider({ id: "claude", displayName: "Claude", badge: "Claude" })],
      runtimeProviders: {
        claude: createRuntimeProvider({ providerId: "claude" }),
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Generate agent.md" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Generate agent.md")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Choose a generation agent and optional model before writing .coder-studio/agent.md."
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Agent" })).toHaveValue("claude");
    expect(dispatch.mock.calls.some(([op]) => op === "provider.list")).toBe(true);
    expect(dispatch.mock.calls.some(([op]) => op === "provider.runtimeStatus")).toBe(true);
    expect(
      dispatch.mock.calls.some(([op]) => op === "agentInstructions.generateAndWriteByAgent")
    ).toBe(false);
  });

  it("filters generation agents to runtime-available providers that support generation", async () => {
    renderSection({
      providerList: [
        createProvider({
          id: "claude",
          displayName: "Claude",
          badge: "Claude",
          supportsAgentInstructionsGeneration: true,
        }),
        createProvider({
          id: "gemini",
          displayName: "Gemini",
          badge: "Gemini",
          supportsAgentInstructionsGeneration: true,
        }),
        createProvider({
          id: "cursor",
          displayName: "Cursor",
          badge: "Cursor",
          supportsAgentInstructionsGeneration: true,
        }),
        createProvider({
          id: "unsupported",
          displayName: "Unsupported",
          badge: "Unsupported",
          supportsAgentInstructionsGeneration: false,
        }),
        createProvider({
          id: "offline",
          displayName: "Offline",
          badge: "Offline",
          supportsAgentInstructionsGeneration: true,
        }),
        createProvider({
          id: "codex",
          displayName: "Codex",
          badge: "Codex",
          supportsAgentInstructionsGeneration: true,
        }),
      ],
      runtimeProviders: {
        claude: createRuntimeProvider({
          providerId: "claude",
          available: true,
          supportsAgentInstructionsGeneration: true,
        }),
        gemini: createRuntimeProvider({
          providerId: "gemini",
          available: true,
          supportsAgentInstructionsGeneration: true,
        }),
        cursor: createRuntimeProvider({
          providerId: "cursor",
          available: true,
          supportsAgentInstructionsGeneration: true,
        }),
        unsupported: createRuntimeProvider({
          providerId: "unsupported",
          available: true,
          supportsAgentInstructionsGeneration: false,
        }),
        offline: createRuntimeProvider({
          providerId: "offline",
          available: false,
          supportsAgentInstructionsGeneration: true,
        }),
        codex: createRuntimeProvider({
          providerId: "codex",
          available: true,
          supportsAgentInstructionsGeneration: true,
        }),
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Generate agent.md" }));

    const providerSelect = await screen.findByRole("combobox", { name: "Agent" });
    expect(providerSelect).toHaveValue("claude");
    expect(within(providerSelect).getByRole("option", { name: "Claude" })).toBeInTheDocument();
    expect(within(providerSelect).getByRole("option", { name: "Gemini" })).toBeInTheDocument();
    expect(within(providerSelect).getByRole("option", { name: "Cursor" })).toBeInTheDocument();
    expect(within(providerSelect).queryByRole("option", { name: "Unsupported" })).toBeNull();
    expect(within(providerSelect).queryByRole("option", { name: "Offline" })).toBeNull();
    expect(within(providerSelect).getByRole("option", { name: "Codex" })).toBeInTheDocument();
  });

  it("shows a panel-level error and does not open the dialog when no provider matches", async () => {
    renderSection({
      providerList: [
        createProvider({
          id: "claude",
          displayName: "Claude",
          badge: "Claude",
          supportsAgentInstructionsGeneration: false,
        }),
      ],
      runtimeProviders: {
        claude: createRuntimeProvider({
          providerId: "claude",
          available: true,
          supportsAgentInstructionsGeneration: false,
        }),
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Generate agent.md" }));

    expect(
      await screen.findByText("No installed provider can generate agent.md right now.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("submits the selected provider and trims the optional model before generation", async () => {
    const { dispatch } = renderSection({
      providerList: [
        createProvider({ id: "codex", displayName: "Codex", badge: "Codex" }),
        createProvider({ id: "test-gen", displayName: "Test Gen", badge: "Test Gen" }),
      ],
      runtimeProviders: {
        codex: createRuntimeProvider({ providerId: "codex" }),
        "test-gen": createRuntimeProvider({ providerId: "test-gen" }),
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Generate agent.md" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Agent" }), {
      target: { value: "test-gen" },
    });
    fireEvent.change(screen.getByLabelText("Model (optional)"), {
      target: { value: "  o3-mini  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(
        dispatch.mock.calls.some(
          ([op, args]) =>
            op === "agentInstructions.generateAndWriteByAgent" &&
            JSON.stringify(args) ===
              JSON.stringify({
                workspaceId: "ws-1",
                providerId: "test-gen",
                model: "o3-mini",
              })
        )
      ).toBe(true);
    });
  });

  it("omits model from the payload when the optional field is left blank", async () => {
    const { dispatch } = renderSection({
      providerList: [createProvider({ id: "codex", displayName: "Codex", badge: "Codex" })],
      runtimeProviders: {
        codex: createRuntimeProvider({ providerId: "codex" }),
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Generate agent.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(
        dispatch.mock.calls.some(
          ([op, args]) =>
            op === "agentInstructions.generateAndWriteByAgent" &&
            JSON.stringify(args) ===
              JSON.stringify({
                workspaceId: "ws-1",
                providerId: "codex",
              })
        )
      ).toBe(true);
    });
  });

  it("reuses the generation dialog for regenerate with overwrite-oriented copy", async () => {
    const { dispatch } = renderSection({
      status: {
        document: { exists: true, stale: true, path: agentInstructionsPath },
      },
      providerList: [createProvider({ id: "codex", displayName: "Codex", badge: "Codex" })],
      runtimeProviders: {
        codex: createRuntimeProvider({ providerId: "codex" }),
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Regenerate agent.md")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Choose a generation agent and optional model before overwriting .coder-studio/agent.md."
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Agent" })).toHaveValue("codex");
    expect(within(dialog).queryByRole("button", { name: "Confirm" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Regenerate" }));

    await waitFor(() => {
      expect(
        dispatch.mock.calls.some(
          ([op, args]) =>
            op === "agentInstructions.generateAndWriteByAgent" &&
            JSON.stringify(args) ===
              JSON.stringify({
                workspaceId: "ws-1",
                providerId: "codex",
              })
        )
      ).toBe(true);
    });
  });

  it("closes the dialog immediately, shows panel loading, and refreshes status after a successful submission", async () => {
    const generation = createDeferred<{
      ok: boolean;
      data: {
        document: {
          path: string;
          exists: boolean;
          content: string;
          baseHash: string;
        };
        meta: {
          providerId: string;
        };
      };
    }>();
    let documentExists = false;
    const store = createWorkspaceStore();
    const dispatch = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "agentInstructions.status") {
        return {
          ok: true,
          data: {
            document: {
              exists: documentExists,
              stale: false,
              path: agentInstructionsPath,
            },
          },
        };
      }

      if (op === "workspace.uiState.set") {
        const payload = args as { workspaceId: string; uiState: Record<string, unknown> };
        const currentWorkspaces = store.get(workspacesAtom);
        const current = currentWorkspaces[payload.workspaceId];
        if (!current) {
          throw new Error(`Missing workspace in test store: ${payload.workspaceId}`);
        }

        const next: Workspace = {
          ...current,
          uiState: {
            ...current.uiState,
            ...payload.uiState,
          },
        };
        store.set(workspacesAtom, {
          ...currentWorkspaces,
          [payload.workspaceId]: next,
        } as typeof currentWorkspaces);
        return { ok: true, data: next };
      }

      if (op === "provider.list") {
        return {
          ok: true,
          data: [createProvider({ id: "codex", displayName: "Codex", badge: "Codex" })],
        };
      }

      if (op === "provider.runtimeStatus") {
        return {
          ok: true,
          data: {
            providers: {
              codex: createRuntimeProvider({ providerId: "codex" }),
            },
          },
        };
      }

      if (op === "agentInstructions.generateAndWriteByAgent") {
        const result = await generation.promise;
        documentExists = true;
        return result;
      }

      return { ok: true, data: undefined };
    });

    installDispatchIntoStore(store, dispatch);
    renderWithStore(store);

    fireEvent.click(await screen.findByRole("button", { name: "Generate agent.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const generateButton = screen.getByRole("button", { name: "Generate agent.md" });
    expect(generateButton).toHaveAttribute("aria-busy", "true");
    expect(generateButton).toHaveTextContent("Generate");
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();

    generation.resolve({
      ok: true,
      data: {
        document: {
          path: agentInstructionsPath,
          exists: true,
          content: "# Agent Instructions\n",
          baseHash: "hash-custom",
        },
        meta: {
          providerId: "codex",
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Regenerate" })).not.toHaveAttribute(
        "aria-busy",
        "true"
      );
    });
    expect(await screen.findByText("agent.md: Ready")).toBeInTheDocument();
    expect(
      dispatch.mock.calls.filter(([op]) => op === "agentInstructions.status").length
    ).toBeGreaterThanOrEqual(2);
  });

  it("switches the ready status to regenerating while a rebuild is in flight", async () => {
    const generation = createDeferred<{
      ok: boolean;
      data: {
        document: {
          path: string;
          exists: boolean;
          content: string;
          baseHash: string;
        };
        meta: {
          providerId: string;
        };
      };
    }>();
    const store = createWorkspaceStore();
    const dispatch = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "agentInstructions.status") {
        return {
          ok: true,
          data: {
            document: {
              exists: true,
              stale: false,
              path: agentInstructionsPath,
            },
          },
        };
      }

      if (op === "workspace.uiState.set") {
        const payload = args as { workspaceId: string; uiState: Record<string, unknown> };
        const currentWorkspaces = store.get(workspacesAtom);
        const current = currentWorkspaces[payload.workspaceId];
        if (!current) {
          throw new Error(`Missing workspace in test store: ${payload.workspaceId}`);
        }

        const next: Workspace = {
          ...current,
          uiState: {
            ...current.uiState,
            ...payload.uiState,
          },
        };
        store.set(workspacesAtom, {
          ...currentWorkspaces,
          [payload.workspaceId]: next,
        } as typeof currentWorkspaces);
        return { ok: true, data: next };
      }

      if (op === "provider.list") {
        return {
          ok: true,
          data: [createProvider({ id: "codex", displayName: "Codex", badge: "Codex" })],
        };
      }

      if (op === "provider.runtimeStatus") {
        return {
          ok: true,
          data: {
            providers: {
              codex: createRuntimeProvider({ providerId: "codex" }),
            },
          },
        };
      }

      if (op === "agentInstructions.generateAndWriteByAgent") {
        return generation.promise;
      }

      return { ok: true, data: undefined };
    });

    installDispatchIntoStore(store, dispatch);
    renderWithStore(store);

    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Regenerate" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    expect(screen.queryByRole("button", { name: "agent.md: Regenerating" })).toBeNull();
    const regeneratingStatus = screen.getByText("agent.md: Regenerating");
    expect(regeneratingStatus).toBeInTheDocument();
    expect(regeneratingStatus).toHaveClass("workspace-agent-instructions__status-pill");
    expect(screen.getByRole("button", { name: "Regenerate" })).toHaveAttribute("aria-busy", "true");

    generation.resolve({
      ok: true,
      data: {
        document: {
          path: agentInstructionsPath,
          exists: true,
          content: "# Agent Instructions\n",
          baseHash: "hash-custom",
        },
        meta: {
          providerId: "codex",
        },
      },
    });

    expect(await screen.findByText("agent.md: Ready")).toBeInTheDocument();
  });

  it("closes the dialog immediately and shows the backend failure reason at panel level after a failed submission", async () => {
    const { dispatch } = renderSection({
      dispatchImpl: vi.fn().mockImplementation(async (op: string) => {
        if (op === "agentInstructions.status") {
          return {
            ok: true,
            data: {
              document: {
                exists: false,
                stale: false,
                path: agentInstructionsPath,
              },
            },
          };
        }

        if (op === "provider.list") {
          return {
            ok: true,
            data: [createProvider({ id: "codex", displayName: "Codex", badge: "Codex" })],
          };
        }

        if (op === "provider.runtimeStatus") {
          return {
            ok: true,
            data: {
              providers: {
                codex: createRuntimeProvider({ providerId: "codex" }),
              },
            },
          };
        }

        if (op === "agentInstructions.generateAndWriteByAgent") {
          return {
            ok: false,
            error: {
              message: "Provider does not support agent-instructions generation: claude",
            },
          };
        }

        return { ok: true, data: undefined };
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Generate agent.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      await screen.findByText("Provider does not support agent-instructions generation: claude")
    ).toBeInTheDocument();
    expect(dispatch.mock.calls.filter(([op]) => op === "agentInstructions.status").length).toBe(1);
  });

  it("uses an extended timeout for agent-backed generation submissions", async () => {
    const { dispatch } = renderSection({
      dispatchImpl: vi.fn().mockImplementation(async (op: string) => {
        if (op === "agentInstructions.status") {
          return {
            ok: true,
            data: {
              document: {
                exists: false,
                stale: false,
                path: agentInstructionsPath,
              },
            },
          };
        }

        if (op === "provider.list") {
          return {
            ok: true,
            data: [createProvider({ id: "codex", displayName: "Codex", badge: "Codex" })],
          };
        }

        if (op === "provider.runtimeStatus") {
          return {
            ok: true,
            data: {
              providers: {
                codex: createRuntimeProvider({ providerId: "codex" }),
              },
            },
          };
        }

        if (op === "agentInstructions.generateAndWriteByAgent") {
          return {
            ok: true,
            data: {
              document: {
                path: agentInstructionsPath,
                exists: true,
                content: "# Agent Instructions\n",
                baseHash: "hash-custom",
              },
              meta: {
                providerId: "codex",
              },
            },
          };
        }

        return { ok: true, data: undefined };
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Generate agent.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expectGenerateTimeoutCall(dispatch, 120000);
    });
  });

  it("shows a clearer timeout message at panel level when generation exceeds the command timeout", async () => {
    const { dispatch } = renderSection({
      dispatchImpl: vi.fn().mockImplementation(async (op: string) => {
        if (op === "agentInstructions.status") {
          return {
            ok: true,
            data: {
              document: {
                exists: false,
                stale: false,
                path: agentInstructionsPath,
              },
            },
          };
        }

        if (op === "provider.list") {
          return {
            ok: true,
            data: [createProvider({ id: "codex", displayName: "Codex", badge: "Codex" })],
          };
        }

        if (op === "provider.runtimeStatus") {
          return {
            ok: true,
            data: {
              providers: {
                codex: createRuntimeProvider({ providerId: "codex" }),
              },
            },
          };
        }

        if (op === "agentInstructions.generateAndWriteByAgent") {
          return {
            ok: false,
            error: {
              code: "agent_instructions_generation_timeout",
              message: "Timed out waiting for codex to generate agent instructions",
            },
          };
        }

        return { ok: true, data: undefined };
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Generate agent.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      await screen.findByText(
        "Timed out waiting for agent.md generation. The selected agent may be slow or waiting on authentication."
      )
    ).toBeInTheDocument();
    expectGenerateTimeoutCall(dispatch, 120000);
  });
});
