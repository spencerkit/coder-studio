import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepo } from "./memory-repo.js";

describe("MemoryRepo", () => {
  let tempDir: string;
  let now: number;
  let random = 0;
  let repo: MemoryRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memory-repo-"));
    now = 1779120000000;
    random = 0;
    repo = new MemoryRepo({
      rootDir: join(tempDir, "memory", "workspaces"),
      now: () => now,
      randomId: () => `r${++random}`,
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns an empty list for a missing workspace memory file", () => {
    expect(repo.list({ workspaceId: "ws-1" })).toEqual([]);
  });

  it("stores each workspace in an encoded workspace file", () => {
    const entry = repo.create({
      workspaceId: "workspace/with spaces",
      type: "wiki",
      content: "Keep memory outside the Git workspace.",
      source: { kind: "user" },
    });

    const filePath = join(
      tempDir,
      "memory",
      "workspaces",
      `${encodeURIComponent("workspace/with spaces")}.json`
    );
    expect(existsSync(filePath)).toBe(true);
    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toMatchObject({
      version: 1,
      workspaceId: "workspace/with spaces",
      entries: {
        [entry.id]: {
          workspaceId: "workspace/with spaces",
          type: "wiki",
          content: "Keep memory outside the Git workspace.",
        },
      },
    });
    expect(JSON.parse(readFileSync(filePath, "utf-8")).entries[entry.id]).not.toHaveProperty(
      "title"
    );
    expect(JSON.parse(readFileSync(filePath, "utf-8")).entries[entry.id]).not.toHaveProperty(
      "tags"
    );
  });

  it("creates and reloads entries sorted by updated time descending", () => {
    const first = repo.create({
      workspaceId: "ws-1",
      type: "wiki",
      content: "This was learned first.",
      source: { kind: "user" },
    });
    now += 1000;
    const second = repo.create({
      workspaceId: "ws-1",
      type: "todo",
      content: "This was learned second.",
      source: { kind: "agent", providerId: "codex" },
    });

    const reloaded = new MemoryRepo({
      rootDir: join(tempDir, "memory", "workspaces"),
      now: () => now,
      randomId: () => `r${++random}`,
    });

    expect(reloaded.list({ workspaceId: "ws-1" }).map((entry) => entry.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(reloaded.get("ws-1", second.id)).toMatchObject({
      type: "todo",
      source: { kind: "agent", providerId: "codex" },
    });
  });

  it("updates entries with last-write-wins semantics", () => {
    const entry = repo.create({
      workspaceId: "ws-1",
      type: "note",
      content: "Original content",
      source: { kind: "user" },
    });
    now += 2000;

    expect(
      repo.update({
        workspaceId: "ws-1",
        id: entry.id,
        type: "issue",
        content: "Updated content",
      })
    ).toEqual({
      id: entry.id,
      workspaceId: "ws-1",
      type: "issue",
      content: "Updated content",
      status: "not_started",
      source: { kind: "user" },
      createdAt: entry.createdAt,
      updatedAt: now,
    });
  });

  it("soft deletes entries and hides archived entries by default", () => {
    const entry = repo.create({
      workspaceId: "ws-1",
      type: "note",
      content: "This should be hidden.",
      source: { kind: "user" },
    });
    now += 1000;

    const archived = repo.delete("ws-1", entry.id);

    expect(archived.archivedAt).toBe(now);
    expect(repo.list({ workspaceId: "ws-1" })).toEqual([]);
    expect(repo.list({ workspaceId: "ws-1", includeArchived: true })).toEqual([archived]);
  });

  it("filters and searches only content and type case-insensitively", () => {
    const wikiEntry = repo.create({
      workspaceId: "ws-1",
      type: "wiki",
      content: "Do not dirty the Git workspace.",
      source: { kind: "user" },
    });
    repo.create({
      workspaceId: "ws-1",
      type: "todo",
      content: "Use pnpm ci:verify before handoff.",
      source: { kind: "agent" },
    });

    expect(repo.list({ workspaceId: "ws-1", query: "dirty" })).toEqual([wikiEntry]);
    expect(repo.list({ workspaceId: "ws-1", query: "todo" })).toHaveLength(1);
    expect(repo.list({ workspaceId: "ws-1", query: "agent" })).toEqual([]);
    expect(repo.list({ workspaceId: "ws-1", type: "todo" })).toHaveLength(1);
  });

  it("treats malformed legacy workspace files as empty instead of crashing", () => {
    const workspaceId = "ws-malformed-legacy";
    const filePath = join(tempDir, "memory", "workspaces", `${workspaceId}.json`);
    mkdirSync(join(tempDir, "memory", "workspaces"), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          version: 1,
          workspaceId,
          entries: null,
        },
        null,
        2
      ) + "\n"
    );

    expect(repo.list({ workspaceId })).toEqual([]);
  });

  it("skips unsupported legacy title-bearing entries that still use old types and tags", () => {
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
            "mem-1": {
              id: "mem-1",
              workspaceId,
              type: "decision",
              title: "Legacy title",
              content: "Legacy content",
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

    expect(repo.get(workspaceId, "mem-1")).toBeUndefined();
    expect(repo.list({ workspaceId })).toEqual([]);

    now += 1000;
    const created = repo.create({
      workspaceId,
      type: "wiki",
      content: "Only the new taxonomy persists.",
      source: { kind: "user" },
    });

    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({
      version: 1,
      workspaceId,
      entries: {
        [created.id]: {
          id: created.id,
          workspaceId,
          type: "wiki",
          content: "Only the new taxonomy persists.",
          source: { kind: "user" },
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  });

  it("skips invalid old-format legacy entries during normalization", () => {
    const workspaceId = "ws-invalid-legacy";
    const filePath = join(tempDir, "memory", "workspaces", `${workspaceId}.json`);
    mkdirSync(join(tempDir, "memory", "workspaces"), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          version: 1,
          workspaceId,
          entries: {
            valid: {
              id: "valid",
              workspaceId,
              type: "decision",
              title: "Valid legacy title",
              content: "Valid legacy content",
              tags: ["valid"],
              source: { kind: "user" },
              createdAt: 1,
              updatedAt: 1,
            },
            invalid: {
              id: "invalid",
              workspaceId,
              type: "decision",
              title: "Invalid legacy title",
              content: 123,
              tags: ["invalid"],
              source: { kind: "user" },
              createdAt: 2,
              updatedAt: 2,
            },
          },
        },
        null,
        2
      ) + "\n"
    );

    expect(repo.list({ workspaceId })).toEqual([]);
  });

  it("normalizes legacy stored aliases and returns entries sorted by updated time descending", () => {
    const workspaceId = "ws-legacy-aliases";
    const filePath = join(tempDir, "memory", "workspaces", `${workspaceId}.json`);
    mkdirSync(join(tempDir, "memory", "workspaces"), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          version: 1,
          workspaceId,
          entries: {
            project: {
              id: "project",
              workspaceId,
              type: "project",
              content: "Legacy project memory.",
              source: { kind: "user" },
              createdAt: 1,
              updatedAt: 1,
            },
            bugfix: {
              id: "bugfix",
              workspaceId,
              type: "bugfix",
              content: "Legacy bugfix memory.",
              source: { kind: "agent" },
              createdAt: 2,
              updatedAt: 3,
            },
            feature: {
              id: "feature",
              workspaceId,
              type: "feature",
              content: "Legacy feature memory.",
              source: { kind: "skill" },
              createdAt: 3,
              updatedAt: 2,
            },
          },
        },
        null,
        2
      ) + "\n"
    );

    expect(
      repo.list({ workspaceId }).map((entry) => ({
        id: entry.id,
        type: entry.type,
        status: entry.status,
      }))
    ).toEqual([
      { id: "bugfix", type: "issue", status: "not_started" },
      { id: "feature", type: "wiki", status: undefined },
      { id: "project", type: "wiki", status: undefined },
    ]);
  });

  it("keeps entries with invalid stored statuses during normalization", () => {
    const workspaceId = "ws-invalid-stored-statuses";
    const filePath = join(tempDir, "memory", "workspaces", `${workspaceId}.json`);
    mkdirSync(join(tempDir, "memory", "workspaces"), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          version: 1,
          workspaceId,
          entries: {
            issue: {
              id: "issue",
              workspaceId,
              type: "issue",
              status: "open",
              content: "Discard the invalid actionable status.",
              source: { kind: "user" },
              createdAt: 1,
              updatedAt: 2,
            },
            project: {
              id: "project",
              workspaceId,
              type: "project",
              status: "open",
              content: "Discard the invalid alias status.",
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

    expect(
      repo.list({ workspaceId }).map((entry) => ({
        id: entry.id,
        type: entry.type,
        status: entry.status,
      }))
    ).toEqual([
      { id: "issue", type: "issue", status: "not_started" },
      { id: "project", type: "wiki", status: undefined },
    ]);
  });

  it("persists supplied status for actionable entries", () => {
    const entry = repo.create({
      workspaceId: "ws-1",
      type: "issue",
      status: "in_progress",
      content: "Fix broken command routing.",
      source: { kind: "user" },
    });
    const filePath = join(tempDir, "memory", "workspaces", "ws-1.json");

    expect(entry.status).toBe("in_progress");
    expect(JSON.parse(readFileSync(filePath, "utf-8")).entries[entry.id]).toMatchObject({
      type: "issue",
      status: "in_progress",
    });
  });

  it("defaults missing status for actionable entries", () => {
    const entry = repo.create({
      workspaceId: "ws-1",
      type: "todo",
      content: "Run focused verification.",
      source: { kind: "user" },
    });

    expect(entry.status).toBe("not_started");
  });

  it("omits status for non-actionable entries even when supplied", () => {
    const entry = repo.create({
      workspaceId: "ws-1",
      type: "wiki",
      status: "completed",
      content: "Use pnpm for project scripts.",
      source: { kind: "user" },
    });

    expect(entry).not.toHaveProperty("status");
  });

  it("removes stale status when updating an actionable entry to a non-actionable type", () => {
    const entry = repo.create({
      workspaceId: "ws-1",
      type: "issue",
      status: "in_progress",
      content: "Fix stale status.",
      source: { kind: "user" },
    });
    now += 1000;

    const updated = repo.update({
      workspaceId: "ws-1",
      id: entry.id,
      type: "note",
    });

    expect(updated).toMatchObject({
      id: entry.id,
      type: "note",
      content: "Fix stale status.",
    });
    expect(updated).not.toHaveProperty("status");
  });

  it("defaults or uses supplied status when updating a non-actionable entry to an actionable type", () => {
    const defaulted = repo.create({
      workspaceId: "ws-1",
      type: "note",
      content: "Track without explicit status.",
      source: { kind: "user" },
    });
    const supplied = repo.create({
      workspaceId: "ws-1",
      type: "wiki",
      content: "Track with explicit status.",
      source: { kind: "user" },
    });
    now += 1000;

    expect(
      repo.update({
        workspaceId: "ws-1",
        id: defaulted.id,
        type: "issue",
      }).status
    ).toBe("not_started");
    expect(
      repo.update({
        workspaceId: "ws-1",
        id: supplied.id,
        type: "todo",
        status: "pending_verification",
      }).status
    ).toBe("pending_verification");
  });

  it("normalizes stored statuses while reading legacy entries", () => {
    const workspaceId = "ws-legacy-statuses";
    const filePath = join(tempDir, "memory", "workspaces", `${workspaceId}.json`);
    mkdirSync(join(tempDir, "memory", "workspaces"), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          version: 1,
          workspaceId,
          entries: {
            valid: {
              id: "valid",
              workspaceId,
              type: "issue",
              status: "in_progress",
              content: "Preserve this status.",
              source: { kind: "user" },
              createdAt: 1,
              updatedAt: 4,
            },
            missing: {
              id: "missing",
              workspaceId,
              type: "todo",
              content: "Default this status.",
              source: { kind: "user" },
              createdAt: 1,
              updatedAt: 3,
            },
            stale: {
              id: "stale",
              workspaceId,
              type: "note",
              status: "completed",
              content: "Clear this stale status.",
              source: { kind: "user" },
              createdAt: 1,
              updatedAt: 2,
            },
          },
        },
        null,
        2
      ) + "\n"
    );

    expect(
      repo.list({ workspaceId }).map((entry) => ({
        id: entry.id,
        type: entry.type,
        status: entry.status,
      }))
    ).toEqual([
      { id: "valid", type: "issue", status: "in_progress" },
      { id: "missing", type: "todo", status: "not_started" },
      { id: "stale", type: "note", status: undefined },
    ]);
  });

  it("removes a workspace memory file", () => {
    repo.create({
      workspaceId: "ws-1",
      type: "note",
      content: "This should be removed with the workspace memory file.",
      source: { kind: "user" },
    });
    const filePath = join(tempDir, "memory", "workspaces", "ws-1.json");

    repo.removeWorkspace("ws-1");

    expect(existsSync(filePath)).toBe(false);
    expect(repo.list({ workspaceId: "ws-1" })).toEqual([]);
  });
});
