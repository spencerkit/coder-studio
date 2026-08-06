import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { access, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type EngineManifest,
  getEngineManifestSigningPayload,
  parseEngineManifest,
} from "../packages/desktop/src/engine-manifest.js";
import {
  DESKTOP_NODE_VERSION,
  getRuntimeManifestSigningPayload,
  parseRuntimeManifest,
} from "../packages/desktop/src/runtime-manifest.js";
import { runWslCommandChecked } from "../packages/desktop/src/wsl-command.js";
import { WslDiscovery } from "../packages/desktop/src/wsl-discovery.js";
import { buildDesktop } from "./build-desktop.js";
import { packageDesktop } from "./package-desktop.js";
import { prepareDesktopPackage } from "./prepare-desktop-package.js";
import { error, info, ROOT_DIR, step, success } from "./shared/index.js";
import { isDirectExecution, run } from "./shared/process.js";

const ACCEPTANCE_ROOT = resolve(ROOT_DIR, "release/wsl-acceptance");
const DOWNLOAD_ROOT = resolve(ACCEPTANCE_ROOT, "downloads");
const KEY_ROOT = resolve(ACCEPTANCE_ROOT, "keys");
const SOURCE_ROOT = resolve(ACCEPTANCE_ROOT, "sources");
const PRIVATE_KEY_PATH = resolve(KEY_ROOT, "runtime-private.pem");
const PUBLIC_KEY_PATH = resolve(KEY_ROOT, "runtime-public.pem");
const PNPM_VERSION = "10.28.0";
const DEFAULT_PORT = 8787;

export interface PrepareWslAcceptanceOptions {
  distro?: string;
  installer: boolean;
  port: number;
}

interface AcceptanceArtifact {
  channelManifest: string;
  packageFile: string;
  kind: "engine" | "runtime";
  platform: "linux" | "win32";
  arch: "x64" | "arm64";
}

interface AcceptanceReport {
  schemaVersion: 1;
  generatedAt: string;
  commit: string;
  distro: string;
  runtimeVersion: string;
  downloadBaseUrl: string;
  desktopExecutable: string;
  userDataDirectory: string;
  artifacts: AcceptanceArtifact[];
}

function readValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function parsePrepareWslAcceptanceArgs(argv: string[]): PrepareWslAcceptanceOptions {
  const options: PrepareWslAcceptanceOptions = {
    distro: undefined,
    installer: false,
    port: DEFAULT_PORT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--":
        break;
      case "--distro":
        options.distro = readValue(argv, ++index, "--distro").trim();
        if (!options.distro) throw new Error("--distro must not be empty");
        break;
      case "--installer":
        options.installer = true;
        break;
      case "--port": {
        const port = Number(readValue(argv, ++index, "--port"));
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          throw new Error("--port must be an integer between 1 and 65535");
        }
        options.port = port;
        break;
      }
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown WSL acceptance option: ${argument}`);
    }
  }
  return options;
}

function printUsage(): void {
  console.log(`Prepare a locally signed packaged Desktop and WSL download channel.

Usage:
  pnpm acceptance:wsl:prepare -- --distro Ubuntu-24.04 [--port 8787] [--installer]

The command builds committed HEAD in WSL, writes downloads under
release/wsl-acceptance/downloads, and creates a packaged Windows app.`);
}

async function capture(command: string, args: string[], cwd = ROOT_DIR): Promise<string> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectResult);
    child.once("close", (code) => {
      if (code === 0) {
        resolveResult(Buffer.concat(stdout).toString("utf8").trim());
      } else {
        rejectResult(
          new Error(
            `${command} exited with code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`
          )
        );
      }
    });
  });
}

async function assertCommittedHead(): Promise<string> {
  const status = await capture("git", ["status", "--porcelain", "--untracked-files=all"]);
  if (status) {
    throw new Error(
      "WSL acceptance builds committed HEAD for reproducibility. Commit or stash the working tree changes first."
    );
  }
  return capture("git", ["rev-parse", "HEAD"]);
}

export function createAcceptanceRuntimeVersion(baseVersion: string, commit: string): string {
  const normalizedVersion = baseVersion.trim();
  const normalizedCommit = commit.trim().toLowerCase();
  if (!normalizedVersion) throw new Error("Runtime base version must not be empty");
  if (!/^[a-f0-9]{7,64}$/.test(normalizedCommit)) throw new Error("Invalid Git commit hash");
  return `${normalizedVersion}-acceptance.${normalizedCommit.slice(0, 12)}`;
}

async function ensureSigningKeys(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  await mkdir(KEY_ROOT, { recursive: true });
  const [privateExists, publicExists] = await Promise.all([
    access(PRIVATE_KEY_PATH).then(
      () => true,
      () => false
    ),
    access(PUBLIC_KEY_PATH).then(
      () => true,
      () => false
    ),
  ]);
  if (privateExists !== publicExists) {
    throw new Error(`Incomplete WSL acceptance signing key pair under ${KEY_ROOT}`);
  }
  if (!privateExists) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    await Promise.all([
      writeFile(
        PRIVATE_KEY_PATH,
        privateKey.export({ format: "pem", type: "pkcs8" }) as string,
        "utf8"
      ),
      writeFile(
        PUBLIC_KEY_PATH,
        publicKey.export({ format: "pem", type: "spki" }) as string,
        "utf8"
      ),
    ]);
    info(`Generated reusable local acceptance keys under ${KEY_ROOT}`);
  }
  const [privateKeyPem, publicKeyPem] = await Promise.all([
    readFile(PRIVATE_KEY_PATH, "utf8"),
    readFile(PUBLIC_KEY_PATH, "utf8"),
  ]);
  return { privateKeyPem, publicKeyPem };
}

async function toWslPath(distro: string, windowsPath: string): Promise<string> {
  const result = await runWslCommandChecked([
    "--distribution",
    distro,
    "--exec",
    "wslpath",
    "--absolute",
    "--unix",
    windowsPath,
  ]);
  return result.stdout.toString("utf8").trim();
}

async function runWslBuild(
  distro: string,
  values: {
    sourceArchive: string;
    outputDirectory: string;
    privateKey: string;
    publicKey: string;
    runtimeVersion: string;
    commit: string;
  }
): Promise<void> {
  const shellScript = String.raw`
set -eu
source_archive=$1
output_directory=$2
private_key=$3
public_key=$4
runtime_version=$5
source_id=$6
node_version=$7
pnpm_version=$8

for required_command in curl tar xz sha256sum python3 make g++; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Missing WSL build dependency: $required_command" >&2
    echo "On Ubuntu/Debian run: sudo apt install build-essential python3 curl xz-utils" >&2
    exit 69
  fi
done

case "$(uname -m)" in
  x86_64) acceptance_arch=x64; node_arch=x64 ;;
  aarch64|arm64) acceptance_arch=arm64; node_arch=arm64 ;;
  *) echo "Unsupported WSL build architecture: $(uname -m)" >&2; exit 69 ;;
esac

cache_root="$HOME/.cache/coder-studio-wsl-acceptance"
node_root="$cache_root/tools/node-v$node_version-linux-$node_arch"
pnpm_root="$cache_root/tools/pnpm-$pnpm_version"
sources_root="$cache_root/sources"
source_root="$sources_root/$source_id"
mkdir -p "$cache_root/tools" "$sources_root" "$output_directory"

