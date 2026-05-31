/**
 * Build the `LspServerSpec` for a Vue session.
 *
 * Volar 3.x dropped its embedded TypeScript service, so a working setup
 * requires:
 *
 *   1. The Vue Language Server (Volar) itself, talking LSP on stdio.
 *   2. A paired TypeScript Language Server with `@vue/typescript-plugin`
 *      loaded as a tsserver plugin. The two communicate via `tsserver/request`
 *      and `tsserver/response` notifications that our `LspSession` bridge
 *      forwards to the TS server's `workspace/executeCommand
 *      typescript.tsserverRequest`.
 *
 * If the bridge cannot be wired up (no TypeScript server resolvable, or the
 * `CODER_STUDIO_VUE_TSSERVER_BRIDGE` switch is `off`), the function returns
 * the bare Volar spec. The user will still see the editor open .vue files,
 * but semantic features will not return until the bridge is in place.
 */

import path from "node:path";
import type { LspCompanionSpec, LspServerSpec } from "./server-factory.js";

export type VueBridgeMode = "auto" | "off";

export interface VueSpecInputs {
  /** Resolved Volar command (path to `vue-language-server[.cmd]` or wrapper). */
  vueCommand: string;
  vueArgs: string[];
  /**
   * Path to the directory that hosts both `@vue/language-server` and
   * `@vue/typescript-plugin` under its `node_modules`. We pass this to the
   * TypeScript Language Server as the `location` of the Vue tsserver plugin
   * so it can resolve the plugin package next to Volar itself.
   */
  vueLanguageServerLocation: string;
  /** Resolved TypeScript language server command (already includes --stdio). */
  typescriptCommand: string;
  typescriptArgs: string[];
  /**
   * `auto` (default) wires up the bridge when both ends are available;
   * `off` disables it entirely so the operator can rule out bridge bugs.
   */
  bridgeMode?: VueBridgeMode;
}

export interface VueSpecParts {
  initializationOptions: unknown;
  companion: LspCompanionSpec | undefined;
  bridges: LspServerSpec["bridges"];
}

/**
 * Walk the on-disk shape of a typical npm-managed Vue install
 * (`<root>/node_modules/.bin/vue-language-server(.cmd)`) up to the directory
 * that contains `node_modules/@vue/language-server`. Returns `null` when the
 * caller passes us something unexpected (e.g. an `--stdio` wrapper) so we can
 * fail closed rather than hand the TS server a bogus plugin location.
 */
export function inferVueLanguageServerLocation(vueExecutablePath: string): string | null {
  // Tolerate both POSIX and Windows separators regardless of the host platform
  // so that the helper is testable from either side.
  const normalized = vueExecutablePath.replace(/\\/g, "/");
  if (!normalized.toLowerCase().includes("/node_modules/.bin/")) {
    return null;
  }

  const pathApi = getPathApi(vueExecutablePath);
  const binDir = pathApi.dirname(vueExecutablePath); // <root>/node_modules/.bin
  const nodeModulesDir = pathApi.dirname(binDir); // <root>/node_modules
  return pathApi.join(nodeModulesDir, "@vue", "language-server");
}

export function buildVueSpecParts(inputs: VueSpecInputs): VueSpecParts {
  const bridgeMode: VueBridgeMode = inputs.bridgeMode ?? "auto";

  // We always send Volar a `typescript.tsdk` initialization option so it
  // doesn't fall back to a bundled-with-VSCode resolution that won't exist
  // outside that environment. Volar's bin entry also auto-`require`s the
  // typescript module installed alongside it, but being explicit is cheap.
  const initializationOptions: Record<string, unknown> = {
    typescript: {
      tsdk: deriveTsdk(inputs.vueLanguageServerLocation),
    },
  };

  if (bridgeMode === "off") {
    return {
      initializationOptions,
      companion: undefined,
      bridges: undefined,
    };
  }

  const companion: LspCompanionSpec = {
    command: inputs.typescriptCommand,
    args: inputs.typescriptArgs,
    initializationOptions: {
      plugins: [
        {
          name: "@vue/typescript-plugin",
          location: inputs.vueLanguageServerLocation,
          languages: ["vue"],
        },
      ],
    },
  };

  return {
    initializationOptions,
    companion,
    bridges: { tsserverRequest: true },
  };
}

export function parseVueBridgeMode(value: string | undefined): VueBridgeMode {
  if (value === undefined || value === null || value === "") {
    return "auto";
  }
  return value.toLowerCase() === "off" ? "off" : "auto";
}

function deriveTsdk(vueLanguageServerLocation: string): string {
  // typescript is installed at the sibling of @vue/language-server:
  //   <root>/node_modules/@vue/language-server   <- location
  //   <root>/node_modules/typescript/lib         <- tsdk
  const pathApi = getPathApi(vueLanguageServerLocation);
  const vueAtDir = pathApi.dirname(vueLanguageServerLocation); // <root>/node_modules/@vue
  const nodeModulesDir = pathApi.dirname(vueAtDir); // <root>/node_modules
  return pathApi.join(nodeModulesDir, "typescript", "lib");
}

function getPathApi(value: string) {
  return isWindowsStylePath(value) ? path.win32 : path.posix;
}

function isWindowsStylePath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\");
}
