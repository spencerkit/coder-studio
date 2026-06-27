/**
 * esbuild configuration and utilities
 */

import { type BuildOptions } from "esbuild";
import { resolve } from "path";
import {
  CLI_DIR,
  CLI_ESM_DIR,
  CORE_DIR,
  PACKAGES_DIR,
  PROVIDERS_DIR,
  SERVER_DIR,
  UTILS_DIR,
} from "./paths.js";

/**
 * Get external dependencies from package.json
 */
async function getExternalDeps(packageDir: string): Promise<string[]> {
  try {
    const { default: pkg } = await import(resolve(packageDir, "package.json"), {
      assert: { type: "json" },
    });

    const deps = Object.keys(pkg.dependencies || {});
    const peerDeps = Object.keys(pkg.peerDependencies || {});

    return [...deps, ...peerDeps];
  } catch {
    return [];
  }
}

/**
 * Create esbuild options for CLI bundle
 * Bundles all internal workspace packages, externalizes only third-party deps
 */
export async function createCliBuildOptions(format: "esm" | "cjs"): Promise<BuildOptions> {
  const cliExternal = await getExternalDeps(CLI_DIR);
  const serverExternal = await getExternalDeps(SERVER_DIR);
  const coreExternal = await getExternalDeps(CORE_DIR);
  const providersExternal = await getExternalDeps(PROVIDERS_DIR);
  const utilsExternal = await getExternalDeps(UTILS_DIR);

  // Combine all dependencies
  const allDeps = new Set([
    ...cliExternal,
    ...serverExternal,
    ...coreExternal,
    ...providersExternal,
    ...utilsExternal,
  ]);

  // Only externalize third-party dependencies (not internal @coder-studio/* packages)
  const external = Array.from(allDeps).filter((dep) => !dep.startsWith("@coder-studio/"));

  // pm2 is conditionally imported and not listed as a dep; externalize it
  if (!external.includes("pm2")) {
    external.push("pm2");
  }

  const outdir = format === "esm" ? resolve(CLI_DIR, "dist/esm") : resolve(CLI_DIR, "dist/cjs");

  return {
    entryPoints: [
      resolve(CLI_DIR, "src/automation-entry.ts"),
      resolve(CLI_DIR, "src/bin.ts"),
      resolve(CLI_DIR, "src/index.ts"),
      resolve(CLI_DIR, "src/server-runner.ts"),
      resolve(CLI_DIR, "src/update-worker.ts"),
    ],
    bundle: true,
    platform: "node",
    target: "node24",
    format,
    outdir,
    outExtension: { ".js": format === "esm" ? ".mjs" : ".js" },
    external,
    sourcemap: true,
    minify: false,
    // Resolve internal workspace packages to their source files
    alias: {
      "@coder-studio/server": resolve(SERVER_DIR, "src/index.ts"),
      "@coder-studio/core/runtime": resolve(CORE_DIR, "src/runtime.ts"),
      "@coder-studio/core/state-paths": resolve(CORE_DIR, "src/state-paths.ts"),
      "@coder-studio/core": resolve(CORE_DIR, "src/index.ts"),
      "@coder-studio/providers": resolve(PROVIDERS_DIR, "src/index.ts"),
      "@coder-studio/utils": resolve(UTILS_DIR, "src/index.ts"),
    },
    banner: format === "esm" ? { js: "// @spencer-kit/coder-studio - ESM bundle" } : undefined,
  };
}

export async function createWslRuntimeEntryBuildOptions(): Promise<BuildOptions> {
  const baseOptions = await createCliBuildOptions("esm");
  return {
    ...baseOptions,
    entryPoints: [resolve(CLI_DIR, "src/wsl-runtime-entry.ts")],
    // Keep third-party deps external so bundled CJS (pino, mime-types, etc.) is not
    // inlined into ESM. Mixing bundled require shims with top-level await breaks on Node 24.
    packages: "external",
    define: {
      "process.env.CODER_STUDIO_WSL_RUNTIME_ENTRY": '"1"',
    },
    banner: {
      js: "// @spencer-kit/coder-studio - WSL runtime entry",
    },
  };
}

/**
 * Get list of production dependencies for assembly
 */
export async function getProductionDeps(): Promise<string[]> {
  const cliExternal = await getExternalDeps(CLI_DIR);
  const serverExternal = await getExternalDeps(SERVER_DIR);
  const coreExternal = await getExternalDeps(CORE_DIR);
  const providersExternal = await getExternalDeps(PROVIDERS_DIR);
  const utilsExternal = await getExternalDeps(UTILS_DIR);

  // Combine all dependencies and filter out internal packages
  const allDeps = new Set([
    ...cliExternal,
    ...serverExternal,
    ...coreExternal,
    ...providersExternal,
    ...utilsExternal,
  ]);

  return Array.from(allDeps).filter((dep) => !dep.startsWith("@coder-studio/"));
}
