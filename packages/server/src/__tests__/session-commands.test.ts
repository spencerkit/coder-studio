import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { providerRegistry } from "@coder-studio/providers";
import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { buildCustomProviderDefinition } from "../provider-runtime/custom-provider.js";
import { SessionManager } from "../session/manager.js";
import type { SessionDatabase } from "../session/types.js";
import { openDatabase, runMigrations } from "../storage/db.js";
import { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import { rowToSession, type SessionRow } from "../storage/repositories/session-repo.js";
import type { TerminalManager } from "../terminal/manager.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import type { Broadcaster } from "../ws/hub.js";

// Import command handlers to register them
import "../commands/workspace.js";
import "../commands/session.js";

describe("Session Commands", () => {
  const broadcaster = { broadcast: () => {} } satisfies Broadcaster;
  const providerConfigRepo = (db: ReturnType<typeof openDatabase>) =>
    new ProviderConfigRepo(db) as Pick<ProviderConfigRepo, "get"> as ProviderConfigRepo;

  let db: ReturnType<typeof openDatabase>;
  let ctx: CommandContext;
  let eventBus: EventBus;
  let workspaceMgr: WorkspaceManager;
  let sessionMgr: SessionManager;
  let sessionMetadataRepo: SessionMetadataRepo;
  let sessionDb: SessionDatabase;
  let terminalMgrStub: TerminalManager;

  beforeEach(() => {
    // Create in-memory database for testing
    db = openDatabase(":memory:");
    runMigrations(db);

    // Create event bus
    eventBus = new EventBus();

    // Create managers
    workspaceMgr = new WorkspaceManager({ db, eventBus });
    sessionMetadataRepo = new SessionMetadataRepo(db);
    terminalMgrStub = {
      create: (spec) => {
        db.prepare(
          `INSERT INTO terminals (id, workspace_id, kind, title, cwd, argv, cols, rows, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          "terminal-1",
          spec.workspaceId,
          spec.kind,
          spec.title ?? "",
          spec.cwd,
          JSON.stringify(spec.argv),
          spec.cols ?? 120,
          spec.rows ?? 30,
          Date.now()
        );

        return {
          id: "terminal-1",
        };
      },
      kill: async () => {},
      close: async () => {},
    } as unknown as TerminalManager;
    sessionDb = {
      insert: (session: SessionRow) => {
        db.prepare(
          `INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, state, capability, started_at, last_active_at, title)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          session.id,
          session.workspace_id,
          session.terminal_id,
          session.provider_id,
          session.state,
          session.capability,
          session.started_at,
          session.last_active_at,
          session.title ?? null
        );
      },
      update: (id, patch) => {
        const keys = Object.keys(patch);
        if (keys.length === 0) return;

        const allowedCols = new Set([
          "terminal_id",
          "state",
          "started_at",
          "ended_at",
          "completion_percent",
          "error_reason",
          "last_active_at",
          "title",
        ]);
        const setClauses: string[] = [];
        const values: unknown[] = [];
        for (const key of keys) {
          const col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
          if (!allowedCols.has(col)) continue;
          setClauses.push(`${col} = ?`);
          values.push((patch as Record<string, unknown>)[key] ?? null);
        }
        if (setClauses.length === 0) return;

        db.prepare(`UPDATE sessions SET ${setClauses.join(", ")} WHERE id = ?`).run(
          ...(values as Array<string | number | null>),
          id
        );
      },
      findById: (id) => {
        const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
          | SessionRow
          | undefined;
        return row ? rowToSession(row) : undefined;
      },
      findByWorkspaceId: (workspaceId) => {
        const rows = db
          .prepare("SELECT * FROM sessions WHERE workspace_id = ? ORDER BY started_at DESC")
          .all(workspaceId) as unknown as SessionRow[];
        return rows.map(rowToSession);
      },
      listHydratable: () => {
        const rows = db
          .prepare(
            "SELECT * FROM sessions WHERE archived = 0 AND ended_at IS NULL ORDER BY started_at DESC"
          )
          .all() as unknown as SessionRow[];
        return rows.map(rowToSession);
      },
      delete: (id) => {
        db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
      },
    };
    sessionMgr = new SessionManager({
      terminalMgr: terminalMgrStub,
      eventBus,
      db: sessionDb,
      broadcaster,
      providerRegistry: [],
      providerConfigRepo: providerConfigRepo(db),
    });

    // Create context with required dependencies
    ctx = {
      db,
      workspaceMgr,
      sessionMgr,
      terminalMgr: {},
      eventBus,
      broadcaster,
      providerRegistry: [],
      fencingMgr: {},
      supervisorMgr: {},
      providerConfigRepo: providerConfigRepo(db),
      sessionMetadataRepo,
    } as unknown as CommandContext;
  });

  describe("session.create", () => {
    it("should error if workspace not found", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-2",
          op: "session.create",
          args: {
            workspaceId: "non-existent-id",
            providerId: "claude-code",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });

    it("returns provider_cli_missing before terminal spawn when the CLI is absent", async () => {
      const testDir = join(tmpdir(), `coder-studio-session-command-${Date.now()}`);
      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(join(testDir, ".git", "HEAD"), "ref: refs/heads/main\n");

      ctx.providerRegistry = providerRegistry as ProviderDefinition[];
      ctx.providerRuntimeDeps = {
        commandExists: async (command: string) => command !== "claude",
      };

      try {
        const openResult = await dispatch(
          {
            kind: "command",
            id: "workspace-id",
            op: "workspace.open",
            args: { path: testDir },
          },
          ctx
        );

        expect(openResult.ok).toBe(true);

        const result = await dispatch(
          {
            kind: "command",
            id: "session-id",
            op: "session.create",
            args: {
              workspaceId: openResult.data!.id,
              providerId: "claude",
            },
          },
          ctx
        );

        expect(result.ok).toBe(false);
        expect(result.error).toEqual({
          code: "provider_cli_missing",
          message: "Provider CLI is not installed",
          details: {
            providerId: "claude",
            missingCommands: ["claude"],
          },
        });
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("launches a custom provider through the existing session.create flow", async () => {
      const testDir = join(tmpdir(), `coder-studio-custom-provider-session-${Date.now()}`);
      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(join(testDir, ".git", "HEAD"), "ref: refs/heads/main\n");

      const customProvider = buildCustomProviderDefinition({
        id: "review-bot",
        displayName: "Review Bot",
        command: "review-bot",
        args: ["--stdio"],
        env: { REVIEW_MODE: "strict" },
        cwdMode: "workspace_root",
        sessionMode: "interactive",
        capabilities: [
          { key: "interactive_session", supported: true, label: "Interactive session" },
          { key: "review", supported: true, label: "Review" },
        ],
        startupPrompt: "Review before responding.",
        createdAt: 100,
        updatedAt: 100,
      });

      ctx.providerRegistry = [...providerRegistry, customProvider] as ProviderDefinition[];
      ctx.providerRuntimeDeps = {
        commandExists: async (command: string) => command === "review-bot",
      };

      try {
        const openResult = await dispatch(
          {
            kind: "command",
            id: "workspace-custom-provider",
            op: "workspace.open",
            args: { path: testDir },
          },
          ctx
        );

        expect(openResult.ok).toBe(true);

        const result = await dispatch(
          {
            kind: "command",
            id: "session-custom-provider",
            op: "session.create",
            args: {
              workspaceId: openResult.data!.id,
              providerId: "review-bot",
            },
          },
          ctx
        );

        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({
          providerId: "review-bot",
          capability: "full",
          state: "starting",
        });
        expect(sessionMetadataRepo.get(result.data!.id)).toMatchObject({
          sessionId: result.data!.id,
          workspaceId: openResult.data!.id,
          providerId: "review-bot",
          objective: undefined,
          baselineGitHead: undefined,
          verificationRuns: [],
        });
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("captures session objective and git baseline metadata when available", async () => {
      const testDir = join(tmpdir(), `coder-studio-session-metadata-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      mkdirSync(join(testDir, ".git"), { recursive: true });
      writeFileSync(join(testDir, ".git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");

      ctx.providerRegistry = providerRegistry as ProviderDefinition[];
      ctx.providerRuntimeDeps = {
        commandExists: async (command: string) => command === "claude",
      };

      try {
        const openResult = await dispatch(
          {
            kind: "command",
            id: "workspace-metadata",
            op: "workspace.open",
            args: { path: testDir },
          },
          ctx
        );

        expect(openResult.ok).toBe(true);

        const result = await dispatch(
          {
            kind: "command",
            id: "session-metadata",
            op: "session.create",
            args: {
              workspaceId: openResult.data!.id,
              providerId: "claude",
              draft: "Fix the build and run focused verification",
            },
          },
          ctx
        );

        expect(result.ok).toBe(true);
        expect(sessionMetadataRepo.get(result.data!.id)).toMatchObject({
          sessionId: result.data!.id,
          workspaceId: openResult.data!.id,
          providerId: "claude",
          objective: "Fix the build and run focused verification",
          baselineGitHead: "0123456789abcdef0123456789abcdef01234567",
          baselineCapturedAt: expect.any(Number),
          verificationRuns: [],
        });
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("session.stop", () => {
    it("should error if session not found", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-5",
          op: "session.stop",
          args: {
            sessionId: "non-existent-id",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });
  });

  describe("session.remove", () => {
    it("should error if session not found", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-6",
          op: "session.remove",
          args: {
            sessionId: "non-existent-id",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });
  });

  describe("session.resume", () => {
    it("should return unknown_op because the command has been removed", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-8",
          op: "session.resume",
          args: {
            sessionId: "non-existent-id",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("unknown_op");
    });
  });
});
