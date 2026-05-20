import type { ProviderDefinition, Session, Supervisor } from "@coder-studio/core";
import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { SessionManager } from "../session/manager.js";
import type { TerminalManager } from "../terminal/manager.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import { SupervisorContextBuilder, stripAnsi } from "./context-builder.js";

type WorkspaceManagerStub = Pick<WorkspaceManager, "get">;
type SessionManagerStub = Pick<
  SessionManager,
  "get" | "getOutputTail" | "getRenderedSnapshot" | "getLatestSubmittedUserInput"
>;
type BuilderDeps = ConstructorParameters<typeof SupervisorContextBuilder>[0];

const createWorkspaceMgr = (): WorkspaceManagerStub => ({
  get: vi.fn(() => ({ id: "ws-1", path: "/workspace" })),
});

const createSessionRecord = (): Session => ({
  id: "sess-1",
  workspaceId: "ws-1",
  providerId: "claude",
  terminalId: "term-1",
  state: "running",
  capability: "full",
  startedAt: 1,
  lastActiveAt: 1,
});

const createSessionMgr = (overrides?: Partial<SessionManagerStub>): SessionManagerStub => ({
  get: vi.fn(() => createSessionRecord()),
  getOutputTail: vi.fn(() => Buffer.from("terminal fallback")),
  getRenderedSnapshot: vi.fn(async () => "rendered terminal content here"),
  getLatestSubmittedUserInput: vi.fn(() => "run the tests"),
  ...overrides,
});

const createBuilder = (
  overrides?: Partial<BuilderDeps> & {
    sessionMgr?: SessionManagerStub;
    workspaceMgr?: WorkspaceManagerStub;
    logger?: FastifyBaseLogger;
  }
) =>
  new SupervisorContextBuilder({
    workspaceMgr: (overrides?.workspaceMgr ?? createWorkspaceMgr()) as WorkspaceManager,
    sessionMgr: (overrides?.sessionMgr ?? createSessionMgr()) as SessionManager,
    terminalMgr: (overrides?.terminalMgr ?? {}) as TerminalManager,
    providerRegistry: (overrides?.providerRegistry ?? []) as ProviderDefinition[],
    git: overrides?.git,
    logger: overrides?.logger,
  });

const baseSupervisor: Supervisor = {
  id: "sup-1",
  sessionId: "sess-1",
  workspaceId: "ws-1",
  targetId: "tgt-1",
  state: "idle",
  objective: "Persist supervisors",
  evaluatorProviderId: "codex",
  maxSupervisionCount: 0,
  completedSupervisionCount: 0,
  recentTargetCycles: [],
  createdAt: 1,
  updatedAt: 1,
};

const baseTargetMemory = {
  targetId: "tgt-1",
  decompositionGenerated: false,
  items: [],
  stalledCount: 0,
  updatedAt: 1,
} as const;

describe("stripAnsi", () => {
  it("removes bracketed paste markers", () => {
    expect(stripAnsi("\x1b[?2004htext\x1b[200~")).toBe("text");
  });

  it("removes cursor position reports", () => {
    expect(stripAnsi("\x1b[6n\x1b[?u")).toBe("");
  });

  it("removes CSI sequences including colors", () => {
    expect(stripAnsi("\x1b[31mmessage\x1b[0m")).toBe("message");
  });

  it("removes screen clearing sequences", () => {
    expect(stripAnsi("\x1b[2Jclear\x1b[H")).toBe("clear");
  });

  it("removes terminal mode sequences with > prefix", () => {
    expect(stripAnsi("\x1b[>7utext")).toBe("text");
  });

  it("strips real terminal excerpt with mixed sequences", () => {
    const raw = "\x1b[?2004h\x1b[>7u\x1b[?1004h\x1b[6n" + "npm test\nPASS\n" + "\x1b[?u";
    expect(stripAnsi(raw)).toBe("npm test\nPASS");
  });

  it("preserves plain text", () => {
    expect(stripAnsi("hello world\nbuild passes")).toBe("hello world\nbuild passes");
  });
});

