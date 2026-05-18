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
};

export function getLspToolDefinition(serverKind: LspServerKind): LspToolDefinition {
  return LSP_TOOL_DEFINITIONS[serverKind];
}

export function getLspCommandOverridePrefix(serverKind: LspServerKind): string {
  return `CODER_STUDIO_LSP_${serverKind.toUpperCase()}`;
}
