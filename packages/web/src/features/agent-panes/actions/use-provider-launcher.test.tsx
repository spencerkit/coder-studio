import type { ProviderListItem } from "@coder-studio/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DispatchCommand } from "../../../atoms/connection";
import { providerListAtom, providerRuntimeStatusAtom } from "../../../atoms/providers";
import { useProviderLauncher } from "./use-provider-launcher";

function createProviderList(): ProviderListItem[] {
  return [
    {
      id: "claude",
      displayName: "Claude Code",
      badge: "Claude",
      kind: "built_in",
      stability: "stable",
      capability: "full",
      capabilities: [
        { key: "interactive_session", supported: true, label: "Interactive session" },
        { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
      ],
      requiredCommands: ["claude"],
    },
    {
      id: "codex",
      displayName: "Codex",
      badge: "Codex",
      kind: "built_in",
      stability: "stable",
      capability: "full",
      capabilities: [
        { key: "interactive_session", supported: true, label: "Interactive session" },
        { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
      ],
      requiredCommands: ["codex"],
    },
    {
      id: "gemini",
      displayName: "Gemini CLI",
      badge: "Gemini",
      kind: "built_in",
      stability: "stable",
      capability: "full",
      capabilities: [
        { key: "interactive_session", supported: true, label: "Interactive session" },
        { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
      ],
      requiredCommands: ["gemini"],
    },
    {
      id: "cursor",
      displayName: "Cursor Agent",
      badge: "Cursor",
      kind: "built_in",
      stability: "stable",
      capability: "full",
      capabilities: [
        { key: "interactive_session", supported: true, label: "Interactive session" },
        { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
      ],
      requiredCommands: ["agent"],
    },
    {
      id: "opencode",
      displayName: "OpenCode",
      badge: "OpenCode",
      kind: "built_in",
      stability: "experimental",
      capability: "limited",
      capabilities: [
        { key: "interactive_session", supported: true, label: "Interactive session" },
        { key: "supervisor_eval", supported: false, label: "Supervisor evaluation" },
      ],
      requiredCommands: ["opencode"],
    },
  ];
}

function createWrapper(store: ReturnType<typeof createStore>) {
  return ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
}

describe("useProviderLauncher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds fallback runtime entries from provider metadata when runtime status is missing", async () => {
    const store = createStore();
    store.set(providerListAtom, createProviderList());
    const wrapper = createWrapper(store);
    const dispatch = vi.fn().mockResolvedValueOnce({
      ok: true,
      data: {
        providers: {},
      },
    }) as DispatchCommand;

    const onSessionCreated = vi.fn();

    const { result } = renderHook(
      () =>
        useProviderLauncher(dispatch, "ws-1", onSessionCreated, {
          launchMode: "replace",
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.states.codex?.runtime).toMatchObject({
        providerId: "codex",
        displayName: "Codex",
        badge: "Codex",
        kind: "built_in",
        capability: "full",
        requiredCommands: ["codex"],
        available: true,
        missingCommands: [],
      });
    });
  });

  it("hydrates provider cards from cached provider metadata before provider.list resolves", async () => {
    const dispatch = vi.fn().mockResolvedValueOnce({
      ok: true,
      data: {
        providers: {},
      },
    }) as DispatchCommand;

    const store = createStore();
    store.set(providerListAtom, createProviderList());
    const wrapper = createWrapper(store);
    const onSessionCreated = vi.fn();

    const { result } = renderHook(
      () =>
        useProviderLauncher(dispatch, "ws-1", onSessionCreated, {
          launchMode: "replace",
        }),
      { wrapper }
    );

    expect(result.current.providers.map((provider) => provider.id)).toEqual([
      "claude",
      "codex",
      "gemini",
      "cursor",
      "opencode",
    ]);
    expect(result.current.states.cursor?.runtime).toMatchObject({
      providerId: "cursor",
      available: true,
      missingCommands: [],
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith("provider.runtimeStatus", {});
    });

    expect(dispatch).not.toHaveBeenCalledWith("provider.list", {});
    expect(store.get(providerRuntimeStatusAtom)).toEqual({});
  });

  it("tracks provider ids directly from the shared provider atom after mount", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        providers: {},
      },
    }) as DispatchCommand;

    const store = createStore();
    store.set(providerListAtom, createProviderList().slice(0, 2));
    const wrapper = createWrapper(store);

    const { result } = renderHook(
      () =>
        useProviderLauncher(dispatch, "ws-1", vi.fn(), {
          launchMode: "replace",
        }),
      { wrapper }
    );

    expect(result.current.providers.map((provider) => provider.id)).toEqual(["claude", "codex"]);

    act(() => {
      store.set(providerListAtom, createProviderList());
    });

    expect(result.current.providers.map((provider) => provider.id)).toEqual([
      "claude",
      "codex",
      "gemini",
      "cursor",
      "opencode",
    ]);
  });

  it("loads providers dynamically, auto-installs a missing CLI, refreshes status, and creates the session", async () => {
    const store = createStore();
    store.set(providerListAtom, createProviderList());
    const wrapper = createWrapper(store);
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          providers: {
            claude: {
              providerId: "claude",
              available: false,
              missingCommands: ["claude"],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: ["provider.install.claude.manual"],
              docUrls: {
                provider: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
                prerequisites: {},
              },
            },
            codex: {
              providerId: "codex",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: [],
              docUrls: {
                provider:
                  "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
                prerequisites: {},
              },
            },
            gemini: {
              providerId: "gemini",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: false,
              installReadiness: "ready",
              manualGuideKeys: [],
              docUrls: {
                provider: "",
                prerequisites: {},
              },
            },
            cursor: {
              providerId: "cursor",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: false,
              installReadiness: "ready",
              manualGuideKeys: [],
              docUrls: {
                provider: "",
                prerequisites: {},
              },
            },
            opencode: {
              providerId: "opencode",
              available: false,
              missingCommands: ["opencode"],
              missingPrerequisites: [],
              autoInstallSupported: false,
              installReadiness: "unsupported_platform",
              manualGuideKeys: [],
              docUrls: {
                provider: "",
                prerequisites: {},
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          jobId: "job-1",
          providerId: "claude",
          strategyIds: ["npm"],
          status: "running",
          steps: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          jobId: "job-1",
          providerId: "claude",
          strategyIds: ["npm"],
          status: "succeeded",
          steps: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          providers: {
            claude: {
              providerId: "claude",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: [],
              docUrls: {
                provider: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
                prerequisites: {},
              },
            },
            codex: {
              providerId: "codex",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: [],
              docUrls: {
                provider:
                  "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
                prerequisites: {},
              },
            },
            gemini: {
              providerId: "gemini",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: false,
              installReadiness: "ready",
              manualGuideKeys: [],
              docUrls: {
                provider: "",
                prerequisites: {},
              },
            },
            cursor: {
              providerId: "cursor",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: false,
              installReadiness: "ready",
              manualGuideKeys: [],
              docUrls: {
                provider: "",
                prerequisites: {},
              },
            },
            opencode: {
              providerId: "opencode",
              available: false,
              missingCommands: ["opencode"],
              missingPrerequisites: [],
              autoInstallSupported: false,
              installReadiness: "unsupported_platform",
              manualGuideKeys: [],
              docUrls: {
                provider: "",
                prerequisites: {},
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: "sess-1",
          workspaceId: "ws-1",
          terminalId: "term-1",
          providerId: "claude",
          state: "starting",
          capability: "full",
          startedAt: 1,
          lastActiveAt: 1,
        },
      }) as DispatchCommand;

    const onSessionCreated = vi.fn();

    const { result } = renderHook(
      () =>
        useProviderLauncher(dispatch, "ws-1", onSessionCreated, {
          paneId: "pane-1",
          launchMode: "assign",
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.providers.map((provider) => provider.id)).toEqual([
        "claude",
        "codex",
        "gemini",
        "cursor",
        "opencode",
      ]);
      expect(result.current.states.claude?.runtime?.available).toBe(false);
    });

    const originalSetTimeout = window.setTimeout.bind(window);
    let pollHandler: (() => Promise<void>) | null = null;
    const timeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (!pollHandler && typeof handler === "function" && timeout === 1500) {
        pollHandler = handler as () => Promise<void>;
        return 1 as unknown as number;
      }

      return originalSetTimeout(
        handler as TimerHandler,
        timeout,
        ...(args as Parameters<typeof window.setTimeout> extends [
          TimerHandler,
          number?,
          ...infer Rest,
        ]
          ? Rest
          : never)
      );
    }) as typeof window.setTimeout);

    await act(async () => {
      await result.current.launch("claude");
    });

    expect(dispatch).toHaveBeenCalledWith("provider.install.start", {
      providerId: "claude",
    });
    expect(result.current.states.claude?.installJob?.status).toBe("running");
    expect(pollHandler).not.toBeNull();

    await act(async () => {
      await pollHandler?.();
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith("provider.install.get", { jobId: "job-1" });
      expect(dispatch).toHaveBeenCalledWith("provider.runtimeStatus", {});
      expect(dispatch).toHaveBeenCalledWith(
        "session.create",
        expect.objectContaining({
          workspaceId: "ws-1",
          providerId: "claude",
          themeBackground: expect.stringMatching(/^#[0-9a-fA-F]{6,8}$/),
        })
      );
    });

    expect(onSessionCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sess-1",
        providerId: "claude",
      }),
      "claude"
    );
    timeoutSpy.mockRestore();
  });

  it("refreshes runtime status and exposes an inline error when session creation discovers a stale missing CLI", async () => {
    const store = createStore();
    store.set(providerListAtom, createProviderList());
    const wrapper = createWrapper(store);
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          providers: {
            claude: {
              providerId: "claude",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: [],
              docUrls: {
                provider: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
                prerequisites: {},
              },
            },
            codex: {
              providerId: "codex",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: [],
              docUrls: {
                provider:
                  "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
                prerequisites: {},
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "provider_cli_missing",
          message: "Claude CLI is missing",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          providers: {
            claude: {
              providerId: "claude",
              available: false,
              missingCommands: ["claude"],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: ["provider.install.claude.manual"],
              docUrls: {
                provider: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
                prerequisites: {},
              },
            },
            codex: {
              providerId: "codex",
              available: true,
              missingCommands: [],
              missingPrerequisites: [],
              autoInstallSupported: true,
              installReadiness: "ready",
              manualGuideKeys: [],
              docUrls: {
                provider:
                  "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
                prerequisites: {},
              },
            },
          },
        },
      }) as DispatchCommand;

    const onSessionCreated = vi.fn();

    const { result } = renderHook(
      () =>
        useProviderLauncher(dispatch, "ws-1", onSessionCreated, {
          launchMode: "replace",
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.providers).toHaveLength(5);
    });

    await act(async () => {
      await result.current.launch("claude");
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith("provider.runtimeStatus", {});
      expect(dispatch).toHaveBeenCalledWith(
        "session.create",
        expect.objectContaining({
          workspaceId: "ws-1",
          providerId: "claude",
          themeBackground: expect.stringMatching(/^#[0-9a-fA-F]{6,8}$/),
        })
      );
      expect(result.current.states.claude?.runtime?.available).toBe(false);
      expect(result.current.states.claude?.inlineError).toBe("Claude CLI is missing");
    });

    expect(onSessionCreated).not.toHaveBeenCalled();
  });
});
