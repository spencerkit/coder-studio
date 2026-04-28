/**
 * Shared path definitions for build scripts
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Root directory
export const ROOT_DIR = resolve(__dirname, '../..');

// Package directories
export const PACKAGES_DIR = resolve(ROOT_DIR, 'packages');
export const CORE_DIR = resolve(PACKAGES_DIR, 'core');
export const PROVIDERS_DIR = resolve(PACKAGES_DIR, 'providers');
export const SERVER_DIR = resolve(PACKAGES_DIR, 'server');
export const WEB_DIR = resolve(PACKAGES_DIR, 'web');
export const CLI_DIR = resolve(PACKAGES_DIR, 'cli');
export const HOOK_BRIDGE_DIR = resolve(PACKAGES_DIR, 'hook-bridge');

// Build output directories
export const WEB_DIST_DIR = resolve(WEB_DIR, 'dist');
export const SERVER_DIST_DIR = resolve(SERVER_DIR, 'dist');
export const CLI_DIST_DIR = resolve(CLI_DIR, 'dist');
export const HOOK_BRIDGE_DIST_DIR = resolve(HOOK_BRIDGE_DIR, 'dist');

// CLI subdirectories
export const CLI_ESM_DIR = resolve(CLI_DIST_DIR, 'esm');
export const CLI_CJS_DIR = resolve(CLI_DIST_DIR, 'cjs');
export const CLI_WEB_DIR = resolve(CLI_DIST_DIR, 'web');

// Hook bridge scripts
export const HOOK_BRIDGE_SRC = resolve(HOOK_BRIDGE_DIR, 'src');
export const RUNTIME_DIR = resolve(ROOT_DIR, '.coder-studio');
export const RUNTIME_HOOKS_DIR = resolve(RUNTIME_DIR, 'hooks');
