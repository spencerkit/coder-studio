import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extract } from "tar";
import {
  compareVersions,
  getRuntimeManifestSigningPayload,
  isSafeRuntimeRelativePath,
  parseRuntimeManifest,
  type RuntimeManifest,
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
  checkIntervalMs?: number;
  fetch?: typeof fetch;
}

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_RUNTIME_PACKAGE_BYTES = 300 * 1024 * 1024;

class ByteLimitTransform extends Transform {
  private total = 0;

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

export class ProductRuntimeUpdateManager {
  private timer: NodeJS.Timeout | null = null;
  private checkPromise: Promise<RuntimeUpdateCheckResult> | null = null;

  constructor(private readonly options: RuntimeUpdateManagerOptions) {}

  start(): void {
    if (!this.options.manifestUrl) return;
    void this.check().catch((error) => this.reportError(error));
    this.timer = setInterval(
      () => void this.check().catch((error) => this.reportError(error)),
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
    this.checkPromise ??= this.performCheck().finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  getPendingVersion(): Promise<string | null> {
    return this.options.store.readPendingVersion();
  }

  private async performCheck(): Promise<RuntimeUpdateCheckResult> {
    const manifestUrl = this.options.manifestUrl as string;
    const fetchImpl = this.options.fetch ?? fetch;
    const manifestResponse = await fetchImpl(manifestUrl, { cache: "no-store" });
    if (!manifestResponse.ok) {
      throw new Error(`Product Runtime update check failed with ${manifestResponse.status}`);
    }
    const manifest = parseRuntimeManifest(await manifestResponse.json());
    this.options.store.assertManifestCompatible(manifest, true);
    const currentVersion = this.options.getCurrentRuntime().manifest.runtimeVersion;
    if (compareVersions(manifest.runtimeVersion, currentVersion) <= 0) return { status: "current" };
    if ((await this.options.store.readPendingVersion()) === manifest.runtimeVersion) {
      return { status: "already-staged" };
    }
    if ((await this.options.store.readFailedVersion()) === manifest.runtimeVersion) {
      return { status: "failed" };
    }
    if (!manifest.packageFile) throw new Error("Runtime update manifest has no package file");

    const packageUrl = new URL(manifest.packageFile, manifestUrl).toString();
    const workRoot = await mkdtemp(resolve(this.options.store.downloadsRoot, "runtime-update-"));
    const archivePath = resolve(workRoot, "runtime.tgz");
    const extractedRoot = resolve(workRoot, "payload");
    try {
      const packageResponse = await fetchImpl(packageUrl, { cache: "no-store" });
      if (!packageResponse.ok || !packageResponse.body) {
        throw new Error(`Product Runtime download failed with ${packageResponse.status}`);
      }
      const contentLength = Number(packageResponse.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_RUNTIME_PACKAGE_BYTES) {
        throw new Error("Product Runtime package exceeds the download limit");
      }
      await pipeline(
        Readable.fromWeb(packageResponse.body as never),
        new ByteLimitTransform(),
        createWriteStream(archivePath, { flags: "wx" })
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
      const packagedManifest = await readRuntimeManifest(extractedRoot);
      if (!manifestsMatch(manifest, packagedManifest)) {
        throw new Error("Downloaded Runtime does not match the signed update manifest");
      }
      const runtime = await this.options.store.stageDownloadedRuntime(extractedRoot);
      this.options.onUpdateReady?.(runtime);
      return { status: "ready", runtime };
    } finally {
      await rm(workRoot, { recursive: true, force: true });
    }
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}
