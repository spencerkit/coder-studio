import type { ProviderConfig, ProviderDefinition } from "@coder-studio/core";
import { debounceIdleHeuristics } from "../debounce-idle-heuristics.js";
import { opencodeSkillMountDirectories } from "../skills/directories.js";
import { type OpenCodeConfig, opencodeConfigSchema } from "./config-schema.js";

const opencodeInstallMetadata = {
  prerequisites: ["npm"],
  manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.opencode.manual"],
  docUrls: {
    provider: "https://github.com/anomalyco/opencode#installation",
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
        id: "npm-install-opencode",
        kind: "provider",
        targetCommand: "opencode",
        requiresCommands: ["npm"],
        command: "npm",
        args: ["install", "-g", "opencode-ai"],
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
        id: "npm-install-opencode",
        kind: "provider",
        targetCommand: "opencode",
        requiresCommands: ["npm"],
        command: "npm",
        args: ["install", "-g", "opencode-ai"],
      },
    ],
    linux: [
      {
        id: "npm-install-opencode",
        kind: "provider",
        targetCommand: "opencode",
        requiresCommands: ["npm"],
        command: "npm",
        args: ["install", "-g", "opencode-ai"],
      },
    ],
  },
} satisfies ProviderDefinition["install"];

export const opencodeDefinition: ProviderDefinition = {
  id: "opencode",
  displayName: "OpenCode",
  badge: "OpenCode",
  kind: "built_in",
  stability: "experimental",
  supportsAgentInstructions: true,
  supportsSkillsMount: true,
  skillMountDirectories: opencodeSkillMountDirectories(),
  capability: "limited",
  capabilities: [
    { key: "interactive_session", supported: true, label: "Interactive session" },
    { key: "supervisor_eval", supported: false, label: "Supervisor evaluation" },
    { key: "idle_detection", supported: true, label: "Idle detection" },
    { key: "context_attach", supported: false, label: "Context attach" },
    { key: "review", supported: false, label: "Review" },
  ],
  install: opencodeInstallMetadata,
  buildCommand(config: ProviderConfig, ctx) {
    const cfg = opencodeConfigSchema.parse(config);
    const modelArg = cfg.model ? ["--model", cfg.model] : [];

    return {
      argv: ["opencode", ...modelArg, ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },
  configSchema: opencodeConfigSchema,
  defaultConfig: {
    additionalArgs: [],
    envVars: {},
  } satisfies OpenCodeConfig,
  requiredCommands: ["opencode"],
  agentInstructions: {
    publishTarget: {
      path: "AGENTS.md",
    },
  },
  idleHeuristics: debounceIdleHeuristics,
};
