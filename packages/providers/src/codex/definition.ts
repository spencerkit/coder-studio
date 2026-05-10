import type { ProviderConfig, ProviderDefinition } from "@coder-studio/core";

import { type CodexConfig, codexConfigSchema } from "./config-schema.js";
import { resolveCodexTranscriptPath } from "./resolve-transcript.js";
import { idleDebounceMs, idlePromptPatterns, sessionIdPatterns } from "./stdout-heuristics.js";
import { buildCodexSupervisorEvalCommand } from "./supervisor-eval.js";

function notifyArgv(bridgeScriptPath?: string): string[] {
  if (!bridgeScriptPath) {
    return [];
  }

  return ["-c", `notify=${JSON.stringify(["node", bridgeScriptPath])}`];
}

export const codexInstallMetadata = {
  prerequisites: ["npm"],
  manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.codex.manual"],
  docUrls: {
    provider: "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
    prerequisites: {
      npm: "https://nodejs.org/en/download",
    },
  },
  strategies: {
    win32: [
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
    ],
    darwin: [
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
    ],
    linux: [
      {
        id: "npm-install-codex",
        kind: "provider",
        targetCommand: "codex",
        requiresCommands: ["npm"],
        command: "npm",
        args: ["install", "-g", "@openai/codex"],
      },
    ],
  },
} satisfies ProviderDefinition["install"];

/**
 * Codex provider definition.
 */
export const codexDefinition: ProviderDefinition = {
  // ===== Metadata =====
  id: "codex",
  displayName: "Codex",
  badge: "Codex",
  capability: "full",
  install: codexInstallMetadata,

  // ===== Command construction =====
  buildCommand(config: ProviderConfig, ctx) {
    const cfg = codexConfigSchema.parse(config);

    return {
      argv: ["codex", ...notifyArgv(ctx.bridgeScriptPath), ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },

  buildResumeCommand(config: ProviderConfig, ctx, resumeId) {
    const cfg = codexConfigSchema.parse(config);

    return {
      argv: [
        "codex",
        "resume",
        resumeId,
        ...notifyArgv(ctx.bridgeScriptPath),
        ...cfg.additionalArgs,
      ],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },

  buildSupervisorEvalCommand: buildCodexSupervisorEvalCommand,
  resolveTranscriptPath: resolveCodexTranscriptPath,

  // ===== Configuration =====
  configSchema: codexConfigSchema,
  defaultConfig: {
    additionalArgs: [],
    envVars: {},
  } satisfies CodexConfig,

  // ===== Runtime requirements =====
  requiredCommands: ["codex"],
  idleHeuristics: {
    sessionIdPatterns,
    idlePromptPatterns,
    idleDebounceMs,
  },
};