describe("SupervisorContextBuilder", () => {
  it("uses headless snapshot as primary evidence source", async () => {
    const builder = createBuilder({
      git: {
        getStatusSummary: vi.fn(async () => "M packages/server/src/supervisor/manager.ts"),
        getDiffStatSummary: vi.fn(async () => "1 file changed, 42 insertions(+)"),
      },
    });

    const context = await builder.build(baseSupervisor, baseTargetMemory);

    expect(context.evidenceSource).toBe("headless_snapshot");
    expect(context.terminalExcerpt).toContain("rendered terminal content here");
    expect(context.transcriptExcerpt).toBeUndefined();
    expect(context.lastTurnId).toBeUndefined();
    expect(context.targetMemory).toEqual(baseTargetMemory);
    expect("gitStatusSummary" in context).toBe(false);
    expect("gitDiffStat" in context).toBe(false);
  });

  it("returns an empty headless snapshot when no rendered terminal content is available", async () => {
    const builder = createBuilder({
      sessionMgr: createSessionMgr({
        getOutputTail: vi.fn(() => Buffer.from("npm test\nPASS")),
        getRenderedSnapshot: vi.fn(async () => ""),
        getLatestSubmittedUserInput: vi.fn(() => undefined),
      }),
      git: {
        getStatusSummary: vi.fn(async () => ""),
        getDiffStatSummary: vi.fn(async () => ""),
      },
    });

    const context = await builder.build(
      { ...baseSupervisor, evaluatorProviderId: "claude" },
      baseTargetMemory
    );

    expect(context.evidenceSource).toBe("headless_snapshot");
    expect(context.terminalExcerpt).toBe("");
    expect(context.transcriptExcerpt).toBeUndefined();
  });

  it("reads latestUserInput from the session manager", async () => {
    const builder = createBuilder({
      sessionMgr: createSessionMgr({
        getRenderedSnapshot: vi.fn(async () => "headless shadow"),
      }),
      git: {
        getStatusSummary: vi.fn(async () => ""),
        getDiffStatSummary: vi.fn(async () => ""),
      },
    });

    const context = await builder.build(
      {
        ...baseSupervisor,
        objective: "Ship the fix",
        evaluatorProviderId: "claude",
      },
      baseTargetMemory
    );

    expect(context.latestUserInput).toBe("run the tests");
  });

  it("does not set latestUserInput when the session manager has no submitted input", async () => {
    const builder = createBuilder({
      sessionMgr: createSessionMgr({
        getOutputTail: vi.fn(() => Buffer.from("npm test\nPASS")),
        getRenderedSnapshot: vi.fn(async () => "headless shadow"),
        getLatestSubmittedUserInput: vi.fn(() => undefined),
      }),
      git: {
        getStatusSummary: vi.fn(async () => ""),
        getDiffStatSummary: vi.fn(async () => ""),
      },
    });

    const context = await builder.build(
      { ...baseSupervisor, evaluatorProviderId: "claude" },
      baseTargetMemory
    );

    expect(context.latestUserInput).toBeUndefined();
  });

  it("logs a headless snapshot evidence metric", async () => {
    const logger = {
      child: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      info: vi.fn(),
      level: "silent",
      silent: vi.fn(),
      trace: vi.fn(),
      warn: vi.fn(),
    } as FastifyBaseLogger;

    const builder = createBuilder({
      sessionMgr: createSessionMgr({
        getRenderedSnapshot: vi.fn(async () => "headless snapshot output"),
      }),
      git: {
        getStatusSummary: vi.fn(async () => ""),
        getDiffStatSummary: vi.fn(async () => ""),
      },
      logger,
    });

    await builder.build(baseSupervisor, baseTargetMemory);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: "supervisor.evidence.built",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        evidenceSource: "headless_snapshot",
        terminalCharCount: "headless snapshot output".length,
      }),
      "supervisor evidence built"
    );
  });
});
