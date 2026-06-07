import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderConfig } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import { codexDefinition, codexInstallMetadata } from "./definition.js";

describe("Codex Provider Definition", () => {
  describe("metadata", () => {
    it("should have correct id and displayName", () => {
      expect(codexDefinition.id).toBe("codex");
      expect(codexDefinition.displayName).toBe("Codex");
      expect(codexDefinition.badge).toBe("Codex");
    });

    it("should have full capability", () => {
      expect(codexDefinition.capability).toBe("full");
    });

    it("should require codex command", () => {
      expect(codexDefinition.requiredCommands).toEqual(["codex"]);
    });

    it("uses the shared skill directory as the default mount target", () => {
      expect(codexDefinition.supportsSkillsMount).toBe(true);
      expect(codexDefinition.skillMountDirectories).toEqual([
        join(homedir(), ".agents", "skills"),
        join(homedir(), ".codex", "skills"),
      ]);
    });

    it("publishes agent instructions to the official AGENTS.md file", () => {
      expect(codexDefinition.agentInstructions?.publishTarget?.path).toBe("AGENTS.md");
    });

    it("should expose install metadata", () => {
      expect(codexDefinition.install).toBe(codexInstallMetadata);
      expect(codexInstallMetadata.prerequisites).toEqual(["npm"]);
      expect(codexInstallMetadata.manualGuideKeys).toEqual([
        "provider.install.nodejs.manual",
        "provider.install.codex.manual",
      ]);
      expect(codexInstallMetadata.docUrls).toEqual({
        provider: "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
        prerequisites: {
          npm: "https://nodejs.org/en/download",
        },
      });
      expect(codexInstallMetadata.strategies.win32).toEqual([
        {
          id: "winget-nodejs-lts",
          kind: "prerequisite",
          targetCommand: "npm",
          requiresCommands: ["winget"],
          command: "winget",
          args: ["install", "--id", "OpenJS.NodeJS.LTS", "--exact", "--silent"],
        },
        {
          id: "npm-install-codex",
          kind: "provider",
          targetCommand: "codex",
          requiresCommands: ["npm"],
          command: "npm",
          args: ["install", "-g", "@openai/codex"],
        },
      ]);
      expect(codexInstallMetadata.strategies.darwin).toEqual([
        {
          id: "brew-node",
          kind: "prerequisite",
          targetCommand: "npm",
          requiresCommands: ["brew"],
          command: "brew",
          args: ["install", "node"],
        },
        {
          id: "npm-install-codex",
          kind: "provider",
          targetCommand: "codex",
          requiresCommands: ["npm"],
          command: "npm",
          args: ["install", "-g", "@openai/codex"],
        },
      ]);
      expect(codexInstallMetadata.strategies.linux).toEqual([
        {
          id: "npm-install-codex",
          kind: "provider",
          targetCommand: "codex",
          requiresCommands: ["npm"],
          command: "npm",
          args: ["install", "-g", "@openai/codex"],
        },
      ]);
    });
  });

  describe("buildCommand", () => {
    it("should build basic command", () => {
      const config: ProviderConfig = {
        additionalArgs: [],
        envVars: {},
      };

      const ctx = {
        sessionId: "session-123",
        workspacePath: "/workspace",
      };

      const result = codexDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual(["codex"]);
      expect(result.env.CODER_STUDIO_SESSION_ID).toBe("session-123");
      expect(result.cwd).toBe("/workspace");
    });

    it("does not inject hook bridge arguments into the codex command", () => {
      const config: ProviderConfig = { additionalArgs: [], envVars: {} };
      const ctx = {
        sessionId: "session-123",
        workspacePath: "/workspace",
      };

      const result = codexDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual(["codex"]);
      expect(result.argv).not.toContain("-c");
      expect(result.argv.some((a: string) => a.startsWith("notify="))).toBe(false);
    });

    it("should include additional arguments and env vars", () => {
      const config: ProviderConfig = {
        additionalArgs: ["--flag"],
        envVars: { TOKEN: "abc" },
      };

      const ctx = {
        sessionId: "session-123",
        workspacePath: "/workspace",
      };

      const result = codexDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual(["codex", "--flag"]);
      expect(result.env.TOKEN).toBe("abc");
      expect(result.env.CODER_STUDIO_SESSION_ID).toBe("session-123");
    });
  });

  describe("headless", () => {
    it("builds a supervisor eval command with codex exec --json", () => {
      const result = codexDefinition.headless?.buildCommand(
        {
          additionalArgs: [],
          envVars: { OPENAI_API_KEY: "sk-openai" },
        },
        "supervisor_eval",
        {
          prompt: "Return strict JSON",
          sessionId: "sess-1",
          workspacePath: "/workspace",
        }
      );

      expect(result?.argv.slice(0, 2)).toEqual(["codex", "exec"]);
      // --json produces a JSONL event stream we can actually parse.
      expect(result?.argv).toContain("--json");
      // Evaluations must never mutate the workspace.
      expect(result?.argv).toEqual(expect.arrayContaining(["-s", "read-only"]));
      // Don't choke when the evaluator is pointed at a non-git dir.
      expect(result?.argv).toContain("--skip-git-repo-check");
      // The prompt is the last argv entry so it's treated as the positional prompt.
      expect(result?.argv[result.argv.length - 1]).toBe("Return strict JSON");
      expect(result?.cwd).toBe("/workspace");
      expect(result?.env?.OPENAI_API_KEY).toBe("sk-openai");
    });

    it("places additionalArgs before the prompt positional", () => {
      const result = codexDefinition.headless?.buildCommand(
        {
          additionalArgs: ["-c", 'model_reasoning_effort="low"'],
          envVars: {},
        },
        "supervisor_eval",
        {
          prompt: "Return strict JSON",
          sessionId: "sess-1",
          workspacePath: "/workspace",
        }
      );

      const argv = result?.argv ?? [];
      const configIdx = argv.indexOf("-c");
      const promptIdx = argv.indexOf("Return strict JSON");
      expect(configIdx).toBeGreaterThan(-1);
      expect(promptIdx).toBe(argv.length - 1);
      expect(configIdx).toBeLessThan(promptIdx);
    });

    it("passes the model override through to codex exec", () => {
      const result = codexDefinition.headless?.buildCommand(
        {
          model: "gpt-4.1",
          additionalArgs: [],
          envVars: {},
        },
        "supervisor_eval",
        {
          prompt: "Return strict JSON",
          sessionId: "sess-1",
          workspacePath: "/workspace",
          model: "o3",
        }
      );

      expect(result?.argv).toEqual(expect.arrayContaining(["-m", "o3"]));
    });

    it("supports supervisor and agent-instructions headless scenarios", () => {
      expect(codexDefinition.headless?.supportedScenarios).toEqual([
        "supervisor_eval",
        "agent_instructions_generate",
        "session_analysis",
      ]);
    });

    it("builds a headless codex exec command for agent instructions generation", () => {
      const result = codexDefinition.headless!.buildCommand(
        {
          additionalArgs: ["-c", 'model_reasoning_effort="low"'],
          envVars: { CODEX_ENV: "1" },
        },
        "agent_instructions_generate",
        {
          prompt: "Generate agent instructions",
          sessionId: "sess-1",
          workspacePath: "/workspace",
        }
      );

      expect(result.argv).toEqual([
        "codex",
        "exec",
        "--json",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "-c",
        'model_reasoning_effort="low"',
        "Generate agent instructions",
      ]);
      expect(result.cwd).toBe("/workspace");
      expect(result.env).toEqual({
        CODEX_ENV: "1",
        CODER_STUDIO_SESSION_ID: "sess-1",
      });
    });

    it("passes through optional model and api key", () => {
      const result = codexDefinition.headless!.buildCommand(
        {
          additionalArgs: [],
          envVars: {},
        },
        "agent_instructions_generate",
        {
          prompt: "Generate agent instructions",
          sessionId: "sess-1",
          workspacePath: "/workspace",
          model: "o3",
          apiKey: "sk-openai",
        }
      );

      expect(result.argv).toEqual([
        "codex",
        "exec",
        "--json",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "-m",
        "o3",
        "Generate agent instructions",
      ]);
      expect(result.env).toEqual({
        OPENAI_API_KEY: "sk-openai",
        CODER_STUDIO_SESSION_ID: "sess-1",
      });
    });

    it("reuses the same transport assembly as supervisor eval", () => {
      const config: ProviderConfig = {
        additionalArgs: ["-c", 'model_reasoning_effort="low"'],
        envVars: { CODEX_ENV: "1" },
      };
      const req = {
        prompt: "Generate agent instructions",
        sessionId: "sess-1",
        workspacePath: "/workspace",
        model: "o3",
        apiKey: "sk-openai",
      };

      expect(
        codexDefinition.headless!.buildCommand(config, "agent_instructions_generate", req)
      ).toEqual(codexDefinition.headless?.buildCommand(config, "supervisor_eval", req));
    });

    it("returns null for unsupported headless scenarios", () => {
      expect(
        codexDefinition.headless?.buildCommand(
          { additionalArgs: [], envVars: {} },
          "unsupported_headless_scenario" as never,
          {
            prompt: "ignored",
            sessionId: "sess-1",
            workspacePath: "/workspace",
          }
        )
      ).toBeNull();
    });
  });

  describe("defaultConfig", () => {
    it("should have valid default config", () => {
      expect(codexDefinition.defaultConfig).toBeDefined();
      expect(codexDefinition.defaultConfig.additionalArgs).toEqual([]);
      expect(codexDefinition.defaultConfig.envVars).toEqual({});
    });
  });

  describe("idle heuristics", () => {
    it("exposes idle heuristics for PTY-driven state detection", () => {
      expect(codexDefinition.idleHeuristics).toBeDefined();
      expect(codexDefinition.idleHeuristics?.sessionIdPatterns).toBeDefined();
      expect(codexDefinition.idleHeuristics?.idlePromptPatterns).toBeDefined();
      expect(codexDefinition.idleHeuristics?.idleDebounceMs).toBe(3000);
    });

    it("does not expose legacy hooks or transcript helpers", () => {
      expect("hooks" in codexDefinition).toBe(false);
      expect("buildResumeCommand" in codexDefinition).toBe(false);
      expect("resolveTranscriptPath" in codexDefinition).toBe(false);
      expect("readTranscriptExcerpt" in codexDefinition).toBe(false);
    });
  });
});
