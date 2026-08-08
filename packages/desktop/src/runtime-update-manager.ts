import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extract } from "tar";
import type { DesktopChannelRuntime } from "./desktop-channel.js";
import { resolveChannelAsset } from "./desktop-channel.js";
import type { DesktopRuntimeUpdateState, DesktopRuntimeUpdateStatus } from "./protocol.js";
import {
  compareVersions,
  getRuntimeManifestSigningPayload,
  isSafeRuntimeRelativePath,
  parseNetworkRuntimeManifest,
  type RuntimeManifest,
  type RuntimeManifestV2,
  readRuntimeManifest,
} from "./runtime-manifest.js";
import { type ProductRuntime, RuntimeStore } from "./runtime-store.js";

export type RuntimeUpdateCheckResult =
  | { status: "disabled" | "current" | "already-staged" | "failed" }
  | { status: "ready"; runtime: ProductRuntime };

export interface RuntimeUpdateManagerOptions {
  store: RuntimeStore;
  manifestUrl?: string;
  getCurrentRuntime: () => ProductRuntime;
  onUpdateReady?: (runtime: ProductRuntime) => void;
  onError?: (error: Error) => void;
  onStateChanged?: (state: DesktopRuntimeUpdateState) => void;
  checkIntervalMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_RUNTIME_PACKAGE_BYTES = 300 * 1024 * 1024;

class ByteLimitTransform extends Transform {
  private total = 0;

  constructor(
    private readonly contentLength: number | null = null,
    private readonly onProgress?: (percent: number) => void
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void
  ): void {
    this.total += chunk.byteLength;
    if (this.total > MAX_RUNTIME_PACKAGE_BYTES) {
      callback(new Error("Product Runtime package exceeds the download limit"));
      return;
    }
    if (this.contentLength && this.contentLength > 0) {
      this.onProgress?.(Math.min(99, (this.total / this.contentLength) * 100));
    }
    callback(null, chunk);
  }
}

function normalizeArchivePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function manifestsMatch(expected: RuntimeManifest, actual: RuntimeManifest): boolean {
  return (
    getRuntimeManifestSigningPayload(expected).equals(getRuntimeManifestSigningPayload(actual)) &&
    expected.signature?.algorithm === actual.signature?.algorithm &&
    expected.signature?.value === actual.signature?.value
  );
}

export type RuntimeUpdateComponentId = "runtime:win32-x64" | "runtime:linux-x64";

export interface RuntimeUpdateMetadata {
  componentId: RuntimeUpdateComponentId;
  manifestUrl: string;
  manifest: RuntimeManifestV2;
  version: string;
  publishedAt: string;
  plannedShellVersion: string;
}

export interface RuntimeDownloadOptions {
  signal: AbortSignal;
  onProgress: (percent: number) => void;
  explicitRetry: boolean;
}

export interface RuntimeUpdateAdapter {
  checkMetadata(
    expected: DesktopChannelRuntime,
    plannedShellVersion: string
  ): Promise<RuntimeUpdateMetadata>;
  downloadAndStage(
    metadata: RuntimeUpdateMetadata,
    options: RuntimeDownloadOptions
  ): Promise<unknown>;
  getPendingVersion(): Promise<string | null>;
}

function componentIdForManifest(manifest: RuntimeManifestV2): RuntimeUpdateComponentId {
  const target = `${manifest.platform}-${manifest.arch}`;
  if (target !== "win32-x64" && target !== "linux-x64") {
    throw new Error(`Desktop Runtime target ${target} is unsupported`);
  }
  return `runtime:${target}`;
}

export class ProductRuntimeUpdateManager {
  private timer: NodeJS.Timeout | null = null;
  private checkPromise: Promise<RuntimeUpdateCheckResult> | null = null;
  private latestVersion: string | null = null;
  private lastCheckedAt: number | null = null;
  private status: DesktopRuntimeUpdateStatus;
  private errorSummary: string | null = null;

  constructor(private readonly options: RuntimeUpdateManagerOptions) {
    this.status = options.manifestUrl ? "idle" : "disabled";
  }

