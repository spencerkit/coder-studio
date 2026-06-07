import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderConfig } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import { claudeDefinition, claudeInstallMetadata } from "./definition.js";

describe("Claude Provider Definition", () => {
  describe("metadata", () => {
    it("should have correct id and displayName", () => {
      expect(claudeDefinition.id).toBe("claude");
      expect(claudeDefinition.displayName).toBe("Claude Code");
      expect(claudeDefinition.badge).toBe("Claude");
    });

    it("should have full capability", () => {
      expect(claudeDefinition.capability).toBe("full");
    });

    it("should require claude command", () => {
      expect(claudeDefinition.requiredCommands).toEqual(["claude"]);
    });

    it("uses the Claude skill directory as the default mount target", () => {
      expect(claudeDefinition.supportsSkillsMount).toBe(true);
      expect(claudeDefinition.skillMountDirectories).toEqual([
        join(homedir(), ".claude", "skills"),
      ]);
    });

    it("publishes agent instructions to the project-scoped Claude memory file", () => {
      expect(claudeDefinition.agentInstructions?.publishTarget?.path).toBe(".claude/CLAUDE.md");
    });

    it("should expose install metadata", () => {
      expect(claudeDefinition.install).toBe(claudeInstallMetadata);
      expect(claudeInstallMetadata.prerequisites).toEqual(["npm"]);
      expect(claudeInstallMetadata.manualGuideKeys).toEqual([
        "provider.install.nodejs.manual",
        "provider.install.claude.manual",
      ]);
      expect(claudeInstallMetadata.docUrls).toEqual({
        provider: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
        prerequisites: {
          npm: "https://nodejs.org/en/download",
        },
      });
      expect(claudeInstallMetadata.strategies.win32).toEqual([
        {
          id: "winget-nodejs-lts",
          kind: "prerequisite",
          targetCommand: "npm",
          requiresCommands: ["winget"],
          command: "winget",
          args: ["install", "--id", "OpenJS.NodeJS.LTS", "--exact", "--silent"],
        },
        {
          id: "npm-install-claude",
          kind: "provider",
          targetCommand: "claude",
          requiresCommands: ["npm"],
          command: "npm",
          args: ["install", "-g", "@anthropic-ai/claude-code"],
        },
      ]);
      expect(claudeInstallMetadata.strategies.darwin).toEqual([
        {
          id: "brew-node",
          kind: "prerequisite",
          targetCommand: "npm",
          requiresCommands: ["brew"],
          command: "brew",
          args: ["install", "node"],
        },
        {
          id: "npm-install-claude",
          kind: "provider",
          targetCommand: "claude",
          requiresCommands: ["npm"],
          command: "npm",
          args: ["install", "-g", "@anthropic-ai/claude-code"],
        },
      ]);
      expect(claudeInstallMetadata.strategies.linux).toEqual([
        {
          id: "npm-install-claude",
          kind: "provider",
          targetCommand: "claude",
          requiresCommands: ["npm"],
          command: "npm",
          args: ["install", "-g", "@anthropic-ai/claude-code"],
        },
      ]);
    });
  });

  describe("buildCommand", () => {
    it("should build basic command without a model flag when no model is configured", () => {
      const config: ProviderConfig = {};

      const ctx = {
        sessionId: "session-123",
        workspacePath: "/workspace",
      };

      const result = claudeDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual(["claude"]);
      expect(result.env.CODER_STUDIO_SESSION_ID).toBe("session-123");
      expect(result.cwd).toBe("/workspace");
    });

    it("should include additional arguments", () => {
      const config: ProviderConfig = {
        model: "claude-sonnet-4-6",
        maxTurns: null,
        additionalArgs: ["--verbose", "--debug"],
        envVars: { API_KEY: "test" },
      };

      const ctx = {
        sessionId: "session-123",
        workspacePath: "/workspace",
      };

      const result = claudeDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual([
        "claude",
        "--model",
        "claude-sonnet-4-6",
        "--verbose",
        "--debug",
      ]);
      expect(result.env.API_KEY).toBe("test");
      expect(result.env.CODER_STUDIO_SESSION_ID).toBe("session-123");
    });
  });

  describe("headless", () => {
    it("builds a supervisor eval command with claude -p --output-format json", () => {
      const result = claudeDefinition.headless?.buildCommand(
        {
          model: "claude-sonnet-4-6",
          maxTurns: null,
          additionalArgs: [],
          envVars: { ANTHROPIC_API_KEY: "sk-test" },
        },
        "supervisor_eval",
        {
          prompt: "Return strict JSON",
          sessionId: "sess-1",
          workspacePath: "/workspace",
        }
      );

      expect(result?.argv[0]).toBe("claude");
      expect(result?.argv).toContain("-p");
      // We rely on the `--output-format json` envelope to extract the model reply.
      expect(result?.argv).toEqual(expect.arrayContaining(["--output-format", "json"]));
      expect(result?.argv).toEqual(expect.arrayContaining(["--model", "claude-sonnet-4-6"]));
      expect(result?.cwd).toBe("/workspace");
      expect(result?.env?.ANTHROPIC_API_KEY).toBe("sk-test");
    });

    it("omits the model flag for supervisor eval when no model is configured", () => {
      const result = claudeDefinition.headless?.buildCommand({}, "supervisor_eval", {
        prompt: "Return strict JSON",
        sessionId: "sess-1",
        workspacePath: "/workspace",
      });

      expect(result?.argv[0]).toBe("claude");
      expect(result?.argv).not.toContain("--model");
    });

    it("exposes supervisor_eval, session_analysis, and agent_instructions_generate as headless scenarios", () => {
      expect(claudeDefinition.headless?.supportedScenarios).toEqual([
        "supervisor_eval",
        "session_analysis",
        "agent_instructions_generate",
      ]);
      expect(
        claudeDefinition.headless?.buildCommand({}, "agent_instructions_generate", {
          prompt: "Return strict JSON",
          sessionId: "sess-1",
          workspacePath: "/workspace",
        })
      ).not.toBeNull();
    });
  });

  describe("defaultConfig", () => {
    it("should not inject Claude-specific defaults", () => {
      expect(claudeDefinition.defaultConfig).toBeDefined();
      expect(claudeDefinition.defaultConfig).toEqual({});
    });
  });

  describe("idle heuristics", () => {
    it("exposes conservative idle heuristics for PTY-driven state detection", () => {
      expect(claudeDefinition.idleHeuristics).toBeDefined();
      expect(claudeDefinition.idleHeuristics?.idlePromptPatterns).toEqual([]);
      expect(claudeDefinition.idleHeuristics?.idleDebounceMs).toBe(4000);
    });

    it("does not expose legacy hooks or transcript helpers", () => {
      expect("hooks" in claudeDefinition).toBe(false);
      expect("buildResumeCommand" in claudeDefinition).toBe(false);
      expect("resolveTranscriptPath" in claudeDefinition).toBe(false);
      expect("readTranscriptExcerpt" in claudeDefinition).toBe(false);
    });
  });
});
