import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AgentContextKind,
  CustomProviderSessionMode,
  GitCommitDetail,
  GitCommitFileEntry,
  GitDiffRenderMode,
  GitFileDiffPayload,
  SessionState,
} from "./types";
import { deriveSessionTitle, SESSION_TITLE_MAX_LENGTH } from "./types";

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
    expectTypeOf<GitCommitFileEntry["status"]>().toEqualTypeOf<
      "added" | "modified" | "deleted" | "renamed"
    >();
    expectTypeOf<GitCommitDetail["commit"]["parentSha"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<GitCommitDetail["files"][number]["renderAs"]>().toEqualTypeOf<"text" | "image">();
    expectTypeOf<GitFileDiffPayload["originalRevision"]>().toEqualTypeOf<string | undefined>();
  });
});