  start(): void {
    if (!this.options.manifestUrl) return;
    void this.check().catch(() => {});
    this.timer = setInterval(
      () => void this.check().catch(() => {}),
      this.options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  check(): Promise<RuntimeUpdateCheckResult> {
    if (!this.options.manifestUrl) return Promise.resolve({ status: "disabled" });
    if (this.checkPromise) return this.checkPromise;

    this.status = "checking";
    this.errorSummary = null;
    this.notifyStateChanged();
    const checkPromise = this.performCheck()
      .then((result) => {
        this.lastCheckedAt = (this.options.now ?? Date.now)();
        this.status = this.getStatusForResult(result);
        this.errorSummary =
          result.status === "failed"
            ? "The latest Product Runtime was quarantined after a failed launch"
            : null;
        this.notifyStateChanged();
        return result;
      })
      .catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.lastCheckedAt = (this.options.now ?? Date.now)();
        this.status = "error";
        this.errorSummary = normalized.message;
        this.reportError(normalized);
        this.notifyStateChanged();
        throw normalized;
      })
      .finally(() => {
        if (this.checkPromise === checkPromise) this.checkPromise = null;
      });
    this.checkPromise = checkPromise;
    return this.checkPromise;
  }

  getPendingVersion(): Promise<string | null> {
    return this.options.store.readPendingVersion();
  }

  async checkMetadata(
    expected: DesktopChannelRuntime,
    plannedShellVersion: string
  ): Promise<RuntimeUpdateMetadata> {
    if (!this.options.manifestUrl) {
      throw new Error("No Product Runtime update channel is configured");
    }
    const manifestUrl = resolveChannelAsset(this.options.manifestUrl, expected.manifest);
    const manifestResponse = await (this.options.fetch ?? fetch)(manifestUrl, {
      cache: "no-store",
    });
    if (!manifestResponse.ok) {
      throw new Error(`Product Runtime update check failed with ${manifestResponse.status}`);
    }
    const manifest = parseNetworkRuntimeManifest(await manifestResponse.json());
    this.options.store.assertManifestCompatible(manifest, true, {
      shellVersion: plannedShellVersion,
    });
    if (
      manifest.runtimeVersion !== expected.version ||
      manifest.publishedAt !== expected.publishedAt
    ) {
      throw new Error("Product Runtime manifest does not match signed Desktop channel");
    }
    return {
      componentId: componentIdForManifest(manifest),
      manifestUrl,
      manifest,
      version: manifest.runtimeVersion,
      publishedAt: manifest.publishedAt,
      plannedShellVersion,
    };
  }

  async downloadAndStage(
    metadata: RuntimeUpdateMetadata,
    options: RuntimeDownloadOptions
  ): Promise<ProductRuntime> {
    if (
      (await this.options.store.readFailedVersion()) === metadata.version &&
      !options.explicitRetry
    ) {
      throw new Error(
        `Product Runtime ${metadata.version} was quarantined; an explicit retry is required`
      );
    }
    if (!metadata.manifest.packageFile) {
      throw new Error("Runtime update manifest has no package file");
    }
    if (options.signal.aborted) throw options.signal.reason;

    const packageUrl = new URL(metadata.manifest.packageFile, metadata.manifestUrl).toString();
    await this.options.store.initialize();
    const workRoot = await mkdtemp(resolve(this.options.store.downloadsRoot, "runtime-update-"));
    const archivePath = resolve(workRoot, "runtime.tgz");
    const extractedRoot = resolve(workRoot, "payload");
    let lastProgress = -1;
    const reportProgress = (percent: number) => {
      const next = Math.max(lastProgress, Math.min(100, percent));
      if (next === lastProgress) return;
      lastProgress = next;
      options.onProgress(next);
    };
    try {
      reportProgress(0);
      const packageResponse = await (this.options.fetch ?? fetch)(packageUrl, {
        cache: "no-store",
        signal: options.signal,
      });
      if (!packageResponse.ok || !packageResponse.body) {
        throw new Error(`Product Runtime download failed with ${packageResponse.status}`);
      }
      const contentLength = Number(packageResponse.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_RUNTIME_PACKAGE_BYTES) {
        throw new Error("Product Runtime package exceeds the download limit");
      }
      await pipeline(
        Readable.fromWeb(packageResponse.body as never),
        new ByteLimitTransform(
          Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null,
          reportProgress
        ),
        createWriteStream(archivePath, { flags: "wx" }),
        { signal: options.signal }
      );
      await mkdir(extractedRoot, { recursive: true });
      await extract({
        cwd: extractedRoot,
        file: archivePath,
        strict: true,
        preservePaths: false,
        filter: (path) => {
          const normalized = normalizeArchivePath(path);
          return normalized === "" || isSafeRuntimeRelativePath(normalized);
        },
      });
      if (options.signal.aborted) throw options.signal.reason;
      const packagedManifest = await readRuntimeManifest(extractedRoot);
      if (!manifestsMatch(metadata.manifest, packagedManifest)) {
        throw new Error("Downloaded Runtime does not match the signed update manifest");
      }
      if (options.explicitRetry) {
        await this.options.store.clearFailedVersion(metadata.version);
      }
      const currentRuntime = this.options.getCurrentRuntime();
      if (currentRuntime) {
        await this.options.store.preserveRollbackCandidate(currentRuntime);
      }
      const runtime = await this.options.store.stageDownloadedRuntime(extractedRoot, {
        shellVersion: metadata.plannedShellVersion,
      });
      reportProgress(100);
      this.options.onUpdateReady?.(runtime);
      return runtime;
    } finally {
      await rm(workRoot, { recursive: true, force: true });
    }
  }

