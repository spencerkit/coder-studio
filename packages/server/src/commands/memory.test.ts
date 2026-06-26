import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceMemoryEntry } from "@coder-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepo } from "../storage/repositories/memory-repo.js";
import { type CommandContext, dispatch } from "../ws/dispatch.js";
import "./index.js";

function command(op: string, args: unknown) {
  return {
    kind: "command" as const,
    id: `${op}-test`,
    op,
    args,
  };
}

describe("memory commands", () => {
  let tempDir: string;
  let now: number;
  let random: number;
  let broadcast: ReturnType<typeof vi.fn>;
  let ctx: CommandContext;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memory-command-"));
    now = 1779120000000;
    random = 0;
    broadcast = vi.fn();
    ctx = {
      workspaceMgr: {
        get: vi.fn((workspaceId: string) =>
          workspaceId === "ws-1" ? { id: "ws-1", path: "/repo" } : undefined
        ),
      },
      sessionMgr: {},
      terminalMgr: {},
      taskMgr: {},
      eventBus: {},
      broadcaster: { broadcast },
      settingsRepo: {},
      providerConfigRepo: {},
      providerRegistry: [],
      fencingMgr: {},
      supervisorMgr: {},
      autoFetch: {},
      activationMgr: {},
      lspMgr: {},
      memoryRepo: new MemoryRepo({
        rootDir: join(tempDir, "memory", "workspaces"),
        now: () => now,
        randomId: () => `r${++random}`,
      }),
    } as unknown as CommandContext;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates, lists, searches, gets, updates, and deletes workspace memory entries", async () => {
    const createdResult = await dispatch(
      command("memory.create", {
        workspaceId: "ws-1",
        type: "wiki",
        content: "Keep durable context outside the Git workspace.",
        sourceHint: {
          kind: "skill",
          skillSlug: "coder-studio-memory",
          sessionId: "session-1",
        },
      }),
      ctx
    );

    expect(createdResult.ok).toBe(true);
    const created = createdResult.data as WorkspaceMemoryEntry;
    expect(created).toEqual({
      id: "mem_1779120000000_r1",
      workspaceId: "ws-1",
      type: "wiki",
      content: "Keep durable context outside the Git workspace.",
      source: {
        kind: "skill",
        skillSlug: "coder-studio-memory",
        sessionId: "session-1",
      },
      createdAt: now,
      updatedAt: now,
    });
    expect(broadcast).toHaveBeenCalledWith("workspace.ws-1.memory.changed", {
      workspaceId: "ws-1",
      entryId: created.id,
      action: "created",
    });
    const persistedRepo = new MemoryRepo({
      rootDir: join(tempDir, "memory", "workspaces"),
      now: () => now,
      randomId: () => `r${++random}`,
    });
    expect(persistedRepo.get("ws-1", created.id)).toEqual(created);

    const legacyTypeListResult = await dispatch(
      command("memory.list", { workspaceId: "ws-1", type: "project" }),
      ctx
    );
    expect(legacyTypeListResult.ok).toBe(true);
    expect(legacyTypeListResult.data).toEqual([created]);

    const listResult = await dispatch(command("memory.list", { workspaceId: "ws-1" }), ctx);
    expect(listResult.ok).toBe(true);
    expect(listResult.data).toEqual([created]);

    const typeSearchResult = await dispatch(
      command("memory.search", { workspaceId: "ws-1", query: "wiki" }),
      ctx
    );
    expect(typeSearchResult.ok).toBe(true);
    expect(typeSearchResult.data).toEqual([created]);

    const contentSearchResult = await dispatch(
      command("memory.search", { workspaceId: "ws-1", query: "durable" }),
      ctx
    );
    expect(contentSearchResult.ok).toBe(true);
    expect(contentSearchResult.data).toEqual([created]);

    const sourceSearchResult = await dispatch(
      command("memory.search", { workspaceId: "ws-1", query: "coder-studio-memory" }),
      ctx
    );
    expect(sourceSearchResult.ok).toBe(true);
    expect(sourceSearchResult.data).toEqual([]);

    const getResult = await dispatch(
      command("memory.get", { workspaceId: "ws-1", id: created.id }),
      ctx
    );
    expect(getResult.ok).toBe(true);
    expect(getResult.data).toEqual(created);

    now += 1000;
    const updatedResult = await dispatch(
      command("memory.update", {
        workspaceId: "ws-1",
        id: created.id,
        type: "note",
        content: "Keep one structured JSON file per workspace.",
      }),
      ctx
    );
    expect(updatedResult.ok).toBe(true);
    const updated = updatedResult.data as WorkspaceMemoryEntry;
    expect(updated).toEqual({
      id: created.id,
      workspaceId: "ws-1",
      type: "note",
      content: "Keep one structured JSON file per workspace.",
      source: {
        kind: "skill",
        skillSlug: "coder-studio-memory",
        sessionId: "session-1",
      },
      createdAt: created.createdAt,
      updatedAt: now,
    });
    expect(broadcast).toHaveBeenCalledWith("workspace.ws-1.memory.changed", {
      workspaceId: "ws-1",
      entryId: created.id,
      action: "updated",
    });

    now += 1000;
    const deleteResult = await dispatch(
      command("memory.delete", { workspaceId: "ws-1", id: created.id }),
      ctx
    );
    expect(deleteResult.ok).toBe(true);
    expect(deleteResult.data).toMatchObject({ id: created.id, archivedAt: now });
    expect(broadcast).toHaveBeenCalledWith("workspace.ws-1.memory.changed", {
      workspaceId: "ws-1",
      entryId: created.id,
      action: "deleted",
    });

    const hiddenResult = await dispatch(command("memory.list", { workspaceId: "ws-1" }), ctx);
    expect(hiddenResult.ok).toBe(true);
    expect(hiddenResult.data).toEqual([]);
  });

  it("skips unsupported legacy entries through the command layer and rewrites only new taxonomy entries", async () => {
    const workspaceId = "ws-1";
    const filePath = join(tempDir, "memory", "workspaces", `${workspaceId}.json`);
    mkdirSync(join(tempDir, "memory", "workspaces"), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          version: 1,
          workspaceId,
          entries: {
            "mem-legacy": {
              id: "mem-legacy",
              workspaceId,
              type: "decision",
              title: "Legacy title",
              content: "Legacy content to skip.",
              tags: ["legacy"],
              source: { kind: "user" },
              createdAt: 1,
              updatedAt: 1,
            },
          },
        },
        null,
        2
      ) + "\n"
    );

    const getResult = await dispatch(command("memory.get", { workspaceId, id: "mem-legacy" }), ctx);
    expect(getResult.ok).toBe(false);
    expect(getResult.error?.code).toBe("memory_not_found");

    const searchResult = await dispatch(
      command("memory.search", { workspaceId, query: "legacy" }),
      ctx
    );
    expect(searchResult.ok).toBe(true);
    expect(searchResult.data).toEqual([]);

    now += 1000;
    const projectCreateResult = await dispatch(
      command("memory.create", {
        workspaceId,
        type: "project",
        content: "Persist only project-shaped memory records.",
      }),
      ctx
    );
    expect(projectCreateResult.ok).toBe(true);
    const projectCreated = projectCreateResult.data as WorkspaceMemoryEntry;
    expect(projectCreated).toEqual({
      id: "mem_1779120001000_r1",
      workspaceId,
      type: "wiki",
      content: "Persist only project-shaped memory records.",
      source: { kind: "user" },
      createdAt: now,
      updatedAt: now,
    });

    now += 1000;
    const bugfixCreateResult = await dispatch(
      command("memory.create", {
        workspaceId,
        type: "bugfix",
        status: "pending_verification",
        content: "Persist only bugfix-shaped memory records.",
      }),
      ctx
    );
    expect(bugfixCreateResult.ok).toBe(true);
    const bugfixCreated = bugfixCreateResult.data as WorkspaceMemoryEntry;
    expect(bugfixCreated).toEqual({
      id: "mem_1779120002000_r2",
      workspaceId,
      type: "issue",
      status: "pending_verification",
      content: "Persist only bugfix-shaped memory records.",
      source: { kind: "user" },
      createdAt: now,
      updatedAt: now,
    });

    now += 1000;
    const featureCreateResult = await dispatch(
      command("memory.create", {
        workspaceId,
        type: "feature",
        content: "Persist only feature-shaped memory records.",
      }),
      ctx
    );
    expect(featureCreateResult.ok).toBe(true);
    const featureCreated = featureCreateResult.data as WorkspaceMemoryEntry;
    expect(featureCreated).toEqual({
      id: "mem_1779120003000_r3",
      workspaceId,
      type: "wiki",
      content: "Persist only feature-shaped memory records.",
      source: { kind: "user" },
      createdAt: now,
      updatedAt: now,
    });

    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({
      version: 1,
      workspaceId,
      entries: {
        [projectCreated.id]: {
          id: projectCreated.id,
          workspaceId,
          type: "wiki",
          content: "Persist only project-shaped memory records.",
          source: { kind: "user" },
          createdAt: projectCreated.createdAt,
          updatedAt: projectCreated.updatedAt,
        },
        [bugfixCreated.id]: {
          id: bugfixCreated.id,
          workspaceId,
          type: "issue",
          status: "pending_verification",
          content: "Persist only bugfix-shaped memory records.",
          source: { kind: "user" },
          createdAt: bugfixCreated.createdAt,
          updatedAt: bugfixCreated.updatedAt,
        },
        [featureCreated.id]: {
          id: featureCreated.id,
          workspaceId,
          type: "wiki",
          content: "Persist only feature-shaped memory records.",
          source: { kind: "user" },
          createdAt: featureCreated.createdAt,
          updatedAt: featureCreated.updatedAt,
        },
      },
    });
  });

  it("tracks memory statuses through create and update commands", async () => {
    const issueCreateResult = await dispatch(
      command("memory.create", {
        workspaceId: "ws-1",
        type: "issue",
        content: "Fix broken command routing.",
      }),
      ctx
    );

    expect(issueCreateResult.ok).toBe(true);
    const issue = issueCreateResult.data as WorkspaceMemoryEntry;
    expect(issue).toMatchObject({
      workspaceId: "ws-1",
      type: "issue",
      status: "not_started",
      content: "Fix broken command routing.",
    });

    const wikiCreateResult = await dispatch(
      command("memory.create", {
        workspaceId: "ws-1",
        type: "wiki",
        status: "completed",
        content: "Track command behavior in durable memory.",
      }),
      ctx
    );

    expect(wikiCreateResult.ok).toBe(true);
    expect(wikiCreateResult.data).not.toHaveProperty("status");

    now += 1000;
    const completedUpdateResult = await dispatch(
      command("memory.update", {
        workspaceId: "ws-1",
        id: issue.id,
        status: "completed",
      }),
      ctx
    );

    expect(completedUpdateResult.ok).toBe(true);
    expect(completedUpdateResult.data).toMatchObject({
      id: issue.id,
      type: "issue",
      status: "completed",
    });

    now += 1000;
    const noteUpdateResult = await dispatch(
      command("memory.update", {
        workspaceId: "ws-1",
        id: issue.id,
        type: "note",
      }),
      ctx
    );

    expect(noteUpdateResult.ok).toBe(true);
    expect(noteUpdateResult.data).toMatchObject({
      id: issue.id,
      type: "note",
    });
    expect(noteUpdateResult.data).not.toHaveProperty("status");

    now += 1000;
    const issueResetResult = await dispatch(
      command("memory.update", {
        workspaceId: "ws-1",
        id: issue.id,
        type: "issue",
      }),
      ctx
    );

    expect(issueResetResult.ok).toBe(true);
    expect(issueResetResult.data).toMatchObject({
      id: issue.id,
      type: "issue",
      status: "not_started",
    });
  });

  it("rejects invalid memory statuses during create validation", async () => {
    const result = await dispatch(
      command("memory.create", {
        workspaceId: "ws-1",
        type: "issue",
        status: "open",
        content: "Invalid status should not be accepted.",
      }),
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
  });

  it("returns workspace_not_found before touching memory storage", async () => {
    const result = await dispatch(command("memory.list", { workspaceId: "missing" }), ctx);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("workspace_not_found");
  });

  it("returns memory_storage_unavailable when the repository is not wired", async () => {
    const { memoryRepo: _repo, ...missingRepoCtx } = ctx;

    const result = await dispatch(
      command("memory.list", { workspaceId: "ws-1" }),
      missingRepoCtx as CommandContext
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("memory_storage_unavailable");
  });

  it("returns memory_not_found for unknown ids", async () => {
    const result = await dispatch(
      command("memory.get", { workspaceId: "ws-1", id: "mem_missing" }),
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("memory_not_found");
  });

  it("returns validation_error for invalid input", async () => {
    const result = await dispatch(
      command("memory.create", {
        workspaceId: "ws-1",
        type: "decision",
        content: "",
      }),
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
  });

  it("returns validation_error for legacy tag arguments", async () => {
    const createdResult = await dispatch(
      command("memory.create", {
        workspaceId: "ws-1",
        type: "project",
        content: "Keep project rules durable.",
      }),
      ctx
    );

    expect(createdResult.ok).toBe(true);
    const created = createdResult.data as WorkspaceMemoryEntry;

    const createWithTags = await dispatch(
      command("memory.create", {
        workspaceId: "ws-1",
        type: "project",
        content: "Legacy tag payload should be rejected.",
        tags: ["legacy"],
      }),
      ctx
    );
    expect(createWithTags.ok).toBe(false);
    expect(createWithTags.error?.code).toBe("validation_error");

    const updateWithTags = await dispatch(
      command("memory.update", {
        workspaceId: "ws-1",
        id: created.id,
        tags: ["legacy"],
      }),
      ctx
    );
    expect(updateWithTags.ok).toBe(false);
    expect(updateWithTags.error?.code).toBe("validation_error");

    const listWithTag = await dispatch(
      command("memory.list", {
        workspaceId: "ws-1",
        tag: "legacy",
      }),
      ctx
    );
    expect(listWithTag.ok).toBe(false);
    expect(listWithTag.error?.code).toBe("validation_error");

    const searchWithTag = await dispatch(
      command("memory.search", {
        workspaceId: "ws-1",
        query: "project",
        tag: "legacy",
      }),
      ctx
    );
    expect(searchWithTag.ok).toBe(false);
    expect(searchWithTag.error?.code).toBe("validation_error");
  });

  it("ignores unrelated unknown arguments for memory commands", async () => {
    const createdResult = await dispatch(
      command("memory.create", {
        workspaceId: "ws-1",
        type: "project",
        content: "Keep project rules durable.",
        extraField: "ignore me",
      }),
      ctx
    );

    expect(createdResult.ok).toBe(true);
    const created = createdResult.data as WorkspaceMemoryEntry;
    expect(created).toMatchObject({
      workspaceId: "ws-1",
      type: "wiki",
      content: "Keep project rules durable.",
    });

    const updateResult = await dispatch(
      command("memory.update", {
        workspaceId: "ws-1",
        id: created.id,
        content: "Keep updated project rules durable.",
        extraField: "ignore me too",
      }),
      ctx
    );

    expect(updateResult.ok).toBe(true);
    expect(updateResult.data).toMatchObject({
      id: created.id,
      content: "Keep updated project rules durable.",
    });

    const listResult = await dispatch(
      command("memory.list", {
        workspaceId: "ws-1",
        extraField: "ignore me as well",
      }),
      ctx
    );

    expect(listResult.ok).toBe(true);
    expect(listResult.data).toEqual([updateResult.data]);

    const searchResult = await dispatch(
      command("memory.search", {
        workspaceId: "ws-1",
        query: "updated",
        extraField: "still ignored",
      }),
      ctx
    );
    expect(searchResult.ok).toBe(true);
    expect(searchResult.data).toEqual([updateResult.data]);
  });
});
