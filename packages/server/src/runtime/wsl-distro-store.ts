import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

export interface WslDistroRuntimeStoreLayout {
  coderStudioHomeDir: string;
  runtimeStoreDir: string;
  runtimeVersionsDir: string;
  runtimeCurrentPointerPath: string;
  bridgeRunDir: string;
}

export interface InstalledWslRuntimePointer {
  runtimeVersion: string;
  installDir: string;
  entryPath: string;
  installedAt: number;
  nodePath?: string;
}

export interface WslDistroRuntimeStore {
  readActiveRuntime(distro: string): Promise<InstalledWslRuntimePointer | null>;
  writeActiveRuntime(distro: string, pointer: InstalledWslRuntimePointer): Promise<void>;
  clearActiveRuntime(distro: string): Promise<void>;
}

function normalizeDistro(distro: string): string {
  const normalized = distro.trim();
  if (normalized.length === 0) {
    throw new Error("WSL distro is required");
  }

  return normalized;
}

function encodeDistroKey(distro: string): string {
  return Buffer.from(normalizeDistro(distro), "utf8").toString("base64url");
}

function resolveDistroPointerPath(rootDir: string, distro: string): string {
  return join(rootDir, encodeDistroKey(distro), "current.json");
}

function parseInstalledRuntimePointer(value: string): InstalledWslRuntimePointer | null {
  try {
    const parsed = JSON.parse(value) as Partial<InstalledWslRuntimePointer>;
    if (
      typeof parsed.runtimeVersion !== "string" ||
      typeof parsed.installDir !== "string" ||
      typeof parsed.entryPath !== "string" ||
      typeof parsed.installedAt !== "number"
    ) {
      return null;
    }

    return {
      runtimeVersion: parsed.runtimeVersion,
      installDir: parsed.installDir,
      entryPath: parsed.entryPath,
      installedAt: parsed.installedAt,
      ...(typeof parsed.nodePath === "string" ? { nodePath: parsed.nodePath } : {}),
    };
  } catch {
    return null;
  }
}

export function resolveWslDistroRuntimeStoreLayout(homeDir: string): WslDistroRuntimeStoreLayout {
  const coderStudioHomeDir = posix.join(homeDir, ".coder-studio");
  const runtimeStoreDir = posix.join(coderStudioHomeDir, "runtime-store");

  return {
    coderStudioHomeDir,
    runtimeStoreDir,
    runtimeVersionsDir: posix.join(runtimeStoreDir, "versions"),
    runtimeCurrentPointerPath: posix.join(runtimeStoreDir, "current.json"),
    bridgeRunDir: posix.join(coderStudioHomeDir, "run"),
  };
}

export function createWslDistroRuntimeStore(input: { rootDir: string }): WslDistroRuntimeStore {
  return {
    async readActiveRuntime(distro) {
      const pointerPath = resolveDistroPointerPath(input.rootDir, distro);

      try {
        const raw = await readFile(pointerPath, "utf-8");
        return parseInstalledRuntimePointer(raw);
      } catch {
        return null;
      }
    },

    async writeActiveRuntime(distro, pointer) {
      const pointerPath = resolveDistroPointerPath(input.rootDir, distro);
      await mkdir(dirname(pointerPath), { recursive: true });
      const tempPath = `${pointerPath}.tmp`;
      await writeFile(tempPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf-8");
      await rename(tempPath, pointerPath);
    },

    async clearActiveRuntime(distro) {
      await rm(join(input.rootDir, encodeDistroKey(distro)), { recursive: true, force: true });
    },
  };
}
