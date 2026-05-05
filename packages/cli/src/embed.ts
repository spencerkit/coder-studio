/**
 * Embed Web Assets
 *
 * Utility functions for checking embedded web assets
 * The actual serving is handled by Fastify static plugin
 */

import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to embedded web assets (relative to dist/esm/index.mjs)
const WEB_ASSETS_DIR = resolve(__dirname, "../web");

/**
 * Get the static assets directory path
 */
export function getStaticAssetsDir(): string {
  return WEB_ASSETS_DIR;
}

/**
 * Check if web assets exist
 */
export function hasWebAssets(): boolean {
  return existsSync(WEB_ASSETS_DIR);
}

/**
 * Embed web assets (called during CLI startup)
 *
 * Note: This just validates assets exist. The server handles
 * static file serving via the webRoot config option.
 */
export async function embedWebAssets(): Promise<void> {
  if (!hasWebAssets()) {
    console.warn("Warning: Web assets not found. Frontend will not be available.");
  }
}
