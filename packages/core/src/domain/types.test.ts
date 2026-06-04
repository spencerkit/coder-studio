import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AgentContextKind,
  CustomProviderSessionMode,
  GitCommitDetail,
  GitCommitFileEntry,
  GitDiffHunk,
  GitDiffRenderMode,
  GitFileDiffPayload,
  GitHunkOperation,
  GitRevisionSource,
  SessionState,
  TaskDefinition,
  TaskRun,
  Terminal,
  TerminalKind,
  WorkspaceHistoryEntry,
} from "./types";
import { deriveSessionTitle, normalizeSessionTitleInput, SESSION_TITLE_MAX_LENGTH } from "./types";

describe("deriveSessionTitle", () => {
  it("returns undefined for empty/whitespace-only input", () => {
    expect(deriveSessionTitle("")).toBeUndefined();
    expect(deriveSessionTitle("   ")).toBeUndefined();
    expect(deriveSessionTitle("\n\t\r ")).toBeUndefined();
  });

  it("returns trimmed text unchanged when it fits", () => {
    expect(deriveSessionTitle("hi")).toBe("hi");
    expect(deriveSessionTitle("  hello  ")).toBe("hello");
    expect(deriveSessionTitle("run test")).toBe("run test");
  });

  it("collapses internal whitespace runs to single spaces", () => {
    expect(deriveSessionTitle("a  b")).toBe("a b");
    expect(deriveSessionTitle("a\nb\tc")).toBe("a b c");
  });

  it("truncates with an ellipsis when longer than the budget", () => {
    const input = "this is definitely much longer than ten chars";
    const result = deriveSessionTitle(input)!;
    expect(result.length).toBeLessThanOrEqual(SESSION_TITLE_MAX_LENGTH);
    expect(result.endsWith("…")).toBe(true);
    expect(result).toBe("this is d…");
  });

  it("keeps exact-length input untouched", () => {
    const exact = "abcdefghij"; // 10 chars
    expect(exact).toHaveLength(SESSION_TITLE_MAX_LENGTH);
    expect(deriveSessionTitle(exact)).toBe(exact);
  });
});

describe("normalizeSessionTitleInput", () => {
  it("returns the full normalized submitted input without truncating it", () => {
    expect(normalizeSessionTitleInput("  hello   world this is a test\n")).toBe(
      "hello world this is a test"
    );
  });

  it("returns undefined for whitespace-only input", () => {
    expect(normalizeSessionTitleInput("\n\t  ")).toBeUndefined();
  });
});

describe("SessionState", () => {
  it("only allows the PTY-driven lifecycle states", () => {
    expectTypeOf<SessionState>().toEqualTypeOf<
      "draft" | "starting" | "running" | "idle" | "ended"
    >();
  });
});

describe("CustomProviderSessionMode", () => {
  it("currently only allows interactive PTY-backed custom providers", () => {
    expectTypeOf<CustomProviderSessionMode>().toEqualTypeOf<"interactive">();
  });
});

describe("WorkspaceHistoryEntry", () => {
  it("captures path-based recent workspace metadata", () => {
    expectTypeOf<WorkspaceHistoryEntry>().toEqualTypeOf<{
      path: string;
      name: string;
      lastOpenedAt: number;
    }>();
  });
});

describe("AgentContextKind", () => {
  it("covers the backend context package variants", () => {
    expectTypeOf<AgentContextKind>().toEqualTypeOf<
      "file" | "selection" | "git_diff" | "terminal_output" | "project_summary" | "session_review"
    >();
  });
});

describe("Git history diff contracts", () => {
  it("covers structured commit detail and diff payload types", () => {
    expectTypeOf<GitDiffRenderMode>().toEqualTypeOf<"text" | "image">();
    expectTypeOf<GitRevisionSource>().toEqualTypeOf<string>();
    expectTypeOf<GitCommitFileEntry["status"]>().toEqualTypeOf<
      "added" | "modified" | "deleted" | "renamed"
    >();
    expectTypeOf<GitCommitDetail["commit"]["parentSha"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<GitCommitDetail["files"][number]["renderAs"]>().toEqualTypeOf<"text" | "image">();
    expectTypeOf<GitFileDiffPayload["originalRevision"]>().toEqualTypeOf<string | undefined>();
  });
});

describe("Task contracts", () => {
  it("defines managed workspace task definitions", () => {
    expectTypeOf<TaskDefinition>().toEqualTypeOf<{
      id: string;
      workspaceId: string;
      kind: "verify" | "test" | "lint" | "build" | "dev" | "custom";
      label: string;
      command: string;
      args: string[];
      cwdPath?: string;
      source:
        | "coder-studio"
        | "package-json"
        | "pnpm-workspace"
        | "cargo"
        | "go"
        | "python"
        | "makefile"
        | "inferred";
      priority: number;
    }>();
  });

  it("defines managed task run state", () => {
    expectTypeOf<TaskRun>().toEqualTypeOf<{
      id: string;
      workspaceId: string;
      taskId: string;
      terminalId: string;
      status: "queued" | "running" | "passed" | "failed" | "stopped";
      command: string;
      args: string[];
      cwdPath?: string;
      startedAt: number;
      finishedAt?: number;
      exitCode?: number;
      summary?: {
        tailLines: string[];
      };
    }>();
  });

  it("allows task terminals as managed terminal DTOs", () => {
    expectTypeOf<TerminalKind>().toEqualTypeOf<"agent" | "shell" | "task">();
    expectTypeOf<Terminal["kind"]>().toEqualTypeOf<TerminalKind>();
  });
});

describe("Git hunk contracts", () => {
  it("defines hunk descriptors returned by diff payloads", () => {
    expectTypeOf<GitDiffHunk>().toEqualTypeOf<{
      id: string;
      header: string;
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      patch: string;
      lines: string[];
    }>();
    expectTypeOf<GitFileDiffPayload["hunks"]>().toEqualTypeOf<GitDiffHunk[] | undefined>();
  });

  it("defines server-validated hunk operations", () => {
    expectTypeOf<GitHunkOperation>().toEqualTypeOf<{
      workspaceId: string;
      path: string;
      staged: boolean;
      hunkId: string;
      operation: "stage" | "unstage" | "discard";
    }>();
  });
});
