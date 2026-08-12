import { createHash } from "node:crypto";
import {
  DESKTOP_ENGINE_VERSION,
  getRuntimeManifestSigningPayload,
  parseInstalledRuntimeManifest,
  type RuntimeManifest,
  verifyRuntimeManifestSignature,
} from "./runtime-manifest.js";
import { runWslCommand, runWslCommandChecked, type WslCommandRunner } from "./wsl-command.js";
import type { WslDistroProbe } from "./wsl-discovery.js";

interface RuntimePointer {
  id: string;
  runtimeVersion: string;
  installedAt: string;
}

export interface WslRuntimeCandidate {
  root: string;
  source: "active" | "pending";
  pointer: RuntimePointer;
  manifest: RuntimeManifest;
}

interface RawWslRuntimeCandidate {
  source: "pending" | "active" | "previous";
  pointer: RuntimePointer;
  manifest: unknown;
}

const LIST_CANDIDATES_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function validPointer(value) { return value && /^[a-f0-9]{24}$/.test(value.id) && typeof value.runtimeVersion === "string"; }
function readCandidate(pointer, source) {
  if (!validPointer(pointer)) return { source, pointer, manifest: null };
  const runtimeRoot = path.join(root, "runtime-store", "versions", pointer.id);
  const manifest = readJson(path.join(runtimeRoot, "manifest.json"));
  return { source, pointer, manifest };
}
const pendingPath = path.join(root, "runtime-store", "pending.json");
const activePath = path.join(root, "runtime-store", "active.json");
const activeState = readJson(activePath);
const candidates = [
  fs.existsSync(pendingPath) ? readCandidate(readJson(pendingPath), "pending") : null,
  activeState?.active ? readCandidate(activeState.active, "active") : null,
  activeState?.previous ? readCandidate(activeState.previous, "previous") : null,
].filter(Boolean);
process.stdout.write(JSON.stringify(candidates));
`;

const VERIFY_FILES_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = process.argv[1];
const id = process.argv[2];
const files = JSON.parse(process.argv[3]);
if (!/^[a-f0-9]{24}$/.test(id) || !Array.isArray(files)) throw new Error("Invalid Runtime verification request");
const runtimeRoot = path.join(root, "runtime-store", "versions", id);
function collect(directory, base = directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...collect(absolute, base));
    else if (entry.isFile()) result.push(path.relative(base, absolute).split(path.sep).join("/"));
    else throw new Error("Runtime contains unsupported filesystem entries");
  }
  return result.sort();
}
const expected = files.map((entry) => entry.path).sort();
const actual = collect(runtimeRoot).filter((entry) => entry !== "manifest.json");
if (expected.length !== actual.length || expected.some((entry, index) => entry !== actual[index])) {
  throw new Error("Runtime file set does not match its signed manifest");
}
for (const entry of files) {
  const bytes = fs.readFileSync(path.join(runtimeRoot, ...entry.path.split("/")));
  if (bytes.byteLength !== entry.size || crypto.createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
    throw new Error("Runtime file verification failed: " + entry.path);
  }
}
`;

const REMOVE_PENDING_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const pendingPath = path.join(process.argv[1], "runtime-store", "pending.json");
const expectedId = process.argv[2];
let current = null;
try { current = JSON.parse(fs.readFileSync(pendingPath, "utf8")); } catch {}
const validCurrent = current && /^[a-f0-9]{24}$/.test(current.id) && typeof current.runtimeVersion === "string";
if ((expectedId && current?.id === expectedId) || (!expectedId && !validCurrent)) {
  fs.rmSync(pendingPath, { force: true });
}
`;

const RESTORE_PREVIOUS_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];
const pointer = JSON.parse(process.argv[2]);
const activePath = path.join(root, "runtime-store", "active.json");
fs.writeFileSync(activePath + ".tmp", JSON.stringify({ active: pointer }, null, 2));
fs.renameSync(activePath + ".tmp", activePath);
`;

