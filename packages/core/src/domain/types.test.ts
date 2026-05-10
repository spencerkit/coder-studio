import { describe, expect, expectTypeOf, it } from "vitest";
import type { ProviderDefinition } from "../provider/definition";
import type { Session, SessionState } from "./types";
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

describe("notify-hook groundwork types", () => {
  it("allows sessions to carry an optional transcript path", () => {
    expectTypeOf<Session>().toMatchTypeOf<{
      transcriptPath?: string;
    }>();
  });

  it("allows provider definitions to opt into future resume and transcript helpers", () => {
    expectTypeOf<ProviderDefinition>().toMatchTypeOf<{
      buildResumeCommand?: (
        config: unknown,
        ctx: { sessionId: string; workspacePath: string; bridgeScriptPath?: string },
        resumeId: string
      ) => {
        argv: string[];
        env: Record<string, string>;
        cwd: string;
      };
      resolveTranscriptPath?: (session: {
        id: string;
        transcriptPath?: string;
        providerSessionId?: string;
      }) => Promise<string | undefined> | string | undefined;
    }>();
  });
});
