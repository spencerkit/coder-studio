import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { geminiDefinition } from "./definition.js";

describe("geminiDefinition", () => {
  it("builds a workspace-scoped CLI command", () => {
    const command = geminiDefinition.buildCommand(
      {
        model: "gemini-2.5-pro",
        additionalArgs: ["--yolo"],
        envVars: { GEMINI_API_KEY: "x" },
      },
      { sessionId: "sess-1", workspacePath: "/tmp/ws" }
    );

    expect(command).toEqual({
      argv: ["gemini", "--model", "gemini-2.5-pro", "--yolo"],
      env: { GEMINI_API_KEY: "x", CODER_STUDIO_SESSION_ID: "sess-1" },
      cwd: "/tmp/ws",
    });
  });

  it("exposes debounce idle heuristics for PTY-driven state detection", () => {
    expect(geminiDefinition.idleHeuristics).toBeDefined();
    expect(geminiDefinition.idleHeuristics?.idlePromptPatterns).toEqual([]);
    expect(geminiDefinition.idleHeuristics?.idleDebounceMs).toBe(4000);
  });

  it("supports skills mount through Gemini and shared skill directories", () => {
    expect(geminiDefinition.supportsSkillsMount).toBe(true);
    expect(geminiDefinition.skillMountDirectories).toEqual([
      join(homedir(), ".agents", "skills"),
      join(homedir(), ".gemini", "skills"),
    ]);
  });

  it("supports agent_instructions_generate in headless mode", () => {
    expect(geminiDefinition.headless?.supportedScenarios).toEqual([
      "supervisor_eval",
      "session_analysis",
      "agent_instructions_generate",
    ]);

    expect(
      geminiDefinition.headless?.buildCommand(
        {
          model: "gemini-2.5-pro",
          additionalArgs: [],
          envVars: { GEMINI_API_KEY: "x" },
        },
        "agent_instructions_generate",
        {
          prompt: "Return JSON",
          sessionId: "sess-1",
          workspacePath: "/tmp/ws",
        }
      )
    ).not.toBeNull();
  });
});
