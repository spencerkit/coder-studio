import { fileURLToPath } from "node:url";
import { buildWslRuntimeSource } from "@coder-studio/runtime";
import { getCliVersion } from "./package-manifest.js";
import { resolveCliPackageRoot, startServer } from "./server-runner.js";

export interface DesktopServerEnv {
  host?: string;
  port: number;
  stateDir?: string;
  runtimeJsonPath?: string;
  password?: string;
}

export function parseDesktopServerEnv(env: NodeJS.ProcessEnv): DesktopServerEnv {
  return {
    ...(env.CODER_STUDIO_DESKTOP_HOST?.trim()
      ? { host: env.CODER_STUDIO_DESKTOP_HOST.trim() }
      : {}),
    port: env.CODER_STUDIO_DESKTOP_PORT ? Number(env.CODER_STUDIO_DESKTOP_PORT) : 0,
    ...(env.CODER_STUDIO_DESKTOP_STATE_DIR ? { stateDir: env.CODER_STUDIO_DESKTOP_STATE_DIR } : {}),
    ...(env.CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH
      ? { runtimeJsonPath: env.CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH }
      : {}),
    ...(env.CODER_STUDIO_DESKTOP_PASSWORD ? { password: env.CODER_STUDIO_DESKTOP_PASSWORD } : {}),
  };
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const parsed = parseDesktopServerEnv(env);
  const cliVersion = getCliVersion(import.meta.url);
  await startServer({
    serverConfig: {
      port: parsed.port,
      wslRuntime: {
        source: buildWslRuntimeSource({
          runtimeVersion: cliVersion,
          packageRoot: resolveCliPackageRoot(import.meta.url),
          entryRelativePath: "dist/esm/wsl-runtime-entry.mjs",
        }),
      },
      ...(parsed.host ? { host: parsed.host } : {}),
      ...(parsed.stateDir ? { stateDir: parsed.stateDir } : {}),
      ...(parsed.password ? { auth: { enabled: true, password: parsed.password } } : {}),
    },
    writeRuntimeConfig: true,
    runtimeJsonPath: parsed.runtimeJsonPath,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Desktop server error:", message);
    process.exit(1);
  });
}
