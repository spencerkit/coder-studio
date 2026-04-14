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
 */
export async function createCliBuildOptions(
  format: 'esm' | 'cjs'
): Promise<BuildOptions> {
  const external = await getExternalDeps(CLI_DIR);
  const serverExternal = await getExternalDeps(SERVER_DIR);
  const coreExternal = await getExternalDeps(CORE_DIR);
  const providersExternal = await getExternalDeps(PROVIDERS_DIR);

  const allExternal = new Set([
    ...external,
    ...serverExternal,
    ...coreExternal,
    ...providersExternal,
  ]);

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
    external: Array.from(allExternal),
    sourcemap: true,
    minify: false,
    packages: 'external',
    banner: format === 'esm'
      ? { js: '// @coder-studio/cli - ESM bundle' }
      : undefined,
  };
}
