import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { create, extract } from "tar";
import {
  type EngineManifest,
  parseEngineManifest,
  verifyEngineManifestSignature,
} from "./engine-manifest.js";
import type { ProductChannelRuntime } from "./product-channel.js";
import { assertSafeReleaseAssetName, resolveVersionedReleaseAsset } from "./release-channel.js";
import {
  API_PROTOCOL_VERSION,
  compareVersions,
  DATA_SCHEMA_VERSION,
  DESKTOP_ENGINE_VERSION,
  getRuntimeManifestSigningPayload,
  hashRuntimeFile,
  isSafeRuntimeRelativePath,
  parseInstalledRuntimeManifest,
  parseNetworkRuntimeManifest,
  RUNTIME_HOST_API_VERSION,
  type RuntimeFileEntry,
  type RuntimeManifest,
  type RuntimeManifestV2,
  verifyRuntimeManifestSignature,
} from "./runtime-manifest.js";
import { runWslCommand, runWslCommandChecked, type WslCommandRunner } from "./wsl-command.js";
import type { WslDistroProbe } from "./wsl-discovery.js";
import { WslRuntimeStoreClient } from "./wsl-runtime-store.js";

export interface WslInstalledRuntime {
  engineRoot: string;
  runtimeRoot: string;
  manifest: RuntimeManifest;
}

export interface WslInstallProgress {
  phase: "checking" | "downloading" | "installing" | "verifying";
  message: string;
  percent?: number;
}

export interface WslInstallerOptions {
  publicKeyPem: string;
  shellVersion: string;
  nodeVersion: string;
  runtimeVersion: string;
  engineManifestUrl: (arch: "x64" | "arm64") => string;
  runtimeManifestUrl: (arch: "x64" | "arm64") => string;
  productChannelUrl?: string;
  factoryEngineManifestUrl?: (arch: "x64" | "arm64") => string;
  factoryRuntimeManifestUrl?: (arch: "x64" | "arm64") => string;
  fetch?: typeof fetch;
  runner?: WslCommandRunner;
  onProgress?: (progress: WslInstallProgress) => void;
}

export interface WslRuntimeUpdateMetadata {
  componentId: "runtime:linux-x64";
  manifestUrl: string;
  manifest: RuntimeManifestV2;
  version: string;
  publishedAt: string;
  plannedShellVersion: string;
  probe: WslDistroProbe;
  engineManifestUrl: string;
  engineManifest: EngineManifest | null;
}

export interface WslRuntimeDownloadOptions {
  signal: AbortSignal;
  onProgress: (percent: number) => void;
  explicitRetry: boolean;
}

const MAX_ENGINE_PACKAGE_BYTES = 500 * 1024 * 1024;
const MAX_RUNTIME_PACKAGE_BYTES = 300 * 1024 * 1024;

