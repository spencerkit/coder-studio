import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type {
  LspServerKind,
  LspToolRuntimeStatusEntry,
  LspToolSource,
  Workspace,
} from "@coder-studio/core";
import {
  type CommandAvailabilityCheck,
  type CommandCheckDeps,
  checkCommandAvailable,
} from "../provider-runtime/command-check.js";
import {
  getLspCommandOverridePrefix,
  getLspToolDefinition,
  type LspToolDefinition,
} from "./definitions.js";
import { type FileManifestStore, type ManagedLspToolManifest } from "./manifest-store.js";

const require = createRequire(import.meta.url);

export interface ResolvedLspToolCommand {
  kind: "ready";
  serverKind: LspServerKind;
  displayName: string;
  source: LspToolSource;
  command: string;
  args: string[];
}

export interface MissingLspToolCommand {
  kind: "tool_missing";
  serverKind: LspServerKind;
  displayName: string;
  errorCode: "lsp_tool_missing" | "lsp_prerequisite_missing";
  message: string;
  autoInstallSupported: boolean;
  installReadiness: LspToolRuntimeStatusEntry["installReadiness"];
  missingCommands: string[];
  missingPrerequisites: string[];
}

export type LspToolResolveResult = ResolvedLspToolCommand | MissingLspToolCommand;

export interface LspToolManagerDeps extends CommandCheckDeps {
  manifestStore: FileManifestStore;
  commandExists?: CommandAvailabilityCheck;
  resolveBundledCommand?: (serverKind: LspServerKind) => { command: string; args: string[] } | null;
}

export class LspToolManager {
  constructor(private readonly deps: LspToolManagerDeps) {}

  async resolve(input: {
    workspace: Workspace;
    serverKind: LspServerKind;
    env?: NodeJS.ProcessEnv;
  }): Promise<LspToolResolveResult> {
    const env = input.env ?? process.env;
    const commandExists =
      this.deps.commandExists ?? ((command: string) => checkCommandAvailable(command, this.deps));
    const definition = getLspToolDefinition(input.serverKind);

    const override = this.resolveOverride(input.serverKind, env);
    if (override) {
      return {
        kind: "ready",
        serverKind: input.serverKind,
        displayName: definition.displayName,
        source: "override",
        command: override.command,
        args: override.args,
      };
    }

    const managed = this.resolveManaged(definition);
    if (managed) {
      return {
        kind: "ready",
        serverKind: input.serverKind,
        displayName: definition.displayName,
        source: "managed",
        command: managed.executablePath,
        args: definition.defaultArgs,
      };
    }

    const bundled = this.resolveBundled(input.serverKind, definition);
    if (bundled) {
      return {
        kind: "ready",
        serverKind: input.serverKind,
        displayName: definition.displayName,
        source: "bundled",
        command: bundled.command,
        args: bundled.args,
      };
    }

    if (await commandExists(definition.defaultCommand)) {
      return {
        kind: "ready",
        serverKind: input.serverKind,
        displayName: definition.displayName,
        source: "system",
        command: definition.defaultCommand,
        args: definition.defaultArgs,
      };
    }

    return this.buildMissingResult(input.workspace, definition, commandExists);
  }

  async runtimeStatus(input: {
    workspace: Workspace;
    serverKind: LspServerKind;
    env?: NodeJS.ProcessEnv;
  }): Promise<LspToolRuntimeStatusEntry> {
    const result = await this.resolve(input);
    if (result.kind === "ready") {
      return {
        serverKind: result.serverKind,
        displayName: result.displayName,
        available: true,
        source: result.source,
        autoInstallSupported: false,
        installReadiness: "ready",
        missingCommands: [],
        missingPrerequisites: [],
      };
    }

    return {
      serverKind: result.serverKind,
      displayName: result.displayName,
      available: false,
      autoInstallSupported: result.autoInstallSupported,
      installReadiness: result.installReadiness,
      missingCommands: result.missingCommands,
      missingPrerequisites: result.missingPrerequisites,
      message: result.message,
    };
  }

  private resolveOverride(
    serverKind: LspServerKind,
    env: NodeJS.ProcessEnv
  ): { command: string; args: string[] } | null {
    const prefix = getLspCommandOverridePrefix(serverKind);
    const command = env[`${prefix}_COMMAND`];
    if (!command) {
      return null;
    }

    const argsJson = env[`${prefix}_ARGS_JSON`];
    const args = argsJson ? parseOverrideArgs(argsJson, `${prefix}_ARGS_JSON`) : [];
    return { command, args };
  }

  private resolveManaged(definition: LspToolDefinition): ManagedLspToolManifest | null {
    const manifest = this.deps.manifestStore.read(definition.serverKind);
    if (!manifest) {
      return null;
    }

    if (!existsSync(manifest.executablePath)) {
      return null;
    }

    return manifest;
  }

  private resolveBundled(
    serverKind: LspServerKind,
    definition: LspToolDefinition
  ): { command: string; args: string[] } | null {
    if (this.deps.resolveBundledCommand) {
      return this.deps.resolveBundledCommand(serverKind);
    }

    if (!definition.bundled) {
      return null;
    }

    try {
      const packageJsonPath = require.resolve(`${definition.bundled.packageName}/package.json`);
      const packageRoot = join(packageJsonPath, "..");
      const entryPath = join(packageRoot, definition.bundled.entry);
      if (!existsSync(entryPath)) {
        return null;
      }

      const command = definition.bundled.launchWithNode ? process.execPath : entryPath;
      const args = definition.bundled.launchWithNode
        ? [entryPath, ...definition.bundled.args]
        : definition.bundled.args;

      return {
        command,
        args,
      };
    } catch {
      return null;
    }
  }

  private async buildMissingResult(
    workspace: Workspace,
    definition: LspToolDefinition,
    commandExists: CommandAvailabilityCheck
  ): Promise<MissingLspToolCommand> {
    const missingCommands = [definition.defaultCommand];
    const missingPrerequisites: string[] = [];
    const managed = definition.managed;
    const autoInstallSupported = Boolean(managed) && workspace.targetRuntime === "native";

    if (managed && workspace.targetRuntime === "native") {
      for (const prerequisite of managed.prerequisites) {
        if (!(await commandExists(prerequisite))) {
          missingPrerequisites.push(prerequisite);
        }
      }
    }

    const installReadiness =
      !managed || workspace.targetRuntime !== "native"
        ? "unsupported_platform"
        : missingPrerequisites.length > 0
          ? "missing_prerequisite"
          : "ready";

    return {
      kind: "tool_missing",
      serverKind: definition.serverKind,
      displayName: definition.displayName,
      errorCode: missingPrerequisites.length > 0 ? "lsp_prerequisite_missing" : "lsp_tool_missing",
      message:
        missingPrerequisites.length > 0
          ? `Missing prerequisites for ${definition.displayName}: ${missingPrerequisites.join(", ")}`
          : `${definition.displayName} is not installed`,
      autoInstallSupported,
      installReadiness,
      missingCommands,
      missingPrerequisites,
    };
  }
}

function parseOverrideArgs(raw: string, envVarName: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new Error("override args must be a string array");
    }

    return parsed;
  } catch {
    throw new Error(`Invalid JSON in ${envVarName}`);
  }
}
