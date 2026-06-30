import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseRuntimeManifest } from "../packages/desktop/src/runtime-manifest.js";
import { buildDesktop } from "./build-desktop.js";
import { DESKTOP_DIR, error, info, log, ROOT_DIR, run, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

const SMOKE_USER_DATA_RELATIVE_DIR = join(".tmp", "desktop-local-smoke", "user-data");
const DESKTOP_ELECTRON_ENTRY = "dist/electron/main.mjs";
const LOCAL_SEED_SOURCE = "local-desktop-seed";

export type SmokeScriptRunner = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }
) => Promise<void>;

export async function prepareDesktopLocalSmokeUserData(input: {
  repoRoot?: string;
  now?: () => number;
}): Promise<{
  userDataDir: string;
  runtimeVersion: string;
}> {
  const repoRoot = input.repoRoot ?? ROOT_DIR;
  const userDataDir = join(repoRoot, SMOKE_USER_DATA_RELATIVE_DIR);
  const runtimeSeedDir = join(repoRoot, "packages", "desktop", "dist", "runtime", "seed");
  const runtimeStoreDir = join(userDataDir, "runtime-store");
  const currentPointerPath = join(runtimeStoreDir, "current.json");

  const manifest = parseRuntimeManifest(
    JSON.parse(await readFile(join(runtimeSeedDir, "runtime-manifest.json"), "utf-8"))
  );
  const versionDir = join(runtimeStoreDir, "versions", manifest.version);

  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(join(runtimeStoreDir, "versions"), { recursive: true });
  await cp(runtimeSeedDir, versionDir, { recursive: true, force: true });
  await writeFile(
    currentPointerPath,
    `${JSON.stringify(
      {
        version: manifest.version,
        installedAt: (input.now ?? Date.now)(),
        path: versionDir,
        entry: manifest.entry,
        webRoot: manifest.webRoot,
        checksumSha256: LOCAL_SEED_SOURCE,
        source: LOCAL_SEED_SOURCE,
      },
      null,
      2
    )}\n`
  );

  return {
    userDataDir,
    runtimeVersion: manifest.version,
  };
}

export async function runDesktopSmokeLocal(
  input: {
    repoRoot?: string;
    env?: NodeJS.ProcessEnv;
    buildDesktopApp?: () => Promise<void>;
    prepareLocalUserData?: (input: { repoRoot: string }) => Promise<{
      userDataDir: string;
      runtimeVersion: string;
    }>;
    runCommand?: SmokeScriptRunner;
  } = {}
): Promise<void> {
  const repoRoot = input.repoRoot ?? ROOT_DIR;
  const buildDesktopApp = input.buildDesktopApp ?? buildDesktop;
  const prepareLocalUserData = input.prepareLocalUserData ?? prepareDesktopLocalSmokeUserData;
  const runCommand = input.runCommand ?? ((command, args, options) => run(command, args, options));

  info("Building desktop artifacts for local smoke test...");
  await buildDesktopApp();

  info("Preparing isolated desktop userData...");
  const prepared = await prepareLocalUserData({
    repoRoot,
  });

  success(
    `Prepared isolated desktop runtime ${prepared.runtimeVersion} at ${prepared.userDataDir}`
  );
  info("Launching Electron against local desktop assets...");

  await runCommand(
    "pnpm",
    ["--filter", "@coder-studio/desktop", "exec", "electron", DESKTOP_ELECTRON_ENTRY],
    {
      cwd: repoRoot,
      env: {
        ...(input.env ?? process.env),
        CODER_STUDIO_DESKTOP_USER_DATA_DIR: prepared.userDataDir,
      },
    }
  );
}

if (isDirectExecution(import.meta.url)) {
  runDesktopSmokeLocal()
    .then(() => {
      log("\n✓ Desktop local smoke run exited cleanly.\n");
      process.exit(0);
    })
    .catch((err) => {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
