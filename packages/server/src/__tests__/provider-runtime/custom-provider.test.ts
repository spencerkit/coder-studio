import { describe, expect, it } from "vitest";
import { buildCustomProviderDefinition } from "../../provider-runtime/custom-provider.js";

describe("buildCustomProviderDefinition", () => {
  it("builds a runtime provider with first-token command requirements and workspace cwd", () => {
    const provider = buildCustomProviderDefinition({
      id: "review-bot",
      displayName: "Review Bot",
      command: "review-bot",
      args: ["--stdio"],
      env: { REVIEW_MODE: "strict" },
      cwdMode: "workspace_root",
      sessionMode: "interactive",
      startupPrompt: "Review the diff before answering.",
      capabilities: [
        { key: "interactive_session", supported: true, label: "Interactive session" },
        { key: "review", supported: true, label: "Review" },
      ],
      createdAt: 100,
      updatedAt: 200,
    });

    expect(provider.id).toBe("review-bot");
    expect(provider.kind).toBe("custom");
    expect(provider.badge).toBe("Custom");
    expect(provider.requiredCommands).toEqual(["review-bot"]);
    expect(provider.capability).toBe("full");
    expect(
      provider.buildCommand({}, { sessionId: "sess-1", workspacePath: "/tmp/workspace" })
    ).toEqual({
      argv: ["review-bot", "--stdio"],
      cwd: "/tmp/workspace",
      env: {
        REVIEW_MODE: "strict",
        CODER_STUDIO_SESSION_ID: "sess-1",
      },
    });
  });

  it("downgrades unsupported capability when interactive session is absent", () => {
    const provider = buildCustomProviderDefinition({
      id: "batch-review",
      displayName: "Batch Review",
      command: "batch-review",
      args: [],
      env: {},
      cwdMode: "workspace_root",
      sessionMode: "interactive",
      capabilities: [{ key: "review", supported: true, label: "Review" }],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(provider.capability).toBe("unsupported");
  });
});