if ! test -x "$node_root/bin/node"; then
  node_staging="$cache_root/tools/.node-v$node_version-linux-$node_arch-$$"
  mkdir -p "$node_staging"
  node_archive="node-v$node_version-linux-$node_arch.tar.xz"
  node_base_url="https://nodejs.org/dist/v$node_version"
  curl -fsSL "$node_base_url/$node_archive" -o "$node_staging/$node_archive"
  curl -fsSL "$node_base_url/SHASUMS256.txt" -o "$node_staging/SHASUMS256.txt"
  (cd "$node_staging" && grep "  $node_archive$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p "$node_staging/runtime"
  tar -xJf "$node_staging/$node_archive" -C "$node_staging/runtime" --strip-components=1
  mv "$node_staging/runtime" "$node_root"
fi

if ! test -x "$pnpm_root/node_modules/.bin/pnpm"; then
  "$node_root/bin/npm" install --prefix "$pnpm_root" "pnpm@$pnpm_version"
fi
export PATH="$node_root/bin:$pnpm_root/node_modules/.bin:$PATH"

if ! test -f "$source_root/.acceptance-source-ready"; then
  source_staging="$sources_root/.staging-$source_id-$$"
  mkdir -p "$source_staging"
  tar -xf "$source_archive" -C "$source_staging"
  printf '%s\n' "$source_id" > "$source_staging/.acceptance-source-ready"
  mv "$source_staging" "$source_root"
fi

cd "$source_root"
export CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY="$(cat "$private_key")"
export CODER_STUDIO_RUNTIME_PUBLIC_KEY="$(cat "$public_key")"
export CODER_STUDIO_RUNTIME_VERSION="$runtime_version"
export CODER_STUDIO_DESKTOP_NODE_DIR="$node_root"

pnpm install --frozen-lockfile
pnpm build:wsl-engine
pnpm build:wsl-runtime

engine_manifest="release/engine/coder-studio-engine-linux-$acceptance_arch.manifest.json"
runtime_manifest="release/runtime/coder-studio-server-runtime-linux-$acceptance_arch.manifest.json"
engine_package=$(node -e 'process.stdout.write(require("./" + process.argv[1]).packageFile)' "$engine_manifest")
runtime_package=$(node -e 'process.stdout.write(require("./" + process.argv[1]).packageFile)' "$runtime_manifest")
cp "$engine_manifest" "$output_directory/"
cp "release/engine/$engine_package" "$output_directory/"
cp "$runtime_manifest" "$output_directory/"
cp "release/runtime/$runtime_package" "$output_directory/"
`;

  const child = spawn(
    "wsl.exe",
    [
      "--distribution",
      distro,
      "--exec",
      "/bin/sh",
      "-s",
      "--",
      values.sourceArchive,
      values.outputDirectory,
      values.privateKey,
      values.publicKey,
      values.runtimeVersion,
      values.commit,
      DESKTOP_NODE_VERSION,
      PNPM_VERSION,
    ],
    { windowsHide: true, stdio: ["pipe", "inherit", "inherit"] }
  );
  child.stdin.end(shellScript);
  await new Promise<void>((resolveResult, rejectResult) => {
    child.once("error", rejectResult);
    child.once("close", (code) => {
      if (code === 0) resolveResult();
      else rejectResult(new Error(`WSL acceptance build exited with code ${code}`));
    });
  });
}

function assertPackageFile(packageFile: string): void {
  if (!packageFile || packageFile.includes("/") || packageFile.includes("\\")) {
    throw new Error(`Unsafe acceptance package filename: ${packageFile}`);
  }
}

async function validateEngineArtifact(
  manifestName: string,
  publicKeyPem: string
): Promise<AcceptanceArtifact> {
  const manifest = parseEngineManifest(
    JSON.parse(await readFile(resolve(DOWNLOAD_ROOT, manifestName), "utf8"))
  );
  assertPackageFile(manifest.packageFile);
  if (
    manifest.platform !== "linux" ||
    !verify(
      null,
      getEngineManifestSigningPayload(manifest),
      publicKeyPem,
      Buffer.from(manifest.signature?.value ?? "", "base64")
    )
  ) {
    throw new Error("WSL Engine acceptance manifest has an invalid signature or target");
  }
  const packageBytes = await readFile(resolve(DOWNLOAD_ROOT, manifest.packageFile));
  const packageHash = createHash("sha256").update(packageBytes).digest("hex");
  if (packageHash !== manifest.packageSha256 || packageBytes.byteLength !== manifest.packageSize) {
    throw new Error("WSL Engine acceptance package does not match its manifest");
  }
  return {
    channelManifest: manifestName,
    packageFile: manifest.packageFile,
    kind: "engine",
    platform: "linux",
    arch: manifest.arch,
  };
}

async function validateRuntimeArtifact(
  manifestName: string,
  publicKeyPem: string,
  expected: { platform: "linux" | "win32"; runtimeVersion: string; web: boolean }
): Promise<AcceptanceArtifact> {
  const manifest = parseRuntimeManifest(
    JSON.parse(await readFile(resolve(DOWNLOAD_ROOT, manifestName), "utf8"))
  );
  if (!manifest.packageFile) throw new Error(`${manifestName} does not reference a package`);
  assertPackageFile(manifest.packageFile);
  if (
    manifest.platform !== expected.platform ||
    manifest.runtimeVersion !== expected.runtimeVersion ||
    Boolean(manifest.webRoot) !== expected.web ||
    !verify(
      null,
      getRuntimeManifestSigningPayload(manifest),
      publicKeyPem,
      Buffer.from(manifest.signature?.value ?? "", "base64")
    )
  ) {
    throw new Error(`${manifestName} has an invalid signature, version, or target`);
  }
  await stat(resolve(DOWNLOAD_ROOT, manifest.packageFile));
  return {
    channelManifest: manifestName,
    packageFile: manifest.packageFile,
    kind: "runtime",
    platform: expected.platform,
    arch: manifest.arch as "x64" | "arm64",
  };
}

async function copyWindowsRuntime(runtimeVersion: string): Promise<string> {
  const manifestName = `coder-studio-runtime-win32-${process.arch}.manifest.json`;
  const sourceManifest = resolve(ROOT_DIR, "release/runtime", manifestName);
  const manifest = parseRuntimeManifest(JSON.parse(await readFile(sourceManifest, "utf8")));
  if (manifest.runtimeVersion !== runtimeVersion || !manifest.packageFile) {
    throw new Error("Windows acceptance Runtime was built with an unexpected version");
  }
  await Promise.all([
    copyFile(sourceManifest, resolve(DOWNLOAD_ROOT, manifestName)),
    copyFile(
      resolve(ROOT_DIR, "release/runtime", manifest.packageFile),
      resolve(DOWNLOAD_ROOT, manifest.packageFile)
    ),
  ]);
  return manifestName;
}

async function readCliVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(resolve(ROOT_DIR, "packages/cli/package.json"), "utf8")
  ) as { version?: unknown };
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("Unable to resolve the CLI/Product Runtime version");
  }
  return manifest.version.trim();
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export async function prepareWslAcceptance(
  options: PrepareWslAcceptanceOptions
): Promise<AcceptanceReport> {
  if (process.platform !== "win32") {
    throw new Error("Local WSL acceptance preparation must run on Windows");
  }
  step("WSL ACCEPTANCE", "Preparing a signed local WSL download channel...\n");
  const commit = await assertCommittedHead();
  const discovery = new WslDiscovery();
  const distros = await discovery.listDistros();
  const distro = options.distro ?? distros[0];
  if (!distro) throw new Error("No WSL distribution is installed");
  if (!distros.includes(distro)) throw new Error(`WSL distribution is not installed: ${distro}`);
  const probe = await discovery.probe(distro);
  if (!probe.supported) throw new Error(probe.message ?? `${distro} is not supported`);

  const runtimeVersion = createAcceptanceRuntimeVersion(await readCliVersion(), commit);
  const { privateKeyPem, publicKeyPem } = await ensureSigningKeys();
  await Promise.all([
    mkdir(SOURCE_ROOT, { recursive: true }),
    rm(DOWNLOAD_ROOT, { recursive: true, force: true }).then(() =>
      mkdir(DOWNLOAD_ROOT, { recursive: true })
    ),
  ]);
  const sourceArchive = resolve(SOURCE_ROOT, `${commit}.tar`);
  await rm(sourceArchive, { force: true });
  await run("git", ["archive", "--format=tar", `--output=${sourceArchive}`, commit], {
    cwd: ROOT_DIR,
  });

  const [sourceArchiveWsl, downloadRootWsl, privateKeyWsl, publicKeyWsl] = await Promise.all([
    toWslPath(distro, sourceArchive),
    toWslPath(distro, DOWNLOAD_ROOT),
    toWslPath(distro, PRIVATE_KEY_PATH),
    toWslPath(distro, PUBLIC_KEY_PATH),
  ]);
  info(`Building Linux ${probe.arch} artifacts in ${distro}`);
  await runWslBuild(distro, {
    sourceArchive: sourceArchiveWsl,
    outputDirectory: downloadRootWsl,
    privateKey: privateKeyWsl,
    publicKey: publicKeyWsl,
    runtimeVersion,
    commit,
  });

  const runtimeUpdateUrl = `http://127.0.0.1:${options.port}/coder-studio-runtime-win32-${process.arch}.manifest.json`;
  const previousPrivateKey = process.env.CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY;
  const previousPublicKey = process.env.CODER_STUDIO_RUNTIME_PUBLIC_KEY;
  const previousUpdateUrl = process.env.CODER_STUDIO_RUNTIME_UPDATE_URL;
  const previousRuntimeVersion = process.env.CODER_STUDIO_RUNTIME_VERSION;
  process.env.CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY = privateKeyPem;
  process.env.CODER_STUDIO_RUNTIME_PUBLIC_KEY = publicKeyPem;
  process.env.CODER_STUDIO_RUNTIME_UPDATE_URL = runtimeUpdateUrl;
  process.env.CODER_STUDIO_RUNTIME_VERSION = runtimeVersion;
  try {
    info("Building the packaged Windows Desktop against the local acceptance channel");
    await buildDesktop();
    await prepareDesktopPackage();
    await packageDesktop({ unpacked: !options.installer });
  } finally {
    restoreEnvironment("CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY", previousPrivateKey);
    restoreEnvironment("CODER_STUDIO_RUNTIME_PUBLIC_KEY", previousPublicKey);
    restoreEnvironment("CODER_STUDIO_RUNTIME_UPDATE_URL", previousUpdateUrl);
    restoreEnvironment("CODER_STUDIO_RUNTIME_VERSION", previousRuntimeVersion);
  }

  const windowsRuntimeManifest = await copyWindowsRuntime(runtimeVersion);
  const engineManifest = `coder-studio-engine-linux-${probe.arch}.manifest.json`;
  const linuxRuntimeManifest = `coder-studio-server-runtime-linux-${probe.arch}.manifest.json`;
  const artifacts = await Promise.all([
    validateEngineArtifact(engineManifest, publicKeyPem),
    validateRuntimeArtifact(linuxRuntimeManifest, publicKeyPem, {
      platform: "linux",
      runtimeVersion,
      web: false,
    }),
    validateRuntimeArtifact(windowsRuntimeManifest, publicKeyPem, {
      platform: "win32",
      runtimeVersion,
      web: true,
    }),
  ]);
  const report: AcceptanceReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit,
    distro,
    runtimeVersion,
    downloadBaseUrl: `http://127.0.0.1:${options.port}/`,
    desktopExecutable: resolve(ROOT_DIR, "release/desktop/win-unpacked/Coder Studio.exe"),
    userDataDirectory: resolve(ACCEPTANCE_ROOT, "user-data"),
    artifacts,
  };
  await Promise.all([
    writeFile(
      resolve(ACCEPTANCE_ROOT, "acceptance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    ),
    writeFile(
      resolve(DOWNLOAD_ROOT, "acceptance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    ),
  ]);
  success(`WSL acceptance downloads are ready at ${DOWNLOAD_ROOT}`);
  console.log(
    `\nNext:\n  pnpm acceptance:wsl:serve\n\nThen launch:\n  & "${report.desktopExecutable}" "--user-data-dir=${report.userDataDirectory}"\n`
  );
  return report;
}

if (isDirectExecution(import.meta.url)) {
  prepareWslAcceptance(parsePrepareWslAcceptanceArgs(process.argv.slice(2))).catch(
    (prepareError) => {
      error(prepareError instanceof Error ? prepareError.message : String(prepareError));
      process.exit(1);
    }
  );
}
