import type { ProviderConfig, ProviderDefinition } from "@coder-studio/core";
import { debounceIdleHeuristics } from "../debounce-idle-heuristics.js";
import { sharedFirstSkillMountDirectories } from "../skills/directories.js";
import { type GeminiConfig, geminiConfigSchema } from "./config-schema.js";
import { buildGeminiSupervisorEvalCommand } from "./supervisor-eval.js";

const geminiInstallMetadata = {
  prerequisites: ["npm"],
  manualGuideKeys: ["provider.install.nodejs.manual", "provider.install.gemini.manual"],
  docUrls: {
    provider: "https://google-gemini.github.io/gemini-cli/docs/get-started/",
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
        id: "npm-install-gemini",
        kind: "provider",
        targetCommand: "gemini",
        requiresCommands: ["npm"],
        command: "npm",
        args: ["install", "-g", "@google/gemini-cli"],
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
        id: "npm-install-gemini",
        kind: "provider",
        targetCommand: "gemini",
        requiresCommands: ["npm"],
        command: "npm",
        args: ["install", "-g", "@google/gemini-cli"],
      },
    ],
    linux: [
      {
        id: "npm-install-gemini",
        kind: "provider",
        targetCommand: "gemini",
        requiresCommands: ["npm"],
        command: "npm",
        args: ["install", "-g", "@google/gemini-cli"],
      },
    ],
  },
} satisfies ProviderDefinition["install"];

export const geminiDefinition: ProviderDefinition = {
  id: "gemini",
  displayName: "Gemini CLI",
  badge: "Gemini",
  kind: "built_in",
  stability: "stable",
  supportsAgentInstructions: true,
  supportsSkillsMount: true,
  skillMountDirectories: sharedFirstSkillMountDirectories(".gemini"),
  capability: "full",
  capabilities: [
    { key: "interactive_session", supported: true, label: "Interactive session" },
    { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
    { key: "idle_detection", supported: true, label: "Idle detection" },
    { key: "context_attach", supported: false, label: "Context attach" },
    { key: "review", supported: false, label: "Review" },
  ],
  install: geminiInstallMetadata,
  buildCommand(config: ProviderConfig, ctx) {
    const cfg = geminiConfigSchema.parse(config);
    const modelArg = cfg.model ? ["--model", cfg.model] : [];

    return {
      argv: ["gemini", ...modelArg, ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },
  configSchema: geminiConfigSchema,
  defaultConfig: {
    additionalArgs: [],
    envVars: {},
  } satisfies GeminiConfig,
  requiredCommands: ["gemini"],
  agentInstructions: {
    publishTarget: {
      path: "GEMINI.md",
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

      return buildGeminiSupervisorEvalCommand(config, req);
    },
  },
  idleHeuristics: debounceIdleHeuristics,
};
