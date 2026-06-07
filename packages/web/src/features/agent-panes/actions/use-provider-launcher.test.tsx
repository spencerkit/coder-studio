import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DispatchCommand } from "../../../atoms/connection";
import { useProviderLauncher } from "./use-provider-launcher";

describe("useProviderLauncher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-installs a missing provider CLI, refreshes status, and creates the session", async () => {
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

    const { result } = renderHook(() =>
      useProviderLauncher(dispatch, "ws-1", onSessionCreated, {
        paneId: "pane-1",
        launchMode: "assign",
      })
    );

    await waitFor(() => {
      expect(result.current.states.claude.runtime?.available).toBe(false);
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

    expect(dispatch).toHaveBeenNthCalledWith(2, "provider.install.start", {
      providerId: "claude",
    });
    expect(result.current.states.claude.installJob?.status).toBe("running");

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

    const { result } = renderHook(() =>
      useProviderLauncher(dispatch, "ws-1", onSessionCreated, {
        launchMode: "replace",
      })
    );

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
      expect(result.current.states.claude.runtime?.available).toBe(false);
      expect(result.current.states.claude.inlineError).toBe("Claude CLI is missing");
    });
    expect(onSessionCreated).not.toHaveBeenCalled();
  });
});
