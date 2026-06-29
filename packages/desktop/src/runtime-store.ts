import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseRuntimeManifest, RUNTIME_MANIFEST_FILE_NAME } from "./runtime-manifest.js";

export interface ActiveRuntimePointer {
  version: string;
  installedAt: number;
  path: string;
  entry: string;
  webRoot: string;
  checksumSha256: string;
  source: string;
  minAppVersion?: string;
  previousVersion?: string;
}

export interface RuntimeStoreLayout {
  rootDir: string;
  currentPointerPath: string;
  versionsDir: string;
  downloadsDir: string;
  stagingDir: string;
}

export function resolveRuntimeStoreLayout(userDataDir: string): RuntimeStoreLayout {
  const rootDir = join(userDataDir, "runtime-store");
  return {
    rootDir,
    currentPointerPath: join(rootDir, "current.json"),
    versionsDir: join(rootDir, "versions"),
    downloadsDir: join(rootDir, "downloads"),
    stagingDir: join(rootDir, "staging"),
  };
}

export async function readActiveRuntimePointer(
  currentPointerPath: string
): Promise<ActiveRuntimePointer | null> {
  try {
    const raw = await readFile(currentPointerPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ActiveRuntimePointer>;
    if (
      typeof parsed.version !== "string" ||
      typeof parsed.installedAt !== "number" ||
      typeof parsed.path !== "string" ||
      typeof parsed.entry !== "string" ||
      typeof parsed.checksumSha256 !== "string" ||
      typeof parsed.source !== "string"
    ) {
      return null;
    }

    return {
      version: parsed.version,
      installedAt: parsed.installedAt,
      path: parsed.path,
      entry: parsed.entry,
      webRoot:
        typeof parsed.webRoot === "string" && parsed.webRoot.trim().length > 0
          ? parsed.webRoot
          : "dist/web",
      checksumSha256: parsed.checksumSha256,
      source: parsed.source,
      ...(typeof parsed.minAppVersion === "string" ? { minAppVersion: parsed.minAppVersion } : {}),
      ...(typeof parsed.previousVersion === "string"
        ? { previousVersion: parsed.previousVersion }
        : {}),
    };
  } catch {
    return null;
  }
}

async function readRuntimeManifest(stagingDir: string) {
  const raw = await readFile(join(stagingDir, RUNTIME_MANIFEST_FILE_NAME), "utf-8");
  return parseRuntimeManifest(JSON.parse(raw));
}

export class RuntimeStore {
  private readonly layout: RuntimeStoreLayout;
  private readonly now: () => number;

  constructor(input: { userDataDir: string; now?: () => number }) {
    this.layout = resolveRuntimeStoreLayout(input.userDataDir);
    this.now = input.now ?? Date.now;
  }

  async readActiveRuntime(): Promise<ActiveRuntimePointer | null> {
    return readActiveRuntimePointer(this.layout.currentPointerPath);
  }

  async activateStagedRuntime(input: {
    stagingDir: string;
    checksumSha256: string;
    source: string;
    minAppVersion?: string;
  }): Promise<ActiveRuntimePointer> {
    await this.ensureLayout();
    const manifest = await readRuntimeManifest(input.stagingDir);
    const current = await this.readActiveRuntime();
    const targetDir = join(this.layout.versionsDir, manifest.version);

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(this.layout.versionsDir, { recursive: true });
    await cp(input.stagingDir, targetDir, { recursive: true, force: true });

    const pointer: ActiveRuntimePointer = {
      version: manifest.version,
      installedAt: this.now(),
      path: targetDir,
      entry: manifest.entry,
      webRoot: manifest.webRoot,
      checksumSha256: input.checksumSha256,
      source: input.source,
      ...(typeof input.minAppVersion === "string" && input.minAppVersion.trim().length > 0
        ? { minAppVersion: input.minAppVersion.trim() }
        : {}),
      ...(current?.version ? { previousVersion: current.version } : {}),
    };

    const tempPointerPath = `${this.layout.currentPointerPath}.tmp`;
    await writeFile(tempPointerPath, `${JSON.stringify(pointer, null, 2)}\n`);
    await rename(tempPointerPath, this.layout.currentPointerPath);

    return pointer;
  }

  private async ensureLayout(): Promise<void> {
    await mkdir(this.layout.rootDir, { recursive: true });
    await mkdir(this.layout.versionsDir, { recursive: true });
    await mkdir(this.layout.downloadsDir, { recursive: true });
    await mkdir(this.layout.stagingDir, { recursive: true });
  }
}

export function resolveActiveRuntimeEntry(pointer: ActiveRuntimePointer): string {
  return resolve(pointer.path, pointer.entry);
}
