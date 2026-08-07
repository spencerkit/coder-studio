import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  DESKTOP_NODE_VERSION,
  parseRuntimeManifest,
  verifyRuntimeManifestSignature,
} from "../packages/desktop/src/runtime-manifest.js";
import { RuntimeStore } from "../packages/desktop/src/runtime-store.js";
import { ProductRuntimeUpdateManager } from "../packages/desktop/src/runtime-update-manager.js";
import { error, ROOT_DIR, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

interface AcceptanceReport {
  schemaVersion: 1;
  runtimeVersion: string;
  factoryRuntimeVersion?: string;
  downloadBaseUrl: string;
  desktopExecutable: string;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function verifyDesktopRuntimeUpdate(): Promise<{
  factoryVersion: string;
  stagedVersion: string;
  activeVersion: string;
  wslVersion: string;
}> {
  if (process.platform !== "win32") {
    throw new Error("The local Desktop Runtime update check must run on Windows");
  }
  const acceptanceRoot = resolve(ROOT_DIR, "release/wsl-acceptance");
  const report = await readJson<AcceptanceReport>(resolve(acceptanceRoot, "acceptance.json"));
  const publicKeyPem = await readFile(resolve(acceptanceRoot, "keys/runtime-public.pem"), "utf8");
  const desktopPackage = await readJson<{ version: string }>(
    resolve(ROOT_DIR, "packages/desktop/package.json")
  );
  const factoryRuntimeRoot = resolve(
    dirname(report.desktopExecutable),
    "resources/factory-runtime"
  );
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-runtime-update-verify-"));
  const storeOptions = {
    root: resolve(temporaryRoot, "runtime-store"),
    factoryRuntimeRoot,
    shellVersion: desktopPackage.version,
    nodeVersion: DESKTOP_NODE_VERSION,
    publicKeyPem,
  };

  try {
    const store = new RuntimeStore(storeOptions);
    const factory = await store.getLaunchCandidate();
    if (factory.source !== "factory") throw new Error("Expected the Factory Runtime initially");
    if (
      report.factoryRuntimeVersion &&
      factory.manifest.runtimeVersion !== report.factoryRuntimeVersion
    ) {
      throw new Error(
        `Factory Runtime ${factory.manifest.runtimeVersion} does not match ${report.factoryRuntimeVersion}`
      );
    }

    const manager = new ProductRuntimeUpdateManager({
      store,
      manifestUrl: new URL(
        `coder-studio-runtime-win32-${process.arch}.manifest.json`,
        report.downloadBaseUrl
      ).toString(),
      getCurrentRuntime: () => factory,
    });
    const result = await manager.check();
    if (result.status !== "ready") {
      throw new Error(`Expected a ready Runtime update, received ${result.status}`);
    }
    if (result.runtime.manifest.runtimeVersion !== report.runtimeVersion) {
      throw new Error("The staged Runtime version does not match the acceptance report");
    }
    if (result.runtime.manifest.files.some((file) => file.path.endsWith(".map"))) {
      throw new Error("The staged Product Runtime contains sourcemaps");
    }

    const pending = await store.getLaunchCandidate();
    if (pending.source !== "pending") throw new Error("The downloaded Runtime was not pending");
    await store.markLaunchSuccessful(pending);

    const restartedStore = new RuntimeStore(storeOptions);
    const active = await restartedStore.getLaunchCandidate();
    if (active.source !== "active") throw new Error("The pending Runtime was not promoted");
    if (active.manifest.runtimeVersion !== report.runtimeVersion) {
      throw new Error("The active Runtime version does not match the acceptance report");
    }

    const wslManifestUrl = new URL(
      `coder-studio-server-runtime-linux-${process.arch}.manifest.json`,
      report.downloadBaseUrl
    );
    const wslResponse = await fetch(wslManifestUrl, { cache: "no-store" });
    if (!wslResponse.ok) throw new Error(`WSL Runtime check failed with ${wslResponse.status}`);
    const wslManifest = parseRuntimeManifest(await wslResponse.json());
    if (
      wslManifest.runtimeVersion !== report.runtimeVersion ||
      wslManifest.platform !== "linux" ||
      wslManifest.webRoot ||
      !verifyRuntimeManifestSignature(wslManifest, publicKeyPem)
    ) {
      throw new Error("The matching WSL Runtime manifest is invalid");
    }

    return {
      factoryVersion: factory.manifest.runtimeVersion,
      stagedVersion: pending.manifest.runtimeVersion,
      activeVersion: active.manifest.runtimeVersion,
      wslVersion: wslManifest.runtimeVersion,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (isDirectExecution(import.meta.url)) {
  verifyDesktopRuntimeUpdate()
    .then((result) => {
      success("Signed Product Runtime update verified through pending and active states");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((verifyError) => {
      error(verifyError instanceof Error ? verifyError.message : String(verifyError));
      process.exit(1);
    });
}
