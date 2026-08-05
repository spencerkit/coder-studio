import type { RuntimeManifest } from "./runtime-manifest.js";
import { DESKTOP_ENGINE_VERSION } from "./runtime-manifest.js";
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

const GET_CANDIDATE_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = process.argv[1];
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function validPointer(value) { return value && /^[a-f0-9]{24}$/.test(value.id) && typeof value.runtimeVersion === "string"; }
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
function resolveCandidate(pointer, source) {
  if (!validPointer(pointer)) return null;
  const runtimeRoot = path.join(root, "runtime-store", "versions", pointer.id);
  const manifest = readJson(path.join(runtimeRoot, "manifest.json"));
  if (!manifest || manifest.runtimeVersion !== pointer.runtimeVersion || manifest.platform !== "linux" || manifest.arch !== process.arch) return null;
  const expected = manifest.files.map((entry) => entry.path).sort();
  const actual = collect(runtimeRoot).filter((entry) => entry !== "manifest.json");
  if (expected.length !== actual.length || expected.some((entry, index) => entry !== actual[index])) return null;
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(runtimeRoot, ...entry.path.split("/")));
    if (bytes.byteLength !== entry.size || crypto.createHash("sha256").update(bytes).digest("hex") !== entry.sha256) return null;
  }
  return { root: runtimeRoot, source, pointer, manifest };
}
const pendingPath = path.join(root, "runtime-store", "pending.json");
const pending = resolveCandidate(readJson(pendingPath), "pending");
if (pending) { process.stdout.write(JSON.stringify(pending)); process.exit(0); }
try { fs.rmSync(pendingPath, { force: true }); } catch {}
const activePath = path.join(root, "runtime-store", "active.json");
const activeState = readJson(activePath);
const active = resolveCandidate(activeState?.active, "active");
if (active) { process.stdout.write(JSON.stringify(active)); process.exit(0); }
const previous = resolveCandidate(activeState?.previous, "active");
if (previous) {
  fs.writeFileSync(activePath + ".tmp", JSON.stringify({ active: previous.pointer }, null, 2));
  fs.renameSync(activePath + ".tmp", activePath);
  process.stdout.write(JSON.stringify(previous));
  process.exit(0);
}
process.stderr.write("No valid WSL Server Runtime is installed");
process.exit(2);
`;

const MARK_SUCCESS_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];
const pointer = JSON.parse(process.argv[2]);
const activePath = path.join(root, "runtime-store", "active.json");
let current = null;
try { current = JSON.parse(fs.readFileSync(activePath, "utf8")); } catch {}
const next = { active: pointer };
if (current?.active?.id && current.active.id !== pointer.id) next.previous = current.active;
fs.writeFileSync(activePath + ".tmp", JSON.stringify(next, null, 2));
fs.renameSync(activePath + ".tmp", activePath);
fs.rmSync(path.join(root, "runtime-store", "pending.json"), { force: true });
fs.rmSync(path.join(root, "runtime-store", "failed.json"), { force: true });
`;

const FALLBACK_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[1];
const failed = JSON.parse(process.argv[2]);
const runtimeRoot = path.join(root, "runtime-store");
fs.writeFileSync(path.join(runtimeRoot, "failed.json"), JSON.stringify({ runtimeVersion: failed.manifest.runtimeVersion, failedAt: new Date().toISOString(), error: process.argv[3] }, null, 2));
if (failed.source === "pending") {
  fs.rmSync(path.join(runtimeRoot, "pending.json"), { force: true });
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

export class WslRuntimeStoreClient {
  constructor(
    private readonly options: {
      probe: WslDistroProbe;
      runner?: WslCommandRunner;
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

  async getLaunchCandidate(): Promise<WslRuntimeCandidate> {
    return JSON.parse(await this.execute(GET_CANDIDATE_SCRIPT)) as WslRuntimeCandidate;
  }

  async markLaunchSuccessful(candidate: WslRuntimeCandidate): Promise<void> {
    if (candidate.source !== "pending") return;
    await this.execute(MARK_SUCCESS_SCRIPT, [JSON.stringify(candidate.pointer)]);
  }

  async fallbackAfterFailure(candidate: WslRuntimeCandidate, error: unknown): Promise<void> {
    await this.execute(FALLBACK_SCRIPT, [
      JSON.stringify(candidate),
      error instanceof Error ? error.message : String(error),
    ]);
  }
}
