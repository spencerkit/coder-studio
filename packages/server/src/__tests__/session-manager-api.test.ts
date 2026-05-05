import type { DomainEvent, ProviderDefinition, Session } from "@coder-studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { SessionManager } from "../session/manager.js";
import type { SessionDatabase } from "../session/types.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { TerminalManager } from "../terminal/manager.js";
import type { PtyHost, PtyProcess, TerminalDatabase } from "../terminal/types.js";
import type { Broadcaster } from "../ws/hub.js";

type MutableSessionManager = SessionManager & {
  detectors: Map<string, unknown>;
  comparators: Map<string, unknown>;
  detectorUnsubscribes: Map<string, unknown>;
};

type EventBusWithHandlers = EventBus & {
  handlers: Map<string, Set<(...args: unknown[]) => void>>;
};

const providerConfigRepoStub = {
  get: vi.fn(() => undefined),
} as unknown as ProviderConfigRepo;

describe("SessionManager session-level API", () => {
  let eventBus: EventBus;
  let terminalMgr: TerminalManager;
  let sessionMgr: SessionManager;
  let ptyWrites: Buffer[];
  let ptyResizes: Array<[number, number]>;
  let mockPty: PtyProcess;
  let provider: ProviderDefinition;

  beforeEach(() => {
    ptyWrites = [];
    ptyResizes = [];

    mockPty = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn((bytes: Buffer | string) => {
        ptyWrites.push(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
      }),
      resize: vi.fn((cols: number, rows: number) => {
        ptyResizes.push([cols, rows]);
      }),
      kill: vi.fn().mockResolvedValue(undefined),
    };

    const ptyHost: PtyHost = {
      spawn: vi.fn().mockReturnValue(mockPty),
    };

    const terminalDb: TerminalDatabase = {
      insert: vi.fn(),
      markEnded: vi.fn(),
    };

    const sessionDb: SessionDatabase = {
      insert: vi.fn(),
      update: vi.fn(),
      findById: vi.fn(),
      findByWorkspaceId: vi.fn().mockReturnValue([]),
      listHydratable: vi.fn().mockReturnValue([]),
      delete: vi.fn(),
    };

    provider = {
      id: "stub",
      displayName: "Stub",
      capability: "full",
      defaultConfig: {},
      buildCommand: () => ({ argv: ["stub"], cwd: "/tmp", env: {} }),
      hooks: {
        events: {
          sessionStart: false,
          turnCompleted: true,
          stop: true,
          progress: false,
        },
      },
    } as ProviderDefinition;

    eventBus = new EventBus();
    terminalMgr = new TerminalManager({ ptyHost, eventBus, db: terminalDb });
    sessionMgr = new SessionManager({
      terminalMgr,
      eventBus,
      db: sessionDb,
      broadcaster: { broadcast: vi.fn() } as Broadcaster,
      providerRegistry: [provider],
      providerConfigRepo: providerConfigRepoStub,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createSession = async () => {
    const session = await sessionMgr.create({
      workspaceId: "ws-1",
      workspacePath: "/tmp",
      providerId: provider.id,
      provider,
    });

    return session;
  };

  it("sendInput writes to PTY and updates session activity for submit", async () => {
    const session = await createSession();

    sessionMgr.sendInput(session.id, Buffer.from("hello\r"), "submit");

    expect(ptyWrites[0]?.toString()).toBe("hello\r");
    expect(sessionMgr.get(session.id)?.state).toBe("running");
  });

  it("prefers explicit submitted text over raw terminal bytes for submit activity", async () => {
    const session = await createSession();

    sessionMgr.sendInput(session.id, Buffer.from("\r"), "submit", "fix the build");

    expect(sessionMgr.get(session.id)?.title).toBe("fix the b…");
  });

  it("resize forwards to the underlying PTY", async () => {
    const session = await createSession();

    sessionMgr.resize(session.id, 100, 40);

    expect(ptyResizes[0]).toEqual([100, 40]);
  });

  it("getOutputTail returns the last N bytes from the session terminal buffer", async () => {
    const session = await createSession();
    const onData = vi.mocked(mockPty.onData).mock.calls[0]?.[0];
    expect(onData).toBeTypeOf("function");

    onData?.("abcdefghij");

    expect(sessionMgr.getOutputTail(session.id, 4).toString()).toBe("ghij");
  });

  it("returns rendered text from the session headless snapshot buffer", async () => {
    const session = await createSession();
    const onData = vi.mocked(mockPty.onData).mock.calls[0]?.[0];
    expect(onData).toBeTypeOf("function");

    onData?.("hello \x1b[31mworld\x1b[0m\n");

    await expect(
      sessionMgr.getRenderedSnapshot(session.id, { maxLines: 10, maxChars: 1000 })
    ).resolves.toBe("hello world");
  });

  it("returns empty string when the session snapshot buffer is unavailable", async () => {
    const session = await createSession();
    terminalMgr.get(session.terminalId)?.snapshotBuffer?.dispose();

    await expect(
      sessionMgr.getRenderedSnapshot(session.id, { maxLines: 10, maxChars: 1000 })
    ).resolves.toBe("");
  });

  it("records the latest submitted user input for supervisor context", async () => {
    const session = await createSession();

    sessionMgr.sendInput(session.id, Buffer.from("\r"), "submit", "  fix the build  ");
    sessionMgr.sendInput(session.id, Buffer.from("draft"), "typing");

    expect(sessionMgr.getLatestSubmittedUserInput(session.id)).toBe("fix the build");
  });

  it("subscribes PTY detector shadow mode when provider exposes idle heuristics", async () => {
    provider = {
      ...provider,
      idleHeuristics: {
        idlePromptPatterns: [],
        idleDebounceMs: 3000,
      },
    } as ProviderDefinition;
    sessionMgr = new SessionManager({
      terminalMgr,
      eventBus,
      db: {
        insert: vi.fn(),
        update: vi.fn(),
        findById: vi.fn(),
        findByWorkspaceId: vi.fn().mockReturnValue([]),
        listHydratable: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      } as SessionDatabase,
      broadcaster: { broadcast: vi.fn() } as Broadcaster,
      providerRegistry: [provider],
      providerConfigRepo: providerConfigRepoStub,
    });

    const session = await createSession();
    const outputHandlers = vi.mocked(
      (eventBus as EventBusWithHandlers).handlers?.get?.("terminal.output") ?? new Set()
    );
    expect(session).toBeDefined();
    expect((sessionMgr as MutableSessionManager).detectors.get(session.id)).toBeDefined();
    expect((sessionMgr as MutableSessionManager).comparators.get(session.id)).toBeDefined();
    expect((sessionMgr as MutableSessionManager).detectorUnsubscribes.get(session.id)).toBeTypeOf(
      "function"
    );
    expect(outputHandlers.size).toBeGreaterThan(0);
  });

  it("moves a PTY-driven session to idle after startup output without emitting turn_completed", async () => {
    vi.useFakeTimers();
    provider = {
      ...provider,
      idleHeuristics: {
        idlePromptPatterns: [],
        idleDebounceMs: 3000,
      },
    } as ProviderDefinition;
    sessionMgr = new SessionManager({
      terminalMgr,
      eventBus,
      db: {
        insert: vi.fn(),
        update: vi.fn(),
        findById: vi.fn(),
        findByWorkspaceId: vi.fn().mockReturnValue([]),
        listHydratable: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      } as SessionDatabase,
      broadcaster: { broadcast: vi.fn() } as Broadcaster,
      providerRegistry: [provider],
      providerConfigRepo: providerConfigRepoStub,
    });
    const lifecycleEvents: string[] = [];
    eventBus.on("session.lifecycle", (event) => lifecycleEvents.push(event.event));

    const session = await createSession();
    const onData = vi.mocked(mockPty.onData).mock.calls.at(-1)?.[0];
    expect(sessionMgr.get(session.id)?.state).toBe("starting");

    onData?.("booting up\n");
    expect(sessionMgr.get(session.id)?.state).toBe("running");

    vi.advanceTimersByTime(3000);

    expect(sessionMgr.get(session.id)?.state).toBe("idle");
    expect(lifecycleEvents).toEqual([]);
  });

  it("emits turn_completed only after an armed submit returns to idle", async () => {
    vi.useFakeTimers();
    provider = {
      ...provider,
      idleHeuristics: {
        idlePromptPatterns: [],
        idleDebounceMs: 3000,
      },
    } as ProviderDefinition;
    sessionMgr = new SessionManager({
      terminalMgr,
      eventBus,
      db: {
        insert: vi.fn(),
        update: vi.fn(),
        findById: vi.fn(),
        findByWorkspaceId: vi.fn().mockReturnValue([]),
        listHydratable: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      } as SessionDatabase,
      broadcaster: { broadcast: vi.fn() } as Broadcaster,
      providerRegistry: [provider],
      providerConfigRepo: providerConfigRepoStub,
    });
    const lifecycleEvents: string[] = [];
    eventBus.on("session.lifecycle", (event) => lifecycleEvents.push(event.event));

    const session = await createSession();
    const onData = vi.mocked(mockPty.onData).mock.calls.at(-1)?.[0];
    onData?.("booting up\n");
    vi.advanceTimersByTime(3000);
    lifecycleEvents.length = 0;

    sessionMgr.sendInput(session.id, Buffer.from("\r"), "submit", "fix the build");
    expect(sessionMgr.get(session.id)?.state).toBe("running");

    onData?.("working...\n");
    vi.advanceTimersByTime(3000);

    expect(sessionMgr.get(session.id)?.state).toBe("idle");
    expect(sessionMgr.getLatestSubmittedUserInput(session.id)).toBe("fix the build");
    expect(lifecycleEvents).toEqual(["turn_completed"]);
  });

  it("arms turn completion for internal_submit input without overwriting latest submitted user input", async () => {
    vi.useFakeTimers();
    provider = {
      ...provider,
      idleHeuristics: {
        idlePromptPatterns: [],
        idleDebounceMs: 3000,
      },
    } as ProviderDefinition;
    sessionMgr = new SessionManager({
      terminalMgr,
      eventBus,
      db: {
        insert: vi.fn(),
        update: vi.fn(),
        findById: vi.fn(),
        findByWorkspaceId: vi.fn().mockReturnValue([]),
        listHydratable: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      } as SessionDatabase,
      broadcaster: { broadcast: vi.fn() } as Broadcaster,
      providerRegistry: [provider],
      providerConfigRepo: providerConfigRepoStub,
    });
    const lifecycleEvents: string[] = [];
    eventBus.on("session.lifecycle", (event) => lifecycleEvents.push(event.event));

    const session = await createSession();
    const onData = vi.mocked(mockPty.onData).mock.calls.at(-1)?.[0];
    onData?.("booting up\n");
    vi.advanceTimersByTime(3000);

    sessionMgr.sendInput(session.id, Buffer.from("\r"), "submit", "fix the build");
    onData?.("working...\n");
    vi.advanceTimersByTime(3000);
    lifecycleEvents.length = 0;

    sessionMgr.sendInput(
      session.id,
      Buffer.from("[Supervisor] follow up\r", "utf8"),
      "internal_submit"
    );
    expect(sessionMgr.get(session.id)?.state).toBe("running");

    onData?.("agent reply\n");
    vi.advanceTimersByTime(3000);

    expect(sessionMgr.get(session.id)?.state).toBe("idle");
    expect(sessionMgr.getLatestSubmittedUserInput(session.id)).toBe("fix the build");
    expect(lifecycleEvents).toEqual(["turn_completed"]);
  });

  it("does not arm turn completion for control input or overwrite latest submitted user input", async () => {
    vi.useFakeTimers();
    provider = {
      ...provider,
      idleHeuristics: {
        idlePromptPatterns: [],
        idleDebounceMs: 3000,
      },
    } as ProviderDefinition;
    sessionMgr = new SessionManager({
      terminalMgr,
      eventBus,
      db: {
        insert: vi.fn(),
        update: vi.fn(),
        findById: vi.fn(),
        findByWorkspaceId: vi.fn().mockReturnValue([]),
        listHydratable: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      } as SessionDatabase,
      broadcaster: { broadcast: vi.fn() } as Broadcaster,
      providerRegistry: [provider],
      providerConfigRepo: providerConfigRepoStub,
    });
    const lifecycleEvents: string[] = [];
    eventBus.on("session.lifecycle", (event) => lifecycleEvents.push(event.event));

    const session = await createSession();
    const onData = vi.mocked(mockPty.onData).mock.calls.at(-1)?.[0];
    onData?.("booting up\n");
    vi.advanceTimersByTime(3000);

    sessionMgr.sendInput(session.id, Buffer.from("\r"), "submit", "fix the build");
    onData?.("working...\n");
    vi.advanceTimersByTime(3000);
    lifecycleEvents.length = 0;

    sessionMgr.sendInput(session.id, Buffer.from("\x03"), "control");
    expect(sessionMgr.get(session.id)?.state).toBe("idle");

    onData?.("interrupted\n");
    vi.advanceTimersByTime(3000);

    expect(sessionMgr.get(session.id)?.state).toBe("idle");
    expect(sessionMgr.getLatestSubmittedUserInput(session.id)).toBe("fix the build");
    expect(lifecycleEvents).toEqual([]);
  });

  it("does not expose a resume API", () => {
    expect((sessionMgr as unknown as { resume?: unknown }).resume).toBeUndefined();
  });

  it("throws on unknown session id for sendInput", () => {
    expect(() => sessionMgr.sendInput("sess-missing", Buffer.from("x"))).toThrow(
      /Session not found/
    );
  });

  it("does not retain a half-created session when terminal creation throws", async () => {
    const failingProvider = {
      ...provider,
      id: "failing-stub",
      buildCommand: () => ({ argv: ["failing-stub"], cwd: "/tmp", env: {} }),
    } as ProviderDefinition;

    const failingSessionMgr = new SessionManager({
      terminalMgr: {
        ...terminalMgr,
        create: vi.fn(() => {
          throw new Error("spawn failed");
        }),
      } as TerminalManager,
      eventBus,
      db: {
        insert: vi.fn(),
        update: vi.fn(),
        findById: vi.fn(),
        findByWorkspaceId: vi.fn().mockReturnValue([]),
        listHydratable: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
      } as SessionDatabase,
      broadcaster: { broadcast: vi.fn() } as Broadcaster,
      providerRegistry: [failingProvider],
      providerConfigRepo: providerConfigRepoStub,
    });

    await expect(
      failingSessionMgr.create({
        workspaceId: "ws-1",
        workspacePath: "/tmp",
        providerId: failingProvider.id,
        provider: failingProvider,
      })
    ).rejects.toThrow("spawn failed");

    expect(failingSessionMgr.getForWorkspace("ws-1")).toEqual([]);
  });
});
