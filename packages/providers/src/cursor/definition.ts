import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderConfig, ProviderDefinition } from "@coder-studio/core";
import { debounceIdleHeuristics } from "../debounce-idle-heuristics.js";
import { type CursorConfig, cursorConfigSchema } from "./config-schema.js";
import { buildCursorSupervisorEvalCommand } from "./supervisor-eval.js";

const cursorInstallMetadata = {
  prerequisites: [],
  manualGuideKeys: ["provider.install.cursor.manual"],
  docUrls: {
    provider: "https://cursor.com/docs/cli/installation",
    prerequisites: {},
  },
  strategies: {
    darwin: [
      {
        id: "cursor-install-script",
        kind: "provider",
        targetCommand: "agent",
        requiresCommands: ["bash"],
        command: "bash",
        args: ["-lc", "curl https://cursor.com/install -fsS | bash"],
      },
    ],
    linux: [
      {
        id: "cursor-install-script",
        kind: "provider",
        targetCommand: "agent",
        requiresCommands: ["bash"],
        command: "bash",
        args: ["-lc", "curl https://cursor.com/install -fsS | bash"],
      },
    ],
  },
} satisfies ProviderDefinition["install"];

export const cursorDefinition: ProviderDefinition = {
  id: "cursor",
  displayName: "Cursor Agent",
  badge: "Cursor",
  kind: "built_in",
  stability: "stable",
  supportsAgentInstructions: true,
  supportsSkillsMount: true,
  skillMountDirectories: [join(homedir(), ".cursor", "skills")],
  capability: "full",
  capabilities: [
    { key: "interactive_session", supported: true, label: "Interactive session" },
    { key: "supervisor_eval", supported: true, label: "Supervisor evaluation" },
    { key: "idle_detection", supported: true, label: "Idle detection" },
    { key: "context_attach", supported: false, label: "Context attach" },
    { key: "review", supported: false, label: "Review" },
  ],
  install: cursorInstallMetadata,
  buildCommand(config: ProviderConfig, ctx) {
    const cfg = cursorConfigSchema.parse(config);
    const modelArg = cfg.model ? ["--model", cfg.model] : [];

    return {
      argv: ["agent", ...modelArg, ...cfg.additionalArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: ctx.workspacePath,
    };
  },
  configSchema: cursorConfigSchema,
  defaultConfig: {
    additionalArgs: [],
    envVars: {},
  } satisfies CursorConfig,
  requiredCommands: ["agent"],
  agentInstructions: {
    publishTarget: {
      path: "AGENTS.md",
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

      return buildCursorSupervisorEvalCommand(config, req);
    },
  },
  idleHeuristics: debounceIdleHeuristics,
};
