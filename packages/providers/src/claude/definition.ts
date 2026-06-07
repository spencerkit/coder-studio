import type { ProviderConfig, ProviderDefinition } from "@coder-studio/core";

import { providerSkillMountDirectories } from "../skills/directories.js";
import { claudeConfigSchema } from "./config-schema.js";
import { claudeIdleHeuristics } from "./idle-heuristics.js";
import { buildClaudeSupervisorEvalCommand } from "./supervisor-eval.js";

export const claudeInstallMetadata = {
  prerequisites: ["npm"],
  manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.claude.manual"],
  docUrls: {
    provider: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
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
        id: "npm-install-claude",
        kind: "provider",
        targetCommand: "claude",
        requiresCommands: ["npm"],
        command: "npm",
        args: ["install", "-g", "@anthropic-ai/claude-code"],
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
        id: "npm-install-claude",
        kind: "provider",
        targetCommand: "claude",
        requiresCommands: ["npm"],
        command: "npm",
        args: ["install", "-g", "@anthropic-ai/claude-code"],
      },
    ],
    linux: [
      {
        id: "npm-install-claude",
        kind: "provider",
        targetCommand: "claude",
        requiresCommands: ["npm"],
        command: "npm",
        args: ["install", "-g", "@anthropic-ai/claude-code"],
      },
    ],
  },
} satisfies ProviderDefinition["install"];

/**
 * Claude Code provider definition.
 */
export const claudeDefinition: ProviderDefinition = {
  // ===== Metadata =====
  id: "claude",
  displayName: "Claude Code",
  badge: "Claude",
  kind: "built_in",
  capability: "full",
  capabilities: [
    { key: "interactive_session", supported: true, label: "Interactive session" },
    { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
    { key: "idle_detection", supported: true, label: "Idle detection" },
    { key: "context_attach", supported: false, label: "Context attach" },
    { key: "review", supported: false, label: "Review" },
  ],
  install: claudeInstallMetadata,
  supportsSkillsMount: true,
  skillMountDirectories: providerSkillMountDirectories(".claude"),

  // ===== Command construction =====
  buildCommand(config: ProviderConfig, ctx) {
    const cfg = claudeConfigSchema.parse(config);
    const modelArg = cfg.model ? ["--model", cfg.model] : [];

    return {
      argv: ["claude", ...modelArg, ...(cfg.additionalArgs ?? [])],
      env: {
        ...(cfg.envVars ?? {}),
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },

  // ===== Configuration =====
  configSchema: claudeConfigSchema,
  defaultConfig: {},

  // ===== Runtime requirements =====
  requiredCommands: ["claude"],
  agentInstructions: {
    publishTarget: {
      path: ".claude/CLAUDE.md",
    },
  },
  headless: {
    supportedScenarios: ["supervisor_eval", "session_analysis", "agent_instructions_generate"],
    buildCommand(config, scenario, req) {
      if (
        scenario !== "supervisor_eval" &&
        scenario !== "session_analysis" &&
        scenario !== "agent_instructions_generate"
      ) {
        return null;
      }

      return buildClaudeSupervisorEvalCommand(config, req);
    },
  },
  idleHeuristics: claudeIdleHeuristics,
};
