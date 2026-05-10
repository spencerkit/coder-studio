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

    it("injects notify bridge arguments when bridgeScriptPath is provided", () => {
      const config: ProviderConfig = { additionalArgs: ["--flag"], envVars: {} };
      const ctx = {
        sessionId: "session-123",
        workspacePath: "/workspace",
        bridgeScriptPath: "/home/test/.coder-studio/hooks/codex-bridge.js",
      };

      const result = codexDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual([
        "codex",
        "-c",
        'notify=["node","/home/test/.coder-studio/hooks/codex-bridge.js"]',
        "--flag",
      ]);
    });

    it("keeps notify injection ahead of additional args with paths that contain spaces", () => {
      const config: ProviderConfig = { additionalArgs: ["--flag"], envVars: {} };
      const ctx = {
        sessionId: "session-123",
        workspacePath: "/workspace",
        bridgeScriptPath: "/home/with space/codex bridge.js",
      };

      const result = codexDefinition.buildCommand(config, ctx);

      expect(result.argv).toEqual([
        "codex",
        "-c",
        'notify=["node","/home/with space/codex bridge.js"]',
        "--flag",
      ]);
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

  describe("buildResumeCommand", () => {
    it("builds a resume command and retains notify bridge injection", () => {
      const config: ProviderConfig = { additionalArgs: ["--flag"], envVars: { TOKEN: "abc" } };
      const ctx = {
        sessionId: "session-123",
        workspacePath: "/workspace",
        bridgeScriptPath: "/bridge.js",
      };

      const result = codexDefinition.buildResumeCommand?.(config, ctx, "thread-uuid-1");

      expect(result).toEqual({
        argv: ["codex", "resume", "thread-uuid-1", "-c", 'notify=["node","/bridge.js"]', "--flag"],
        env: {
          TOKEN: "abc",
          CODER_STUDIO_SESSION_ID: "session-123",
        },
        cwd: "/workspace",
      });
    });

    it("omits notify injection on resume when bridgeScriptPath is missing", () => {
      const config: ProviderConfig = { additionalArgs: ["--flag"], envVars: {} };
      const ctx = {
        sessionId: "session-123",
        workspacePath: "/workspace",
      };

      const result = codexDefinition.buildResumeCommand?.(config, ctx, "thread-uuid-1");

      expect(result?.argv).toEqual(["codex", "resume", "thread-uuid-1", "--flag"]);
    });
  });

  describe("buildSupervisorEvalCommand", () => {
    it("builds a supervisor eval command with codex exec --json", () => {
      const result = codexDefinition.buildSupervisorEvalCommand?.(
        {
          additionalArgs: [],
          envVars: { OPENAI_API_KEY: "sk-openai" },
        },
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
      const result = codexDefinition.buildSupervisorEvalCommand?.(
        {
          additionalArgs: ["-c", 'model_reasoning_effort="low"'],
          envVars: {},
        },
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

    it("keeps legacy hook fields absent while exposing resume and transcript resolution", () => {
      expect("hooks" in codexDefinition).toBe(false);
      expect(codexDefinition.buildResumeCommand).toBeTypeOf("function");
      expect(codexDefinition.resolveTranscriptPath).toBeTypeOf("function");
      expect("readTranscriptExcerpt" in codexDefinition).toBe(false);
    });
  });

  describe("resolveTranscriptPath", () => {
    it("returns undefined when providerSessionId is absent", () => {
      expect(codexDefinition.resolveTranscriptPath?.({ id: "sess-1" })).toBeUndefined();
    });
  });
});
