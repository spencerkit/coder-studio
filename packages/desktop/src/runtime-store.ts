import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  API_PROTOCOL_VERSION,
  compareVersions,
  DATA_SCHEMA_VERSION,
  DESKTOP_ENGINE_VERSION,
  getRuntimeManifestSigningPayload,
  hashRuntimeFile,
  RUNTIME_HOST_API_VERSION,
  type RuntimeManifest,
  readRuntimeManifest,
  resolveRuntimeFile,
  verifyRuntimeManifestSignature,
} from "./runtime-manifest.js";

interface RuntimePointer {
  id: string;
  runtimeVersion: string;
  installedAt: string;
}

interface ActiveRuntimeState {
  active: RuntimePointer;
  previous?: RuntimePointer;
}

export interface ProductRuntime {
  root: string;
  manifest: RuntimeManifest;
  source: "factory" | "active" | "pending";
  pointer?: RuntimePointer;
}

export interface RuntimeStoreOptions {
  root: string;
  factoryRuntimeRoot: string;
  shellVersion: string;
  nodeVersion: string;
  publicKeyPem?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
}

const POINTER_ID_PATTERN = /^[a-f0-9]{24}$/;

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(root, path)));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    else throw new Error(`Runtime contains an unsupported filesystem entry: ${entry.name}`);
  }
  return files.sort();
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !["EPERM", "EACCES", "EBUSY"].includes(code) || attempt === 5) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await renameWithRetry(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function parsePointer(value: unknown): RuntimePointer | null {
  if (!value || typeof value !== "object") return null;
  const pointer = value as Partial<RuntimePointer>;
  return typeof pointer.id === "string" &&
    POINTER_ID_PATTERN.test(pointer.id) &&
    typeof pointer.runtimeVersion === "string" &&
    pointer.runtimeVersion.length > 0 &&
    typeof pointer.installedAt === "string"
    ? (pointer as RuntimePointer)
    : null;
}

export class RuntimeStore {
  readonly downloadsRoot: string;
  private readonly versionsRoot: string;
  private readonly activePath: string;
  private readonly pendingPath: string;
  private readonly failedPath: string;

  constructor(private readonly options: RuntimeStoreOptions) {
    this.versionsRoot = resolve(options.root, "versions");
    this.downloadsRoot = resolve(options.root, "downloads");
    this.activePath = resolve(options.root, "active.json");
    this.pendingPath = resolve(options.root, "pending.json");
    this.failedPath = resolve(options.root, "failed.json");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.versionsRoot, { recursive: true }),
      mkdir(this.downloadsRoot, { recursive: true }),
    ]);
  }

  assertManifestCompatible(manifest: RuntimeManifest, requireSignature = true): void {
    if (manifest.platform !== (this.options.platform ?? process.platform)) {
      throw new Error(`Runtime platform ${manifest.platform} is incompatible`);
    }
    if (manifest.arch !== (this.options.arch ?? process.arch)) {
      throw new Error(`Runtime architecture ${manifest.arch} is incompatible`);
    }
    if (compareVersions(this.options.shellVersion, manifest.minShellVersion) < 0) {
      throw new Error(`Runtime requires Desktop ${manifest.minShellVersion} or newer`);
    }
    if (manifest.requiredEngineVersion !== DESKTOP_ENGINE_VERSION) {
      throw new Error(`Runtime requires Engine ${manifest.requiredEngineVersion}`);
    }
    if (manifest.requiredNodeVersion !== this.options.nodeVersion) {
      throw new Error(`Runtime requires Node ${manifest.requiredNodeVersion}`);
    }
    if (manifest.runtimeHostApiVersion !== RUNTIME_HOST_API_VERSION) {
      throw new Error(`Runtime Host API ${manifest.runtimeHostApiVersion} is incompatible`);
    }
    if (manifest.apiProtocolVersion !== API_PROTOCOL_VERSION) {
      throw new Error(`Runtime API protocol ${manifest.apiProtocolVersion} is incompatible`);
    }
    if (manifest.dataSchemaVersion !== DATA_SCHEMA_VERSION) {
      throw new Error(`Runtime data schema ${manifest.dataSchemaVersion} is incompatible`);
    }
    if (requireSignature) {
      if (!this.options.publicKeyPem) throw new Error("Product Runtime updates are not trusted");
      if (!verifyRuntimeManifestSignature(manifest, this.options.publicKeyPem)) {
        throw new Error("Product Runtime manifest signature is invalid");
      }
    }
  }

  async validateRuntimeRoot(root: string, trustedFactory = false): Promise<RuntimeManifest> {
    const manifest = await readRuntimeManifest(root);
    this.assertManifestCompatible(manifest, !trustedFactory);
    const expectedFiles = manifest.files.map((file) => file.path).sort();
    const actualFiles = (await collectFiles(root)).filter((path) => path !== "manifest.json");
    if (
      expectedFiles.length !== actualFiles.length ||
      expectedFiles.some((path, index) => path !== actualFiles[index])
    ) {
      throw new Error("Product Runtime file set does not match its manifest");
    }
    for (const file of manifest.files) {
      const actual = await hashRuntimeFile(resolveRuntimeFile(root, file.path));
      if (actual.sha256 !== file.sha256 || actual.size !== file.size) {
        throw new Error(`Product Runtime file verification failed: ${file.path}`);
      }
    }
    return manifest;
  }

  async getLaunchCandidate(): Promise<ProductRuntime> {
    await this.initialize();
    const pending = await this.readPointerFile(this.pendingPath);
    if (pending) {
      const runtime = await this.resolveStoredRuntime(pending, "pending").catch(() => null);
      if (runtime) return runtime;
      await rm(this.pendingPath, { force: true });
    }

    const activeState = await this.readActiveState();
    if (activeState) {
      const runtime = await this.resolveStoredRuntime(activeState.active, "active").catch(
        () => null
      );
      if (runtime) return runtime;
      if (activeState.previous) {
        const previous = await this.resolveStoredRuntime(activeState.previous, "active").catch(
          () => null
        );
        if (previous) {
          await writeJsonAtomic(this.activePath, { active: activeState.previous });
          return previous;
        }
      }
      await rm(this.activePath, { force: true });
    }

    const manifest = await this.validateRuntimeRoot(this.options.factoryRuntimeRoot, true);
    return { root: this.options.factoryRuntimeRoot, manifest, source: "factory" };
  }

  async stageDownloadedRuntime(sourceRoot: string): Promise<ProductRuntime> {
    await this.initialize();
    const manifest = await this.validateRuntimeRoot(sourceRoot);
    const id = createHash("sha256")
      .update(getRuntimeManifestSigningPayload(manifest))
      .digest("hex")
      .slice(0, 24);
    const pointer: RuntimePointer = {
      id,
      runtimeVersion: manifest.runtimeVersion,
      installedAt: new Date().toISOString(),
    };
    const destination = resolve(this.versionsRoot, id);
    const existing = await this.resolveStoredRuntime(pointer, "pending").catch(() => null);
    if (!existing) {
      await rm(destination, { recursive: true, force: true });
      const staging = resolve(this.versionsRoot, `.staging-${randomUUID()}`);
      try {
        await cp(sourceRoot, staging, { recursive: true, errorOnExist: true });
        await renameWithRetry(staging, destination);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }
    await writeJsonAtomic(this.pendingPath, pointer);
    return { root: destination, manifest, source: "pending", pointer };
  }

  async markLaunchSuccessful(runtime: ProductRuntime): Promise<void> {
    if (runtime.source !== "pending" || !runtime.pointer) return;
    const current = await this.readActiveState();
    await writeJsonAtomic(this.activePath, {
      active: runtime.pointer,
      ...(current?.active.id !== runtime.pointer.id ? { previous: current?.active } : {}),
    });
    await Promise.all([
      rm(this.pendingPath, { force: true }),
      rm(this.failedPath, { force: true }),
    ]);
  }

  async fallbackAfterFailure(runtime: ProductRuntime, error: unknown): Promise<ProductRuntime> {
    await writeJsonAtomic(this.failedPath, {
      runtimeVersion: runtime.manifest.runtimeVersion,
      source: runtime.source,
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    if (runtime.source === "pending") {
      await rm(this.pendingPath, { force: true });
      return this.getLaunchCandidate();
    }
    if (runtime.source === "active") {
      const activeState = await this.readActiveState();
      if (activeState?.previous) {
        const previous = await this.resolveStoredRuntime(activeState.previous, "active").catch(
          () => null
        );
        if (previous) {
          await writeJsonAtomic(this.activePath, { active: activeState.previous });
          return previous;
        }
      }
      await rm(this.activePath, { force: true });
      const manifest = await this.validateRuntimeRoot(this.options.factoryRuntimeRoot, true);
      return { root: this.options.factoryRuntimeRoot, manifest, source: "factory" };
    }
    throw error;
  }

  async readPendingVersion(): Promise<string | null> {
    return (await this.readPointerFile(this.pendingPath))?.runtimeVersion ?? null;
  }

  async readFailedVersion(): Promise<string | null> {
    try {
      const value = JSON.parse(await readFile(this.failedPath, "utf8")) as {
        runtimeVersion?: unknown;
      };
      return typeof value.runtimeVersion === "string" ? value.runtimeVersion : null;
    } catch {
      return null;
    }
  }

  private async resolveStoredRuntime(
    pointer: RuntimePointer,
    source: "active" | "pending"
  ): Promise<ProductRuntime> {
    const root = resolve(this.versionsRoot, pointer.id);
    const manifest = await this.validateRuntimeRoot(root);
    if (manifest.runtimeVersion !== pointer.runtimeVersion) {
      throw new Error("Stored Product Runtime version does not match its pointer");
    }
    return { root, manifest, source, pointer };
  }

  private async readPointerFile(path: string): Promise<RuntimePointer | null> {
    try {
      return parsePointer(JSON.parse(await readFile(path, "utf8")));
    } catch {
      return null;
    }
  }

  private async readActiveState(): Promise<ActiveRuntimeState | null> {
    try {
      const value = JSON.parse(await readFile(this.activePath, "utf8")) as {
        active?: unknown;
        previous?: unknown;
      };
      const active = parsePointer(value.active);
      if (!active) return null;
      const previous = parsePointer(value.previous);
      return { active, ...(previous ? { previous } : {}) };
    } catch {
      return null;
    }
  }
}
