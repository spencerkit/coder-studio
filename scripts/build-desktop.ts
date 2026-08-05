import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import * as esbuild from "esbuild";
import { buildDesktopRuntime } from "./build-desktop-runtime.js";
import { ensureDir, error, info, log, ROOT_DIR, step, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export const DESKTOP_DIR = resolve(ROOT_DIR, "packages/desktop");
export const DESKTOP_DIST_DIR = resolve(DESKTOP_DIR, "dist");

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
  const runtimeUpdateUrl =
    process.env.CODER_STUDIO_RUNTIME_UPDATE_URL?.trim() ??
    `https://github.com/spencerkit/coder-studio/releases/latest/download/coder-studio-runtime-${process.platform}-${process.arch}.manifest.json`;
  const runtimeDefines = {
    __CODER_STUDIO_RUNTIME_PUBLIC_KEY__: JSON.stringify(runtimePublicKey),
    __CODER_STUDIO_RUNTIME_UPDATE_URL__: JSON.stringify(runtimeUpdateUrl),
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
}

export async function buildDesktop(): Promise<void> {
  step("BUILD DESKTOP", "Building desktop shell and Product Runtime...\n");
  await buildDesktopShell({ clean: true });
  const runtime = await buildDesktopRuntime();
  info(`Desktop shell: ${DESKTOP_DIST_DIR}`);
  info(`Factory Runtime: ${runtime.factoryRuntimeDir}`);
  info(`Publishable Runtime: ${runtime.releaseRuntimeDir}`);
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
