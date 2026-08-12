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

export interface RuntimeCompatibilityHost {
  shellVersion: string;
}

class RuntimeShellCompatibilityError extends Error {
  constructor(requiredVersion: string) {
    super(`Runtime requires Desktop ${requiredVersion} or newer`);
    this.name = "RuntimeShellCompatibilityError";
  }
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
  private readonly leasesRoot: string;

  constructor(private readonly options: RuntimeStoreOptions) {
    this.versionsRoot = resolve(options.root, "versions");
    this.downloadsRoot = resolve(options.root, "downloads");
    this.activePath = resolve(options.root, "active.json");
    this.pendingPath = resolve(options.root, "pending.json");
    this.failedPath = resolve(options.root, "failed.json");
    this.leasesRoot = resolve(options.root, "leases");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.versionsRoot, { recursive: true }),
      mkdir(this.downloadsRoot, { recursive: true }),
      mkdir(this.leasesRoot, { recursive: true }),
    ]);
  }

  assertManifestCompatible(
    manifest: RuntimeManifest,
    requireSignature = true,
    host?: RuntimeCompatibilityHost
  ): void {
    if (manifest.platform !== (this.options.platform ?? process.platform)) {
      throw new Error(`Runtime platform ${manifest.platform} is incompatible`);
    }
    if (manifest.arch !== (this.options.arch ?? process.arch)) {
      throw new Error(`Runtime architecture ${manifest.arch} is incompatible`);
    }
    if (
      compareVersions(host?.shellVersion ?? this.options.shellVersion, manifest.minShellVersion) < 0
    ) {
      throw new RuntimeShellCompatibilityError(manifest.minShellVersion);
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

  async validateRuntimeRoot(
    root: string,
    trustedFactory = false,
    host?: RuntimeCompatibilityHost
  ): Promise<RuntimeManifest> {
    const manifest = await readRuntimeManifest(root);
    this.assertManifestCompatible(manifest, !trustedFactory, host);
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
    const failedVersion = await this.readFailedVersion();
    const pendingPointer = await this.readPointerFile(this.pendingPath);
    let pending: ProductRuntime | null = null;
    let preservePending = false;
    if (pendingPointer) {
      try {
        pending = await this.resolveStoredRuntime(pendingPointer, "pending");
      } catch (error) {
        preservePending = error instanceof RuntimeShellCompatibilityError;
      }
      if (pending?.manifest.runtimeVersion === failedVersion) {
        pending = null;
        preservePending = false;
      }
    }
    if (!pending && !preservePending) {
      await rm(this.pendingPath, { force: true });
    }

    const activeState = await this.readActiveState();
    let active: ProductRuntime | null = null;
    if (activeState) {
      active = await this.resolveStoredRuntime(activeState.active, "active").catch(() => null);
      if (!active && activeState.previous) {
        const previous = await this.resolveStoredRuntime(activeState.previous, "active").catch(
          () => null
        );
        if (previous) {
          await writeJsonAtomic(this.activePath, { active: activeState.previous });
          active = previous;
        }
      }
      if (!active) await rm(this.activePath, { force: true });
    }

    const factory: ProductRuntime = {
      root: this.options.factoryRuntimeRoot,
      manifest: await this.validateRuntimeRoot(this.options.factoryRuntimeRoot, true),
      source: "factory",
    };
    const candidates = [pending, active, factory].filter(
      (candidate): candidate is ProductRuntime =>
        Boolean(candidate) &&
        !(candidate?.source === "factory" && candidate.manifest.runtimeVersion === failedVersion)
    );
    if (candidates.length === 0) return factory;
    const sourcePriority: Record<ProductRuntime["source"], number> = {
      active: 1,
      pending: 2,
      factory: 3,
    };
    candidates.sort((left, right) => {
      const versionOrder = compareVersions(
        right.manifest.runtimeVersion,
        left.manifest.runtimeVersion
      );
      return versionOrder || sourcePriority[right.source] - sourcePriority[left.source];
    });
    return candidates[0] as ProductRuntime;
  }

  async stageDownloadedRuntime(
    sourceRoot: string,
    options?: { shellVersion?: string }
  ): Promise<ProductRuntime> {
    await this.initialize();
    const manifest = await this.validateRuntimeRoot(sourceRoot, false, {
      shellVersion: options?.shellVersion ?? this.options.shellVersion,
    });
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
      if (process.platform === "win32") {
        // Antivirus and search indexers can keep handles open on a freshly populated
        // directory long enough for a directory rename to fail with EPERM. The
        // content-addressed destination is not visible until pending.json is written,
        // so a completed copy followed by the atomic pointer write is equally safe.
        await cp(sourceRoot, destination, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      } else {
        const staging = resolve(this.versionsRoot, `.staging-${randomUUID()}`);
        try {
          await cp(sourceRoot, staging, { recursive: true, errorOnExist: true });
          await renameWithRetry(staging, destination);
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
      }
    }
    await writeJsonAtomic(this.pendingPath, pointer);
    return { root: destination, manifest, source: "pending", pointer };
  }

  async preserveRollbackCandidate(runtime: ProductRuntime): Promise<void> {
    if (runtime.source !== "factory") return;
    await this.initialize();
    const current = await this.readActiveState();
    if (current?.active) return;
    const manifest = await this.validateRuntimeRoot(runtime.root, false);
    const pointer: RuntimePointer = {
      id: createHash("sha256")
        .update(getRuntimeManifestSigningPayload(manifest))
        .digest("hex")
        .slice(0, 24),
      runtimeVersion: manifest.runtimeVersion,
      installedAt: new Date().toISOString(),
    };
    const destination = resolve(this.versionsRoot, pointer.id);
    await rm(destination, { recursive: true, force: true });
    await cp(runtime.root, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await writeJsonAtomic(this.activePath, { active: pointer });
  }

  async markLaunchSuccessful(runtime: ProductRuntime): Promise<void> {
    if (runtime.source === "pending" && runtime.pointer) {
      const current = await this.readActiveState();
      await writeJsonAtomic(this.activePath, {
        active: runtime.pointer,
        ...(current?.active.id !== runtime.pointer.id ? { previous: current?.active } : {}),
      });
      await Promise.all([
        rm(this.pendingPath, { force: true }),
        rm(this.failedPath, { force: true }),
      ]);
    } else if (runtime.source === "factory") {
      const current = await this.readActiveState();
      if (current?.active.runtimeVersion === runtime.manifest.runtimeVersion) {
        await rm(this.activePath, { force: true });
      } else if (current?.active) {
        await writeJsonAtomic(this.activePath, { active: current.active });
      }
      await Promise.all([
        rm(this.pendingPath, { force: true }),
        rm(this.failedPath, { force: true }),
      ]);
    } else {
      await rm(this.pendingPath, { force: true });
    }
    await this.cleanupUnusedVersions().catch(() => {});
  }

  async acquireLease(runtime: ProductRuntime): Promise<() => Promise<void>> {
    if (!runtime.pointer) return async () => {};
    await this.initialize();
    const leasePath = resolve(this.leasesRoot, `${process.pid}-${randomUUID()}.json`);
    await writeFile(
      leasePath,
      `${JSON.stringify({ pid: process.pid, runtimeId: runtime.pointer.id })}\n`,
      "utf8"
    );
    return async () => {
      await rm(leasePath, { force: true });
    };
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
    if (runtime.source === "factory") {
      const activeState = await this.readActiveState();
      for (const pointer of [activeState?.active, activeState?.previous]) {
        if (!pointer || pointer.runtimeVersion === runtime.manifest.runtimeVersion) continue;
        const fallback = await this.resolveStoredRuntime(pointer, "active").catch(() => null);
        if (fallback) return fallback;
      }
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

  async clearFailedVersion(runtimeVersion: string): Promise<void> {
    if ((await this.readFailedVersion()) === runtimeVersion) {
      await rm(this.failedPath, { force: true });
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

  private async cleanupUnusedVersions(): Promise<void> {
    const protectedIds = new Set<string>();
    const [activeState, pending, leasedIds] = await Promise.all([
      this.readActiveState(),
      this.readPointerFile(this.pendingPath),
      this.readLeasedRuntimeIds(),
    ]);
    if (activeState?.active.id) protectedIds.add(activeState.active.id);
    if (activeState?.previous?.id) protectedIds.add(activeState.previous.id);
    if (pending?.id) protectedIds.add(pending.id);
    for (const id of leasedIds) protectedIds.add(id);

    const entries = await readdir(this.versionsRoot, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !protectedIds.has(entry.name))
        .map((entry) =>
          rm(resolve(this.versionsRoot, entry.name), { recursive: true, force: true }).catch(
            () => {}
          )
        )
    );
  }

  private async readLeasedRuntimeIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    const entries = await readdir(this.leasesRoot, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile() || !entry.name.endsWith(".json")) return;
        const path = resolve(this.leasesRoot, entry.name);
        try {
          const value = JSON.parse(await readFile(path, "utf8")) as {
            pid?: unknown;
            runtimeId?: unknown;
          };
          if (
            typeof value.pid !== "number" ||
            typeof value.runtimeId !== "string" ||
            !POINTER_ID_PATTERN.test(value.runtimeId)
          ) {
            await rm(path, { force: true });
            return;
          }
          try {
            process.kill(value.pid, 0);
            ids.add(value.runtimeId);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EPERM") ids.add(value.runtimeId);
            else await rm(path, { force: true });
          }
        } catch {
          await rm(path, { force: true });
        }
      })
    );
    return ids;
  }
}