export const WSL_INSTALL_SCRIPT = [
  "set -eu",
  "root=$1; kind=$2; version=$3; id=$4",
  'mkdir -p "$root"',
  'lock="$root/install.lock"',
  'started="$(cut -d " " -f 22 /proc/$$/stat)"',
  'if test -z "$started"; then echo "Unable to identify the WSL installer process" >&2; exit 74; fi',
  'owner="$$-$started-$kind-$id"',
  'owner_file="$root/.install.lock.owner.$owner"',
  "read_lock() {",
  '  lock_pid=""; lock_started=""; lock_owner=""',
  '  if test -d "$lock"; then',
  '    lock_pid="$(cat "$lock/pid" 2>/dev/null || true)"',
  '    lock_started="$(cat "$lock/started" 2>/dev/null || true)"',
  '    lock_owner="$(cat "$lock/owner" 2>/dev/null || true)"',
  '  elif test -f "$lock"; then',
  '    lock_pid="$(sed -n \'1s/^pid=//p\' "$lock" 2>/dev/null || true)"',
  '    lock_started="$(sed -n \'2s/^started=//p\' "$lock" 2>/dev/null || true)"',
  '    lock_owner="$(sed -n \'3s/^owner=//p\' "$lock" 2>/dev/null || true)"',
  "  fi",
  "}",
  "cleanup_lock() {",
  "  read_lock",
  '  if test "$lock_owner" = "$owner"; then',
  '    if test -d "$lock"; then rm -rf "$lock"; else rm -f "$lock"; fi',
  "  fi",
  '  rm -f "$owner_file"',
  "}",
  "trap cleanup_lock EXIT INT TERM",
  'printf "pid=%s\\nstarted=%s\\nowner=%s\\n" "$$" "$started" "$owner" > "$owner_file"',
  "acquired=0",
  'if ln "$owner_file" "$lock" 2>/dev/null; then',
  "  acquired=1",
  "else",
  "  read_lock",
  '  if test -d "$lock" && { test -z "$lock_pid" || test -z "$lock_started"; }; then',
  "    sleep 1",
  "    read_lock",
  "  fi",
  '  current_started=""',
  '  case "$lock_pid" in ""|*[!0-9]*) ;; *) current_started="$(cut -d " " -f 22 "/proc/$lock_pid/stat" 2>/dev/null || true)" ;; esac',
  '  if test -n "$lock_started" && test "$lock_started" = "$current_started"; then',
  '    echo "Coder Studio environment installation is already running" >&2',
  "    exit 73",
  "  fi",
  '  stale="$root/.install.lock.stale.$owner"',
  '  rm -rf "$stale"',
  '  if mv "$lock" "$stale" 2>/dev/null; then',
  '    rm -rf "$stale"',
  '    if ln "$owner_file" "$lock" 2>/dev/null; then acquired=1; fi',
  "  fi",
  "fi",
  'if test "$acquired" != 1; then echo "Coder Studio environment installation is already running" >&2; exit 73; fi',
  'rm -f "$owner_file"',
  'versions="$root/$kind/versions"',
  'staging="$versions/.staging-$id"',
  'destination="$versions/$id"',
  'mkdir -p "$versions"',
  'rm -rf "$staging"',
  'mkdir -p "$staging"',
  'tar -xzf - -C "$staging"',
  'if test -e "$destination"; then rm -rf "$staging"; else mv "$staging" "$destination"; fi',
  'if test "$kind" = runtime-store; then',
  '  rm -f "$root/runtime-store/failed.json"',
  '  printf \'{"id":"%s","runtimeVersion":"%s","installedAt":"%s"}\\n\' "$id" "$version" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$root/runtime-store/pending.json.tmp"',
  '  mv "$root/runtime-store/pending.json.tmp" "$root/runtime-store/pending.json"',
  "fi",
  'chmod -R u+rwX,go-rwx "$destination"',
  'if test "$kind" = engine; then',
  '  find "$destination/bin" -type f -exec chmod u+x {} +',
  '  if test -d "$destination/node_modules/.bin"; then find "$destination/node_modules/.bin" -type f -exec chmod u+x {} +; fi',
  '  find "$destination/node_modules/node-pty" -type f -name spawn-helper -exec chmod u+x {} + 2>/dev/null || true',
  "fi",
].join("\n");

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(root, path)));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    else throw new Error(`Package contains unsupported filesystem entry: ${entry.name}`);
  }
  return files.sort();
}

function normalizeArchivePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

