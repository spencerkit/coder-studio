import { describe, expect, it } from "vitest";
import {
  isActionableWorkspaceMemoryType,
  normalizeWorkspaceMemoryStatus,
  normalizeWorkspaceMemoryType,
  resolveWorkspaceMemorySource,
  validateWorkspaceMemoryInput,
  WORKSPACE_MEMORY_SOURCE_KINDS,
  WORKSPACE_MEMORY_STATUSES,
  WORKSPACE_MEMORY_TYPES,
} from "./memory.js";

describe("workspace memory domain", () => {
  it("exports stable memory types, statuses, and source kinds", () => {
    expect(WORKSPACE_MEMORY_TYPES).toEqual(["wiki", "issue", "todo", "note"]);
    expect(WORKSPACE_MEMORY_STATUSES).toEqual([
      "not_started",
      "in_progress",
      "pending_verification",
      "completed",
    ]);
    expect(WORKSPACE_MEMORY_SOURCE_KINDS).toEqual(["user", "agent", "skill"]);
  });

  it("normalizes legacy memory types into the canonical taxonomy", () => {
    expect(normalizeWorkspaceMemoryType("project")).toBe("wiki");
    expect(normalizeWorkspaceMemoryType("bugfix")).toBe("issue");
    expect(normalizeWorkspaceMemoryType("feature")).toBe("wiki");
    expect(normalizeWorkspaceMemoryType("todo")).toBe("todo");
    expect(normalizeWorkspaceMemoryType("unknown")).toBeUndefined();
    expect(normalizeWorkspaceMemoryType("toString")).toBeUndefined();
  });

  it("detects actionable memory types", () => {
    expect(isActionableWorkspaceMemoryType("wiki")).toBe(false);
    expect(isActionableWorkspaceMemoryType("issue")).toBe(true);
  });

  it("normalizes canonical memory statuses", () => {
    expect(normalizeWorkspaceMemoryStatus("in_progress")).toBe("in_progress");
    expect(normalizeWorkspaceMemoryStatus("unknown")).toBeUndefined();
  });

  it("normalizes trimmed content", () => {
    expect(
      validateWorkspaceMemoryInput({
        type: "project",
        content: "  Use pnpm for package scripts.  ",
      })
    ).toEqual({
      type: "wiki",
      content: "Use pnpm for package scripts.",
    });
  });

  it("validates canonical and legacy memory inputs with actionable statuses", () => {
    expect(
      validateWorkspaceMemoryInput({
        type: "issue",
        content: "Broken",
        status: "in_progress",
      })
    ).toEqual({
      type: "issue",
      content: "Broken",
      status: "in_progress",
    });
    expect(
      validateWorkspaceMemoryInput({
        type: "todo",
        content: "Ship",
        status: undefined,
      })
    ).toEqual({
      type: "todo",
      content: "Ship",
      status: "not_started",
    });
    expect(
      validateWorkspaceMemoryInput({
        type: "wiki",
        content: "Use pnpm",
        status: "completed",
      })
    ).toEqual({
      type: "wiki",
      content: "Use pnpm",
    });
    expect(
      validateWorkspaceMemoryInput({
        type: "bugfix",
        content: "Old",
        status: "completed",
      })
    ).toEqual({
      type: "issue",
      content: "Old",
      status: "completed",
    });
    expect(() =>
      validateWorkspaceMemoryInput({
        type: "issue",
        content: "Broken",
        status: "unknown",
      })
    ).toThrow("Invalid memory status");
    expect(() =>
      validateWorkspaceMemoryInput({
        type: "wiki",
        content: "Use pnpm",
        status: "unknown",
      })
    ).toThrow("Invalid memory status");
  });

  it("ignores stale tags payloads and returns a tag-free validated result", () => {
    const validated = validateWorkspaceMemoryInput({
      type: "project",
      content: "  Keep pnpm scripts centralized.  ",
      tags: ["legacy", "callers"],
    } as Parameters<typeof validateWorkspaceMemoryInput>[0] & { tags: string[] });

    expect(validated).toEqual({
      type: "wiki",
      content: "Keep pnpm scripts centralized.",
    });
    expect(validated).not.toHaveProperty("tags");
  });

  it("rejects invalid memory inputs", () => {
    expect(() =>
      validateWorkspaceMemoryInput({
        type: "unknown",
        content: "Content",
      })
    ).toThrow("Invalid memory type");
    expect(() =>
      validateWorkspaceMemoryInput({
        type: "toString",
        content: "x",
      })
    ).toThrow("Invalid memory type");
    expect(() =>
      validateWorkspaceMemoryInput({
        type: "note",
        content: "",
      })
    ).toThrow("Memory content is required");
    expect(() =>
      validateWorkspaceMemoryInput({
        type: "note",
        content: "  \n\t  ",
      })
    ).toThrow("Memory content is required");
    expect(() =>
      validateWorkspaceMemoryInput({
        type: "note",
        content: 123,
      })
    ).toThrow("Memory content is required");
  });

  it("accepts long content after trimming", () => {
    const longContent = `  ${"x".repeat(20_001)}  `;

    expect(
      validateWorkspaceMemoryInput({
        type: "note",
        content: longContent,
      })
    ).toEqual({
      type: "note",
      content: "x".repeat(20_001),
    });
  });

  it("resolves source metadata with safe defaults", () => {
    expect(resolveWorkspaceMemorySource({})).toEqual({ kind: "user" });
    expect(resolveWorkspaceMemorySource({ defaultKind: "agent", providerId: "codex" })).toEqual({
      kind: "agent",
      providerId: "codex",
    });
    expect(
      resolveWorkspaceMemorySource({
        defaultKind: "agent",
        kind: "skill",
        sessionId: "sess-1",
        skillSlug: "coder-studio-memory",
      })
    ).toEqual({
      kind: "skill",
      sessionId: "sess-1",
      skillSlug: "coder-studio-memory",
    });
  });
});
