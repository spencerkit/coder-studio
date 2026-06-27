import type { WorkspaceIntelligenceSummary } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import { buildAgentInstructionsGenerationPrompt } from "../../agent-instructions/prompt.js";
import { AGENT_INSTRUCTIONS_RELATIVE_PATH } from "../../workspace/workspace-state.js";

describe("buildAgentInstructionsGenerationPrompt", () => {
  it("requires session activity logging instructions in generated content", () => {
    const summary: WorkspaceIntelligenceSummary = {
      workspaceId: "ws-1",
      rootPath: "/repo",
      git: {
        isRepo: true,
        branch: "main",
      },
      packageManager: "pnpm",
      frameworks: ["React"],
      scripts: {
        dev: "vite",
        test: "vitest run",
        build: undefined,
        lint: undefined,
      },
      recommendedCommands: [],
      docs: [],
      workspaceKind: "monorepo",
      agentInstructions: {
        exists: false,
        path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
      },
    };

    const prompt = buildAgentInstructionsGenerationPrompt(summary);

    expect(prompt).toContain("Under 'Workflow Expectations', include these exact bullets:");
    expect(prompt).toContain(
      "- Use the built-in `coder-studio-session-activity` skill to record meaningful session activity when plans change, important commands finish, important edits complete, or you reach a review checkpoint."
    );
  });
});
