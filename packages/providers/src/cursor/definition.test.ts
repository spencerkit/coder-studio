import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cursorDefinition } from "./definition.js";

describe("cursorDefinition", () => {
  it("builds a workspace-scoped CLI command", () => {
    const command = cursorDefinition.buildCommand(
      {
        model: "gpt-5",
        additionalArgs: ["--force"],
        envVars: { CURSOR_API_KEY: "x" },
      },
      { sessionId: "sess-1", workspacePath: "/tmp/ws" }
    );

    expect(command).toEqual({
      argv: ["agent", "--model", "gpt-5", "--force"],
      env: { CURSOR_API_KEY: "x", CODER_STUDIO_SESSION_ID: "sess-1" },
      cwd: "/tmp/ws",
    });
  });

  it("builds supervisor eval with the official agent command", () => {
    const command = cursorDefinition.headless?.buildCommand(
      {
        model: "gpt-5",
        additionalArgs: [],
        envVars: { CURSOR_API_KEY: "x" },
      },
      "supervisor_eval",
      {
        prompt: "Return JSON",
        sessionId: "sess-1",
        workspacePath: "/tmp/ws",
      }
    );

    expect(command).toMatchObject({
      argv: ["agent", "--print", "Return JSON", "--output-format", "json", "--model", "gpt-5"],
      env: { CURSOR_API_KEY: "x", CODER_STUDIO_SESSION_ID: "sess-1" },
      cwd: "/tmp/ws",
    });
  });

  it("exposes debounce idle heuristics for PTY-driven state detection", () => {
    expect(cursorDefinition.idleHeuristics).toBeDefined();
    expect(cursorDefinition.idleHeuristics?.idlePromptPatterns).toEqual([]);
    expect(cursorDefinition.idleHeuristics?.idleDebounceMs).toBe(4000);
  });

  it("supports skills mount through Cursor and shared skill directories", () => {
    expect(cursorDefinition.supportsSkillsMount).toBe(true);
    expect(cursorDefinition.skillMountDirectories).toEqual([
      join(homedir(), ".agents", "skills"),
      join(homedir(), ".cursor", "skills"),
    ]);
  });

  it("supports agent_instructions_generate in headless mode", () => {
    expect(cursorDefinition.headless?.supportedScenarios).toEqual([
      "supervisor_eval",
      "session_analysis",
      "agent_instructions_generate",
    ]);

    expect(
      cursorDefinition.headless?.buildCommand(
        {
          model: "gpt-5",
          additionalArgs: [],
          envVars: { CURSOR_API_KEY: "x" },
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
