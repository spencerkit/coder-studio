import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as esbuild from "esbuild";
import { normalizeUtcTimestamp } from "../packages/desktop/src/build-info.js";
import {
  API_PROTOCOL_VERSION,
  DATA_SCHEMA_VERSION,
  DESKTOP_ENGINE_VERSION,
  DESKTOP_NODE_VERSION,
  RUNTIME_HOST_API_VERSION,
} from "../packages/desktop/src/runtime-manifest.js";
import { ensureDir, error, info, log, ROOT_DIR, step, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export const DESKTOP_DIR = resolve(ROOT_DIR, "packages/desktop");
export const DESKTOP_DIST_DIR = resolve(DESKTOP_DIR, "dist");

export function resolveDesktopChannelUrls(env: NodeJS.ProcessEnv): {
  productChannelUrl: string;
  desktopChannelUrl: string;
} {
  return {
    productChannelUrl:
      env.CODER_STUDIO_PRODUCT_CHANNEL_URL?.trim() ||
      "https://github.com/spencerkit/coder-studio/releases/download/product-stable/product-channel.json",
    desktopChannelUrl:
      env.CODER_STUDIO_DESKTOP_CHANNEL_URL?.trim() ||
      "https://github.com/spencerkit/coder-studio/releases/download/desktop-stable/desktop-channel.json",
  };
}

export async function buildDesktopShell(options: { clean?: boolean } = {}): Promise<void> {
  if (options.clean) {
    await rm(DESKTOP_DIST_DIR, { recursive: true, force: true });
  }
  await ensureDir(DESKTOP_DIST_DIR);
  const runtimePublicKey = process.env.CODER_STUDIO_RUNTIME_PUBLIC_KEY?.trim() ?? "";
  const cliManifest = JSON.parse(
    await readFile(resolve(ROOT_DIR, "packages/cli/package.json"), "utf8")
  ) as { version?: unknown };
  if (typeof cliManifest.version !== "string" || !cliManifest.version.trim()) {
    throw new Error("Unable to resolve the Product Runtime version");
  }
  const desktopManifest = JSON.parse(
    await readFile(resolve(DESKTOP_DIR, "package.json"), "utf8")
  ) as { version?: unknown };
  if (typeof desktopManifest.version !== "string" || !desktopManifest.version.trim()) {
    throw new Error("Unable to resolve the Desktop Shell version");
  }
  const releasePublishedAtValue = process.env.CODER_STUDIO_RELEASE_PUBLISHED_AT?.trim();
  const releasePublishedAt = releasePublishedAtValue
    ? normalizeUtcTimestamp(releasePublishedAtValue, "CODER_STUDIO_RELEASE_PUBLISHED_AT")
    : null;
  const { productChannelUrl, desktopChannelUrl } = resolveDesktopChannelUrls(process.env);
  const runtimeDefines = {
    __CODER_STUDIO_RUNTIME_PUBLIC_KEY__: JSON.stringify(runtimePublicKey),
    __CODER_STUDIO_PRODUCT_CHANNEL_URL__: JSON.stringify(productChannelUrl),
    __CODER_STUDIO_DESKTOP_CHANNEL_URL__: JSON.stringify(desktopChannelUrl),
    __CODER_STUDIO_PRODUCT_VERSION__: JSON.stringify(cliManifest.version.trim()),
  };

  await Promise.all([
    esbuild.build({
      entryPoints: [resolve(DESKTOP_DIR, "src/main.ts")],
      bundle: true,
      platform: "node",
      target: "node24",
      format: "cjs",
      outfile: resolve(DESKTOP_DIST_DIR, "main.cjs"),
      external: ["electron"],
      define: runtimeDefines,
      sourcemap: false,
    }),
    esbuild.build({
      entryPoints: [resolve(DESKTOP_DIR, "src/preload.ts")],
      bundle: true,
      platform: "node",
      target: "node24",
      format: "cjs",
      outfile: resolve(DESKTOP_DIST_DIR, "preload.cjs"),
      external: ["electron"],
      define: runtimeDefines,
      sourcemap: false,
    }),
  ]);
  const buildInfo = {
    schemaVersion: 1,
    shellVersion: desktopManifest.version.trim(),
    builtAt: new Date().toISOString(),
    publishedAt: releasePublishedAt,
    engineVersion: DESKTOP_ENGINE_VERSION,
    nodeVersion: DESKTOP_NODE_VERSION,
    runtimeHostApiVersion: RUNTIME_HOST_API_VERSION,
    apiProtocolVersion: API_PROTOCOL_VERSION,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
  };
  await writeFile(
    resolve(DESKTOP_DIST_DIR, "build-info.json"),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
    "utf8"
  );
}

export async function buildDesktop(): Promise<void> {
  step("BUILD DESKTOP", "Building the independent Desktop Shell...\n");
  await buildDesktopShell({ clean: true });
  info(`Desktop shell: ${DESKTOP_DIST_DIR}`);
  success("Desktop build complete");
}

if (isDirectExecution(import.meta.url)) {
  buildDesktop()
    .then(() => log("\n✓ Desktop build complete.\n"))
    .catch((buildError) => {
      error(buildError instanceof Error ? buildError.message : String(buildError));
      process.exit(1);
    });
}
