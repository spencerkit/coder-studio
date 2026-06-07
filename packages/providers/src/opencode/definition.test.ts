import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { opencodeDefinition } from "./definition.js";

describe("opencodeDefinition", () => {
  it("publishes agent instructions to the official AGENTS.md file", () => {
    expect(opencodeDefinition.supportsAgentInstructions).toBe(true);
    expect(opencodeDefinition.agentInstructions?.publishTarget?.path).toBe("AGENTS.md");
  });

  it("builds a workspace-scoped CLI command", () => {
    const command = opencodeDefinition.buildCommand(
      {
        model: "gpt-oss",
        additionalArgs: ["--local"],
        envVars: { OPENCODE_TOKEN: "x" },
      },
      { sessionId: "sess-1", workspacePath: "/tmp/ws" }
    );

    expect(command).toEqual({
      argv: ["opencode", "--model", "gpt-oss", "--local"],
      env: { OPENCODE_TOKEN: "x", CODER_STUDIO_SESSION_ID: "sess-1" },
      cwd: "/tmp/ws",
    });
  });

  it("exposes debounce idle heuristics for PTY-driven state detection", () => {
    expect(opencodeDefinition.idleHeuristics).toBeDefined();
    expect(opencodeDefinition.idleHeuristics?.idlePromptPatterns).toEqual([]);
    expect(opencodeDefinition.idleHeuristics?.idleDebounceMs).toBe(4000);
  });

  it("supports skills mount through OpenCode, shared, and Claude-compatible directories", () => {
    expect(opencodeDefinition.supportsSkillsMount).toBe(true);
    expect(opencodeDefinition.skillMountDirectories).toEqual([
      join(homedir(), ".agents", "skills"),
      join(homedir(), ".config", "opencode", "skills"),
      join(homedir(), ".claude", "skills"),
    ]);
  });
});