const MARK_SUCCESS_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];
const pointer = JSON.parse(process.argv[2]);
const source = process.argv[3];
const engineVersion = process.argv[4];
const runtimeRoot = path.join(root, "runtime-store");
const activePath = path.join(root, "runtime-store", "active.json");
let current = null;
try { current = JSON.parse(fs.readFileSync(activePath, "utf8")); } catch {}
let pending = null;
try { pending = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "pending.json"), "utf8")); } catch {}
if (source === "pending") {
  const next = { active: pointer };
  if (current?.active?.id && current.active.id !== pointer.id) next.previous = current.active;
  fs.writeFileSync(activePath + ".tmp", JSON.stringify(next, null, 2));
  fs.renameSync(activePath + ".tmp", activePath);
  current = next;
  if (pending?.id === pointer.id) {
    fs.rmSync(path.join(runtimeRoot, "pending.json"), { force: true });
    pending = null;
  }
  fs.rmSync(path.join(runtimeRoot, "failed.json"), { force: true });
}
const protectedRuntimeIds = new Set(
  [current?.active?.id, current?.previous?.id, pending?.id, pointer.id].filter(
    (id) => typeof id === "string" && /^[a-f0-9]{24}$/.test(id)
  )
);
try {
  const versionsRoot = path.join(root, "runtime-store", "versions");
  for (const entry of fs.readdirSync(versionsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !protectedRuntimeIds.has(entry.name)) {
      try { fs.rmSync(path.join(versionsRoot, entry.name), { recursive: true, force: true }); } catch {}
    }
  }
} catch {}
try {
  const engineVersionsRoot = path.join(root, "engine", "versions");
  for (const entry of fs.readdirSync(engineVersionsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== engineVersion) {
      try { fs.rmSync(path.join(engineVersionsRoot, entry.name), { recursive: true, force: true }); } catch {}
    }
  }
} catch {}
`;

const FALLBACK_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];
const failed = JSON.parse(process.argv[2]);
const runtimeRoot = path.join(root, "runtime-store");
fs.writeFileSync(path.join(runtimeRoot, "failed.json"), JSON.stringify({ runtimeVersion: failed.manifest.runtimeVersion, failedAt: new Date().toISOString(), error: process.argv[3] }, null, 2));
if (failed.source === "pending") {
  let pending = null;
  try { pending = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "pending.json"), "utf8")); } catch {}
  if (pending?.id === failed.pointer.id) {
    fs.rmSync(path.join(runtimeRoot, "pending.json"), { force: true });
  }
  process.exit(0);
}
const activePath = path.join(runtimeRoot, "active.json");
let active = null;
try { active = JSON.parse(fs.readFileSync(activePath, "utf8")); } catch {}
if (active?.previous) {
  fs.writeFileSync(activePath + ".tmp", JSON.stringify({ active: active.previous }, null, 2));
  fs.renameSync(activePath + ".tmp", activePath);
  process.exit(0);
}
fs.rmSync(activePath, { force: true });
`;

const READ_FAILED_VERSION_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];
let value = null;
try {
  const parsed = JSON.parse(fs.readFileSync(path.join(root, "runtime-store", "failed.json"), "utf8"));
  if (typeof parsed?.runtimeVersion === "string" && parsed.runtimeVersion.length > 0) {
    value = parsed.runtimeVersion;
  }
} catch {}
process.stdout.write(JSON.stringify(value));
`;

const READ_PENDING_VERSION_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];
let value = null;
try {
  const parsed = JSON.parse(fs.readFileSync(path.join(root, "runtime-store", "pending.json"), "utf8"));
  if (typeof parsed?.runtimeVersion === "string" && parsed.runtimeVersion.length > 0) {
    value = parsed.runtimeVersion;
  }
} catch {}
process.stdout.write(JSON.stringify(value));
`;

export class WslRuntimeStoreClient {
  constructor(
    private readonly options: {
      probe: WslDistroProbe;
      runner?: WslCommandRunner;
      publicKeyPem?: string;
    }
  ) {}

  private get nodePath(): string {
    return `${this.options.probe.dataRoot}/engine/versions/${DESKTOP_ENGINE_VERSION}/bin/node`;
  }

  private async execute(script: string, args: string[] = []): Promise<string> {
    const distro = this.options.probe.target.distro;
    if (!distro) throw new Error("WSL Runtime target has no distribution name");
    const result = await runWslCommandChecked(
      [
        "--distribution",
        distro,
        "--exec",
        this.nodePath,
        "-e",
        script,
        this.options.probe.dataRoot,
        ...args,
      ],
      undefined,
      this.options.runner ?? runWslCommand
    );
    return result.stdout.toString("utf8");
  }

