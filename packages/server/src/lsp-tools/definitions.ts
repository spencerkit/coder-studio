import type { LspServerKind } from "@coder-studio/core";
import { type CommandRunner, runCommandAsString } from "../provider-runtime/command-runner.js";

export const VUE_LANGUAGE_SERVER_VERSION = "3.3.2";
export const VUE_TYPESCRIPT_VERSION = "6.0.3";
export const VUE_MANAGED_VERSION = `${VUE_LANGUAGE_SERVER_VERSION}-typescript-${VUE_TYPESCRIPT_VERSION}`;

export interface LspToolDefinition {
  serverKind: LspServerKind;
  displayName: string;
  defaultCommand: string;
  defaultArgs: string[];
  bundled?: {
    packageName: string;
    entry: string;
    args: string[];
    launchWithNode?: boolean;
  };
  managed?: {
    version: string;
    prerequisites: string[];
    supportedPlatforms: NodeJS.Platform[];
  };
}

export const LSP_TOOL_DEFINITIONS: Record<LspServerKind, LspToolDefinition> = {
  typescript: {
    serverKind: "typescript",
    displayName: "TypeScript language server",
    defaultCommand: "typescript-language-server",
    defaultArgs: ["--stdio"],
    bundled: {
      packageName: "typescript-language-server",
      entry: "lib/cli.mjs",
      args: ["--stdio"],
      launchWithNode: true,
    },
  },
  python: {
    serverKind: "python",
    displayName: "Python language server",
    defaultCommand: "pylsp",
    defaultArgs: [],
    managed: {
      version: "1.14.0",
      prerequisites: ["python3"],
      supportedPlatforms: ["linux", "darwin", "win32"],
    },
  },
  go: {
    serverKind: "go",
    displayName: "Go language server",
    defaultCommand: "gopls",
    defaultArgs: [],
    managed: {
      version: "v0.21.1",
      prerequisites: ["go"],
      supportedPlatforms: ["linux", "darwin", "win32"],
    },
  },
  rust: {
    serverKind: "rust",
    displayName: "Rust language server",
    defaultCommand: "rust-analyzer",
    defaultArgs: [],
    managed: {
      version: "2026-05-18",
      prerequisites: [],
      supportedPlatforms: ["linux", "darwin", "win32"],
    },
  },
  vue: {
    serverKind: "vue",
    displayName: "Vue language server",
    defaultCommand: "vue-language-server",
    defaultArgs: ["--stdio"],
    managed: {
      version: VUE_MANAGED_VERSION,
      prerequisites: ["npm"],
      supportedPlatforms: ["linux", "darwin", "win32"],
    },
  },
};

export function getLspToolDefinition(serverKind: LspServerKind): LspToolDefinition {
  return LSP_TOOL_DEFINITIONS[serverKind];
}

export function getLspCommandOverridePrefix(serverKind: LspServerKind): string {
  return `CODER_STUDIO_LSP_${serverKind.toUpperCase()}`;
}

export function getManagedPrerequisites(
  serverKind: LspServerKind,
  platform: NodeJS.Platform = process.platform
): string[] {
  if (serverKind === "python" && platform === "win32") {
    return ["python3", "python"];
  }

  return getLspToolDefinition(serverKind).managed?.prerequisites ?? [];
}

export async function resolveManagedPythonCommand(
  commandExists: (command: string) => Promise<boolean>,
  platform: NodeJS.Platform = process.platform,
  runCommand: CommandRunner = runCommandAsString
): Promise<string | null> {
  const candidates = getManagedPrerequisites("python", platform);
  for (const candidate of candidates) {
    if (!(await commandExists(candidate))) {
      continue;
    }
    if (platform === "win32" && !(await isWindowsPythonAlive(candidate, runCommand))) {
      // `where python(3)` happily returns
      // `%LOCALAPPDATA%\Microsoft\WindowsApps\python(3).exe` even when Python
      // is not installed — those are zero-byte Microsoft Store "App Execution
      // Aliases" that redirect to the Store. Accepting them would pass the
      // prerequisite check and then explode at the `python -m venv ...`
      // install step with an empty/non-existent venv. Probe the candidate
      // with `--version` and require it to actually print something.
      continue;
    }
    return candidate;
  }

  return null;
}

/**
 * Returns true if invoking `<command> --version` produces any output. Python
 * prints its version to stdout from 3.4 onwards and stderr on older builds,
 * so we accept either. The Microsoft Store stub prints nothing.
 */
async function isWindowsPythonAlive(command: string, runCommand: CommandRunner): Promise<boolean> {
  try {
    const result = await runCommand(command, ["--version"], { windowsHide: true });
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    return combined.length > 0;
  } catch {
    return false;
  }
}