async function download(
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<Buffer> {
  const response = await fetchImpl(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Download failed with status ${response.status}: ${url}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("Download exceeds the configured size limit");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("Download exceeds the configured size limit");
  return bytes;
}

async function assertFileEntries(root: string, entries: RuntimeFileEntry[]): Promise<void> {
  const actualFiles = await collectFiles(root);
  const expectedFiles = entries.map((entry) => entry.path).sort();
  if (
    actualFiles.length !== expectedFiles.length ||
    actualFiles.some((path, index) => path !== expectedFiles[index])
  ) {
    throw new Error("Downloaded package file set does not match its signed manifest");
  }
  for (const entry of entries) {
    const actual = await hashRuntimeFile(resolve(root, ...entry.path.split("/")));
    if (actual.sha256 !== entry.sha256 || actual.size !== entry.size) {
      throw new Error(`Downloaded package verification failed: ${entry.path}`);
    }
  }
}

async function extractArchive(archive: Buffer, workRoot: string): Promise<string> {
  const archivePath = resolve(workRoot, "download.tgz");
  const payloadRoot = resolve(workRoot, "payload");
  await mkdir(payloadRoot, { recursive: true });
  await writeFile(archivePath, archive);
  await extract({
    cwd: payloadRoot,
    file: archivePath,
    strict: true,
    preservePaths: false,
    filter: (path) => {
      const normalized = normalizeArchivePath(path);
      return !normalized || isSafeRuntimeRelativePath(normalized);
    },
  });
  return payloadRoot;
}

async function repackValidatedPayload(root: string, files: string[]): Promise<Buffer> {
  const archivePath = resolve(root, "..", "validated.tgz");
  await create({ cwd: root, file: archivePath, gzip: true, portable: true }, files);
  return readFile(archivePath);
}

function manifestsMatch(expected: RuntimeManifest, actual: RuntimeManifest): boolean {
  return (
    getRuntimeManifestSigningPayload(expected).equals(getRuntimeManifestSigningPayload(actual)) &&
    expected.signature?.algorithm === actual.signature?.algorithm &&
    expected.signature?.value === actual.signature?.value
  );
}

async function validateRuntimePackage(
  archive: Buffer,
  expectedManifest: RuntimeManifest,
  options: WslInstallerOptions,
  probe: WslDistroProbe,
  workRoot: string
): Promise<Buffer> {
  const payloadRoot = await extractArchive(archive, workRoot);
  const embeddedManifest = parseInstalledRuntimeManifest(
    JSON.parse(await readFile(resolve(payloadRoot, "manifest.json"), "utf8"))
  );
  if (!manifestsMatch(expectedManifest, embeddedManifest)) {
    throw new Error("Downloaded Runtime manifest does not match the signed channel manifest");
  }
  if (!verifyRuntimeManifestSignature(embeddedManifest, options.publicKeyPem)) {
    throw new Error("Downloaded Runtime signature is invalid");
  }
  if (embeddedManifest.platform !== "linux" || embeddedManifest.arch !== probe.arch) {
    throw new Error("Downloaded Runtime target is incompatible with the WSL distribution");
  }
  if (embeddedManifest.webRoot) {
    throw new Error("WSL Server Runtime must not contain the shared Web payload");
  }
  if (
    embeddedManifest.requiredEngineVersion !== DESKTOP_ENGINE_VERSION ||
    embeddedManifest.requiredNodeVersion !== options.nodeVersion ||
    embeddedManifest.runtimeHostApiVersion !== RUNTIME_HOST_API_VERSION ||
    embeddedManifest.apiProtocolVersion !== API_PROTOCOL_VERSION ||
    embeddedManifest.dataSchemaVersion !== DATA_SCHEMA_VERSION
  ) {
    throw new Error("Downloaded Runtime is incompatible with the Desktop host");
  }
  const allEntries: RuntimeFileEntry[] = [
    ...embeddedManifest.files,
    {
      path: "manifest.json",
      ...(await hashRuntimeFile(resolve(payloadRoot, "manifest.json"))),
    },
  ];
  await assertFileEntries(payloadRoot, allEntries);
  return repackValidatedPayload(
    payloadRoot,
    allEntries.map((entry) => entry.path)
  );
}

async function validateEnginePackage(
  archive: Buffer,
  manifest: EngineManifest,
  workRoot: string
): Promise<Buffer> {
  const archiveHash = createHash("sha256").update(archive).digest("hex");
  if (archiveHash !== manifest.packageSha256 || archive.byteLength !== manifest.packageSize) {
    throw new Error("Downloaded Engine archive does not match its signed manifest");
  }
  const payloadRoot = await extractArchive(archive, workRoot);
  await assertFileEntries(payloadRoot, manifest.files);
  const nodeRelativePath = "bin/node";
  if (!manifest.files.some((entry) => entry.path === nodeRelativePath)) {
    throw new Error("Downloaded Engine does not contain its Node executable");
  }
  return repackValidatedPayload(
    payloadRoot,
    manifest.files.map((entry) => entry.path)
  );
}

async function installArchive(
  distro: string,
  dataRoot: string,
  kind: "engine" | "runtime-store",
  version: string,
  id: string,
  archive: Buffer,
  runner: WslCommandRunner
): Promise<void> {
  await runWslCommandChecked(
    [
      "--distribution",
      distro,
      "--exec",
      "/bin/sh",
      "-c",
      WSL_INSTALL_SCRIPT,
      "coder-studio-install",
      dataRoot,
      kind,
      version,
      id,
    ],
    archive,
    runner
  );
}

export class WslInstaller {
  constructor(private readonly options: WslInstallerOptions) {}

  async checkRuntime(
    probe: WslDistroProbe,
    expected: ProductChannelRuntime,
    plannedShellVersion: string,
    releaseTag: string
  ): Promise<WslRuntimeUpdateMetadata> {
    return this.loadMetadata(probe, plannedShellVersion, expected, releaseTag);
  }

  async downloadAndStageRuntime(
    metadata: WslRuntimeUpdateMetadata,
    options: WslRuntimeDownloadOptions
  ): Promise<WslInstalledRuntime> {
    const { probe, engineManifest, manifest: runtimeManifest } = metadata;
    if (!probe.supported) throw new Error(probe.message ?? "Unsupported WSL distribution");
    const distro = probe.target.distro;
    if (!distro) throw new Error("The WSL target has no distribution name");
    const fetchImpl = this.options.fetch ?? fetch;
    const runner = this.options.runner ?? runWslCommand;
    if (probe.engineInstalled) {
      const failedVersion = await new WslRuntimeStoreClient({ probe, runner }).readFailedVersion();
      if (failedVersion === metadata.version && !options.explicitRetry) {
        throw new Error(
          `WSL Runtime ${metadata.version} was quarantined; an explicit retry is required`
        );
      }
    }
    if (options.signal.aborted) throw this.abortError(options.signal);

    const report = (phase: WslInstallProgress["phase"], message: string, percent: number) => {
      options.onProgress(percent);
      this.options.onProgress?.({ phase, message, percent });
    };
    report(
      "downloading",
      probe.engineInstalled
        ? "Downloading WSL Server Runtime…"
        : "Downloading WSL Engine and Server Runtime…",
      10
    );
    const enginePackageUrl = engineManifest
      ? new URL(engineManifest.packageFile, metadata.engineManifestUrl).toString()
      : null;
    if (!runtimeManifest.packageFile) throw new Error("WSL Runtime manifest has no package file");
    const runtimePackageUrl = new URL(runtimeManifest.packageFile, metadata.manifestUrl).toString();
    const [engineArchive, runtimeArchive] = await Promise.all([
      enginePackageUrl
        ? download(enginePackageUrl, MAX_ENGINE_PACKAGE_BYTES, fetchImpl, options.signal)
        : Promise.resolve(null),
      download(runtimePackageUrl, MAX_RUNTIME_PACKAGE_BYTES, fetchImpl, options.signal),
    ]);
    if (options.signal.aborted) throw this.abortError(options.signal);

    const workRoot = await mkdtemp(resolve(tmpdir(), "coder-studio-wsl-install-"));
    try {
      report("verifying", "Verifying WSL packages…", 45);
      const engineWorkRoot = resolve(workRoot, "engine");
      const runtimeWorkRoot = resolve(workRoot, "runtime");
      await Promise.all([
        writeFile(resolve(workRoot, ".keep"), ""),
        rm(engineWorkRoot, { recursive: true, force: true }),
        rm(runtimeWorkRoot, { recursive: true, force: true }),
      ]);
      await Promise.all([
        ...(engineArchive ? [mkdir(engineWorkRoot, { recursive: true })] : []),
        mkdir(runtimeWorkRoot, { recursive: true }),
      ]);
      const [validatedEngine, validatedRuntime] = await Promise.all([
        engineArchive && engineManifest
          ? validateEnginePackage(engineArchive, engineManifest, engineWorkRoot)
          : Promise.resolve(null),
        validateRuntimePackage(
          runtimeArchive,
          runtimeManifest,
          this.options,
          probe,
          runtimeWorkRoot
        ),
      ]);
      const runtimeId = createHash("sha256")
        .update(getRuntimeManifestSigningPayload(runtimeManifest))
        .digest("hex")
        .slice(0, 24);
      if (options.signal.aborted) throw this.abortError(options.signal);

      if (validatedEngine && engineManifest) {
        report("installing", "Installing WSL Engine…", 65);
        await installArchive(
          distro,
          probe.dataRoot,
          "engine",
          engineManifest.engineVersion,
          engineManifest.engineVersion,
          validatedEngine,
          runner
        );
      }
      report("installing", "Installing WSL Server Runtime…", 85);
      await installArchive(
        distro,
        probe.dataRoot,
        "runtime-store",
        runtimeManifest.runtimeVersion,
        runtimeId,
        validatedRuntime,
        runner
      );
      report("verifying", "WSL environment is ready.", 100);
      return {
        engineRoot: `${probe.dataRoot}/engine/versions/${DESKTOP_ENGINE_VERSION}`,
        runtimeRoot: `${probe.dataRoot}/runtime-store/versions/${runtimeId}`,
        manifest: runtimeManifest,
      };
    } finally {
      await rm(workRoot, { recursive: true, force: true });
    }
  }

  async prepare(probe: WslDistroProbe): Promise<WslInstalledRuntime> {
    const metadata = await this.loadMetadata(probe, this.options.shellVersion);
    if (metadata.version !== this.options.runtimeVersion) {
      throw new Error(
        `WSL Runtime ${metadata.version} does not match shared Web ${this.options.runtimeVersion}`
      );
    }
    return this.downloadAndStageRuntime(metadata, {
      signal: new AbortController().signal,
      onProgress: () => {},
      explicitRetry: false,
    });
  }

  private async loadMetadata(
    probe: WslDistroProbe,
    plannedShellVersion: string,
    expected?: Omit<ProductChannelRuntime, "manifestSha256"> & { manifestSha256?: string },
    releaseTag?: string
  ): Promise<WslRuntimeUpdateMetadata> {
    if (!probe.supported) throw new Error(probe.message ?? "Unsupported WSL distribution");
    if (!probe.target.distro) throw new Error("The WSL target has no distribution name");
    if (!this.options.publicKeyPem.trim()) {
      throw new Error("WSL Runtime installation requires a trusted release public key");
    }
    const fetchImpl = this.options.fetch ?? fetch;
    this.options.onProgress?.({ phase: "checking", message: "Checking WSL Runtime manifests…" });
    const configuredEngineManifestUrl = expected
      ? this.options.engineManifestUrl(probe.arch)
      : (this.options.factoryEngineManifestUrl?.(probe.arch) ??
        this.options.engineManifestUrl(probe.arch));
    const configuredRuntimeManifestUrl = expected
      ? this.options.runtimeManifestUrl(probe.arch)
      : (this.options.factoryRuntimeManifestUrl?.(probe.arch) ??
        this.options.runtimeManifestUrl(probe.arch));
    if (expected) assertSafeReleaseAssetName(expected.manifest);
    const usesProductChannel = Boolean(expected && this.options.productChannelUrl);
    if (usesProductChannel && (!releaseTag || !expected?.manifestSha256)) {
      throw new Error("Signed Product channel WSL Runtime identity is incomplete");
    }
    const runtimeManifestUrl = usesProductChannel
      ? resolveVersionedReleaseAsset(
          this.options.productChannelUrl as string,
          releaseTag as string,
          expected?.manifest as string
        )
      : expected
        ? new URL(expected.manifest, configuredRuntimeManifestUrl).toString()
        : configuredRuntimeManifestUrl;
    const [engineManifestResponse, runtimeManifestResponse] = await Promise.all([
      probe.engineInstalled
        ? Promise.resolve(null)
        : fetchImpl(configuredEngineManifestUrl, { cache: "no-store" }),
      fetchImpl(runtimeManifestUrl, { cache: "no-store" }),
    ]);
    if (engineManifestResponse && !engineManifestResponse.ok) {
      throw new Error(`Engine manifest check failed with ${engineManifestResponse.status}`);
    }
    if (!runtimeManifestResponse.ok) {
      throw new Error(`Runtime manifest check failed with ${runtimeManifestResponse.status}`);
    }
    const engineManifest = engineManifestResponse
      ? parseEngineManifest(await engineManifestResponse.json())
      : null;
    const runtimeManifestText = await runtimeManifestResponse.text();
    if (
      usesProductChannel &&
      createHash("sha256").update(runtimeManifestText).digest("hex") !== expected?.manifestSha256
    ) {
      throw new Error("WSL Runtime manifest digest does not match signed Product channel");
    }
    const runtimeManifest = parseNetworkRuntimeManifest(JSON.parse(runtimeManifestText));
    if (
      engineManifest &&
      !verifyEngineManifestSignature(engineManifest, this.options.publicKeyPem)
    ) {
      throw new Error("WSL Engine manifest signature is invalid");
    }
    if (!verifyRuntimeManifestSignature(runtimeManifest, this.options.publicKeyPem)) {
      throw new Error("WSL Runtime manifest signature is invalid");
    }
    if (
      expected &&
      (runtimeManifest.runtimeVersion !== expected.version ||
        runtimeManifest.publishedAt !== expected.publishedAt)
    ) {
      throw new Error(
        `WSL Runtime manifest does not match signed ${usesProductChannel ? "Product" : "Desktop"} channel`
      );
    }
    if (
      engineManifest &&
      (engineManifest.arch !== probe.arch ||
        engineManifest.nodeVersion !== this.options.nodeVersion)
    ) {
      throw new Error("WSL Engine manifest is incompatible with the selected distribution");
    }
    if (engineManifest && engineManifest.engineVersion !== DESKTOP_ENGINE_VERSION) {
      throw new Error(`WSL Engine ${engineManifest.engineVersion} is incompatible`);
    }
    if (compareVersions(plannedShellVersion, runtimeManifest.minShellVersion) < 0) {
      throw new Error(`WSL Runtime requires Desktop ${runtimeManifest.minShellVersion} or newer`);
    }
    if (
      runtimeManifest.platform !== "linux" ||
      runtimeManifest.arch !== probe.arch ||
      runtimeManifest.webRoot ||
      runtimeManifest.requiredEngineVersion !== DESKTOP_ENGINE_VERSION ||
      runtimeManifest.requiredNodeVersion !== this.options.nodeVersion ||
      runtimeManifest.runtimeHostApiVersion !== RUNTIME_HOST_API_VERSION ||
      runtimeManifest.apiProtocolVersion !== API_PROTOCOL_VERSION ||
      runtimeManifest.dataSchemaVersion !== DATA_SCHEMA_VERSION
    ) {
      throw new Error("WSL Runtime manifest is incompatible with the Desktop host");
    }
    return {
      componentId: "runtime:linux-x64",
      manifestUrl: runtimeManifestUrl,
      manifest: runtimeManifest,
      version: runtimeManifest.runtimeVersion,
      publishedAt: runtimeManifest.publishedAt,
      plannedShellVersion,
      probe,
      engineManifestUrl: configuredEngineManifestUrl,
      engineManifest,
    };
  }

  private abortError(signal: AbortSignal): Error {
    if (signal.reason instanceof Error) return signal.reason;
    return Object.assign(new Error("WSL Runtime download was cancelled"), {
      name: "AbortError",
    });
  }
}
