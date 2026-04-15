/**
 * esbuild configuration and utilities
 */

import { type BuildOptions } from 'esbuild';
import { resolve } from 'path';
import { PACKAGES_DIR, CLI_DIR, SERVER_DIR, CORE_DIR, PROVIDERS_DIR } from './paths.js';

/**
 * Get external dependencies from package.json
 */
async function getExternalDeps(packageDir: string): Promise<string[]> {
  try {
    const { default: pkg } = await import(resolve(packageDir, 'package.json'), {
      assert: { type: 'json' },
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
export async function createCliBuildOptions(
  format: 'esm' | 'cjs'
): Promise<BuildOptions> {
  const cliExternal = await getExternalDeps(CLI_DIR);
  const serverExternal = await getExternalDeps(SERVER_DIR);
  const coreExternal = await getExternalDeps(CORE_DIR);
  const providersExternal = await getExternalDeps(PROVIDERS_DIR);

  // Combine all dependencies
  const allDeps = new Set([
    ...cliExternal,
    ...serverExternal,
    ...coreExternal,
    ...providersExternal,
  ]);

  // Only externalize third-party dependencies (not internal @coder-studio/* packages)
  const external = Array.from(allDeps).filter(
    (dep) => !dep.startsWith('@coder-studio/')
  );

  const outfile = format === 'esm'
    ? resolve(CLI_DIR, 'dist/esm/index.mjs')
    : resolve(CLI_DIR, 'dist/cjs/index.js');

  return {
    entryPoints: [resolve(CLI_DIR, 'src/bin.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format,
    outfile,
    external,
    sourcemap: true,
    minify: false,
    // Resolve internal workspace packages to their source files
    alias: {
      '@coder-studio/server': resolve(SERVER_DIR, 'src/index.ts'),
      '@coder-studio/core': resolve(CORE_DIR, 'src/index.ts'),
      '@coder-studio/providers': resolve(PROVIDERS_DIR, 'src/index.ts'),
    },
    banner: format === 'esm'
      ? { js: '// @coder-studio/cli - ESM bundle' }
      : undefined,
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

  // Combine all dependencies and filter out internal packages
  const allDeps = new Set([
    ...cliExternal,
    ...serverExternal,
    ...coreExternal,
    ...providersExternal,
  ]);

  return Array.from(allDeps).filter(
    (dep) => !dep.startsWith('@coder-studio/')
  );
}