  async getLaunchCandidate(
    options: { requiredRuntimeVersion?: string } = {}
  ): Promise<WslRuntimeCandidate> {
    const publicKeyPem = this.options.publicKeyPem?.trim();
    if (!publicKeyPem)
      throw new Error("WSL Runtime candidates require a trusted release public key");
    const values = JSON.parse(await this.execute(LIST_CANDIDATES_SCRIPT)) as unknown;
    if (!Array.isArray(values)) throw new Error("Invalid WSL Runtime candidate response");

    for (const value of values) {
      const candidate = value as Partial<RawWslRuntimeCandidate>;
      const source = candidate.source;
      const pointer = candidate.pointer;
      let manifest: RuntimeManifest;
      try {
        if (
          (source !== "pending" && source !== "active" && source !== "previous") ||
          !pointer ||
          !/^[a-f0-9]{24}$/.test(pointer.id) ||
          typeof pointer.runtimeVersion !== "string" ||
          typeof pointer.installedAt !== "string"
        ) {
          throw new Error("Invalid WSL Runtime candidate metadata");
        }
        manifest = parseInstalledRuntimeManifest(candidate.manifest);
        if (
          manifest.schemaVersion !== 2 ||
          manifest.runtimeVersion !== pointer.runtimeVersion ||
          manifest.platform !== "linux" ||
          manifest.arch !== this.options.probe.arch ||
          !verifyRuntimeManifestSignature(manifest, publicKeyPem)
        ) {
          throw new Error("WSL Runtime manifest is untrusted or incompatible with its pointer");
        }
        const expectedId = createHash("sha256")
          .update(getRuntimeManifestSigningPayload(manifest))
          .digest("hex")
          .slice(0, 24);
        if (pointer.id !== expectedId)
          throw new Error("WSL Runtime pointer does not match its manifest");
      } catch {
        if (source === "pending") {
          const expectedId = pointer && /^[a-f0-9]{24}$/.test(pointer.id) ? pointer.id : "";
          await this.execute(REMOVE_PENDING_SCRIPT, [expectedId]).catch(() => undefined);
        }
        continue;
      }

      if (
        options.requiredRuntimeVersion &&
        manifest.runtimeVersion !== options.requiredRuntimeVersion
      ) {
        continue;
      }
      try {
        await this.execute(VERIFY_FILES_SCRIPT, [pointer.id, JSON.stringify(manifest.files)]);
      } catch {
        if (source === "pending") {
          await this.execute(REMOVE_PENDING_SCRIPT, [pointer.id]).catch(() => undefined);
        }
        continue;
      }
      if (source === "previous") {
        await this.execute(RESTORE_PREVIOUS_SCRIPT, [JSON.stringify(pointer)]);
      }
      return {
        root: `${this.options.probe.dataRoot.replace(/\/+$/, "")}/runtime-store/versions/${pointer.id}`,
        source: source === "pending" ? "pending" : "active",
        pointer,
        manifest,
      };
    }

    const suffix = options.requiredRuntimeVersion
      ? ` matching shared Web ${options.requiredRuntimeVersion}`
      : "";
    throw new Error(`No trusted WSL Server Runtime${suffix} is installed`);
  }

  async markLaunchSuccessful(candidate: WslRuntimeCandidate): Promise<void> {
    await this.execute(MARK_SUCCESS_SCRIPT, [
      JSON.stringify(candidate.pointer),
      candidate.source,
      DESKTOP_ENGINE_VERSION,
    ]);
  }

  async fallbackAfterFailure(candidate: WslRuntimeCandidate, error: unknown): Promise<void> {
    await this.execute(FALLBACK_SCRIPT, [
      JSON.stringify(candidate),
      error instanceof Error ? error.message : String(error),
    ]);
  }

  async readFailedVersion(): Promise<string | null> {
    try {
      const value = JSON.parse(await this.execute(READ_FAILED_VERSION_SCRIPT)) as unknown;
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  async readPendingVersion(): Promise<string | null> {
    try {
      const value = JSON.parse(await this.execute(READ_PENDING_VERSION_SCRIPT)) as unknown;
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }
}
