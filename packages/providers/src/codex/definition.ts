import type { ProviderConfig, ProviderDefinition } from "@coder-studio/core";

import { sharedFirstSkillMountDirectories } from "../skills/directories.js";
import { type CodexConfig, codexConfigSchema } from "./config-schema.js";
import { codexHeadlessDefinition } from "./headless.js";
import { idleDebounceMs, idlePromptPatterns, sessionIdPatterns } from "./stdout-heuristics.js";

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
  kind: "built_in",
  capability: "full",
  capabilities: [
    { key: "interactive_session", supported: true, label: "Interactive session" },
    { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
    { key: "idle_detection", supported: true, label: "Idle detection" },
    { key: "context_attach", supported: false, label: "Context attach" },
    { key: "review", supported: false, label: "Review" },
  ],
  install: codexInstallMetadata,
  supportsSkillsMount: true,
  skillMountDirectories: sharedFirstSkillMountDirectories(".codex"),

  // ===== Command construction =====
  buildCommand(config: ProviderConfig, ctx) {
    const cfg = codexConfigSchema.parse(config);

    return {
      argv: ["codex", ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },

  // ===== Configuration =====
  configSchema: codexConfigSchema,
  defaultConfig: {
    additionalArgs: [],
    envVars: {},
  } satisfies CodexConfig,

  // ===== Runtime requirements =====
  requiredCommands: ["codex"],
  agentInstructions: {
    publishTarget: {
      path: "AGENTS.md",
    },
  },
  headless: codexHeadlessDefinition,
  idleHeuristics: {
    sessionIdPatterns,
    idlePromptPatterns,
    idleDebounceMs,
  },
};
