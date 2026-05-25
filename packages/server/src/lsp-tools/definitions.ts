import type { LspServerKind } from "@coder-studio/core";

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
      version: "3.3.2",
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
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  const candidates = getManagedPrerequisites("python", platform);
  for (const candidate of candidates) {
    if (await commandExists(candidate)) {
      return candidate;
    }
  }

  return null;
}