  async getState(): Promise<DesktopRuntimeUpdateState> {
    const pendingVersion = await this.getPendingVersion();
    const pendingReady = Boolean(pendingVersion) && this.status !== "checking";
    return {
      supported: Boolean(this.options.manifestUrl),
      currentVersion: this.options.getCurrentRuntime().manifest.runtimeVersion,
      latestVersion: pendingVersion ?? this.latestVersion,
      pendingVersion,
      lastCheckedAt: this.lastCheckedAt,
      status: pendingReady ? "ready" : this.status,
      errorSummary: pendingReady ? null : this.errorSummary,
      unsupportedReason: this.options.manifestUrl
        ? null
        : "No Product Runtime update channel is configured",
    };
  }

  private async performCheck(): Promise<RuntimeUpdateCheckResult> {
    const manifestUrl = this.options.manifestUrl as string;
    const fetchImpl = this.options.fetch ?? fetch;
    const manifestResponse = await fetchImpl(manifestUrl, { cache: "no-store" });
    if (!manifestResponse.ok) {
      throw new Error(`Product Runtime update check failed with ${manifestResponse.status}`);
    }
    const manifest = parseNetworkRuntimeManifest(await manifestResponse.json());
    this.options.store.assertManifestCompatible(manifest, true);
    this.latestVersion = manifest.runtimeVersion;
    const currentVersion = this.options.getCurrentRuntime().manifest.runtimeVersion;
    if (compareVersions(manifest.runtimeVersion, currentVersion) <= 0) return { status: "current" };
    if ((await this.options.store.readPendingVersion()) === manifest.runtimeVersion) {
      return { status: "already-staged" };
    }
    if ((await this.options.store.readFailedVersion()) === manifest.runtimeVersion) {
      return { status: "failed" };
    }
    const runtime = await this.downloadAndStage(
      {
        componentId: componentIdForManifest(manifest),
        manifestUrl,
        manifest,
        version: manifest.runtimeVersion,
        publishedAt: manifest.publishedAt,
        plannedShellVersion: manifest.minShellVersion,
      },
      {
        signal: new AbortController().signal,
        onProgress: () => {},
        explicitRetry: false,
      }
    );
    return { status: "ready", runtime };
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  private notifyStateChanged(): void {
    if (!this.options.onStateChanged) return;
    void this.getState()
      .then((state) => this.options.onStateChanged?.(state))
      .catch(() => {});
  }

  private getStatusForResult(result: RuntimeUpdateCheckResult): DesktopRuntimeUpdateStatus {
    switch (result.status) {
      case "disabled":
        return "disabled";
      case "current":
        return "current";
      case "already-staged":
      case "ready":
        return "ready";
      case "failed":
        return "quarantined";
    }
  }
}
