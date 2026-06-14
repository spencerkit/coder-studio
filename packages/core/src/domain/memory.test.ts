import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceMemorySource,
  validateWorkspaceMemoryInput,
  WORKSPACE_MEMORY_SOURCE_KINDS,
  WORKSPACE_MEMORY_TYPES,
} from "./memory.js";

describe("workspace memory domain", () => {
  it("exports stable memory types and source kinds", () => {
    expect(WORKSPACE_MEMORY_TYPES).toEqual(["feature", "todo", "bugfix", "project", "note"]);
    expect(WORKSPACE_MEMORY_SOURCE_KINDS).toEqual(["user", "agent", "skill"]);
  });

  it("normalizes trimmed content", () => {
    expect(
      validateWorkspaceMemoryInput({
        type: "project",
        content: "  Use pnpm for package scripts.  ",
      })
    ).toEqual({
      type: "project",
      content: "Use pnpm for package scripts.",
    });
  });

  it("ignores stale tags payloads and returns a tag-free validated result", () => {
    const validated = validateWorkspaceMemoryInput({
      type: "project",
      content: "  Keep pnpm scripts centralized.  ",
      tags: ["legacy", "callers"],
    } as Parameters<typeof validateWorkspaceMemoryInput>[0] & { tags: string[] });

    expect(validated).toEqual({
      type: "project",
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
