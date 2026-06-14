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
      type: "project",
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
          type: "project",
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
      type: "project",
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
        type: "bugfix",
        content: "Updated content",
      })
    ).toEqual({
      id: entry.id,
      workspaceId: "ws-1",
      type: "bugfix",
      content: "Updated content",
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
    const projectEntry = repo.create({
      workspaceId: "ws-1",
      type: "project",
      content: "Do not dirty the Git workspace.",
      source: { kind: "user" },
    });
    repo.create({
      workspaceId: "ws-1",
      type: "todo",
      content: "Use pnpm ci:verify before handoff.",
      source: { kind: "agent" },
    });

    expect(repo.list({ workspaceId: "ws-1", query: "dirty" })).toEqual([projectEntry]);
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
      type: "project",
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
          type: "project",
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
