import { spawn } from "node:child_process";
import {
  type CommandAvailabilityCheck,
  checkCommandAvailable,
} from "../provider-runtime/command-check.js";
import { type CommandRunner } from "../provider-runtime/command-runner.js";

export interface BrowseDirectoryInfo {
  name: string;
  path: string;
}

export interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  directories: BrowseDirectoryInfo[];
  rootPaths?: string[];
}

export interface WslBrowseDeps {
  commandExists?: CommandAvailabilityCheck;
  runCommand?: CommandRunner;
}

export interface BrowseWslDirectoryInput {
  distro: string;
  path?: string;
}

export interface CreateWslDirectoryInput {
  distro: string;
  path: string;
}

type WslHelperMode = "browse" | "mkdir";

const FIELD_SEPARATOR = "\0";

function requireDistro(distro: string): string {
  const normalized = distro.trim();
  if (!normalized) {
    throw { code: "invalid_path", message: "WSL distro is required" };
  }
  return normalized;
}

async function resolveWslCommand(
  commandExists?: CommandAvailabilityCheck,
  runCommand?: CommandRunner
): Promise<"wsl" | "wsl.exe" | null> {
  const checker =
    commandExists ??
    ((command: string) =>
      checkCommandAvailable(command, {
        runCommand,
      }));

  if (await checker("wsl")) {
    return "wsl";
  }

  if (await checker("wsl.exe")) {
    return "wsl.exe";
  }

  return null;
}

async function ensureWslAvailable(deps: WslBrowseDeps): Promise<"wsl" | "wsl.exe"> {
  const command = await resolveWslCommand(deps.commandExists, deps.runCommand);
  if (command) {
    return command;
  }

  throw {
    code: "wsl_unavailable",
    message: "WSL is not available on the host",
  };
}

function buildWslShellSnippet(mode: WslHelperMode): string {
  if (mode === "mkdir") {
    return [
      'TARGET_PATH="${1-}"',
      'if [ -z "$TARGET_PATH" ] || [ "$TARGET_PATH" = "~" ]; then TARGET_PATH="$HOME"; fi',
      'case "$TARGET_PATH" in "~/"*) TARGET_PATH="$HOME/${TARGET_PATH#~/}" ;; esac',
      'mkdir -- "$TARGET_PATH"',
      "printf 'OK\\0true\\0'",
    ].join("; ");
  }

  return [
    'TARGET_PATH="${1-}"',
    'if [ -z "$TARGET_PATH" ] || [ "$TARGET_PATH" = "~" ]; then TARGET_PATH="$HOME"; fi',
    'case "$TARGET_PATH" in "~/"*) TARGET_PATH="$HOME/${TARGET_PATH#~/}" ;; esac',
    'CANONICAL_PATH=$(cd -- "$TARGET_PATH" 2>/dev/null && pwd -P) || exit 2',
    '[ -d "$CANONICAL_PATH" ] || exit 3',
    'HOME_PATH=$(cd -- "$HOME" && pwd -P)',
    'if [ "$CANONICAL_PATH" = "/" ]; then PARENT_PATH=""; else PARENT_PATH=$(dirname -- "$CANONICAL_PATH"); fi',
    'printf \'OK\\0%s\\0%s\\0\' "$CANONICAL_PATH" "$PARENT_PATH"',
    "printf '2\\0/\\0%s\\0' \"$HOME_PATH\"",
    "find \"$CANONICAL_PATH\" -mindepth 1 -maxdepth 1 \\( -type d -o -xtype d \\) -printf '%f\\0%p\\0'",
  ].join("; ");
}

function getWslArgs(mode: WslHelperMode, input: { distro: string; path?: string }): string[] {
  return [
    "-d",
    input.distro,
    "--",
    "sh",
    "-lc",
    buildWslShellSnippet(mode),
    "sh",
    input.path ?? "~",
  ];
}

function extractErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : undefined;
    const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : undefined;
    const message =
      "message" in error && typeof error.message === "string" ? error.message : undefined;
    return [stderr, stdout, message].filter((value) => value && value.trim().length > 0).join("\n");
  }

  return String(error);
}

function mapWslBrowseError(error: unknown): never {
  const haystack = extractErrorText(error).toLowerCase();

  if (
    haystack.includes("wsl_e_distro_not_found") ||
    haystack.includes("distribution was not found")
  ) {
    throw {
      code: "wsl_distro_not_found",
      message: "WSL distro not found",
    };
  }

  if (haystack.includes("permission denied")) {
    throw {
      code: "permission_denied",
      message: "Permission denied",
    };
  }

  throw {
    code: "browse_failed",
    message: extractErrorText(error) || "Failed to browse WSL directory",
  };
}

function runWslCommandLocally(command: "wsl" | "wsl.exe", args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.on("error", (error) => {
      reject(
        Object.assign(error, {
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
        })
      );
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        Object.assign(new Error(`${command} exited with code ${code ?? "unknown"}`), {
          exitCode: code ?? undefined,
          stdout,
          stderr,
        })
      );
    });
  });
}

async function runWslHelper(
  mode: WslHelperMode,
  input: { distro: string; path?: string },
  command: "wsl" | "wsl.exe",
  deps: WslBrowseDeps
): Promise<string> {
  const args = getWslArgs(mode, input);

  try {
    if (deps.runCommand) {
      return (await deps.runCommand(command, args, { windowsHide: true })).stdout;
    }

    return await runWslCommandLocally(command, args);
  } catch (error) {
    mapWslBrowseError(error);
  }
}

function failMalformedOutput(message: string): never {
  throw {
    code: "browse_failed",
    message,
  };
}

function parseNulFields(stdout: string): string[] {
  if (!stdout.startsWith(`OK${FIELD_SEPARATOR}`) || !stdout.endsWith(FIELD_SEPARATOR)) {
    failMalformedOutput("Malformed WSL helper output");
  }
  return stdout.split(FIELD_SEPARATOR);
}

function parseBrowsePayload(stdout: string): BrowseResult {
  const trimmed = stdout.trim();

  if (trimmed.startsWith("{")) {
    try {
      const payload = JSON.parse(trimmed) as {
        currentPath: string;
        parentPath: string | null;
        directories: BrowseDirectoryInfo[];
        rootPaths?: string[];
      };

      return {
        currentPath: payload.currentPath,
        parentPath: payload.parentPath,
        directories: [...payload.directories].sort((left, right) =>
          left.name.localeCompare(right.name)
        ),
        rootPaths: payload.rootPaths,
      };
    } catch {
      failMalformedOutput("Malformed WSL browse output");
    }
  }

  try {
    const fields = parseNulFields(stdout);
    if (fields.length < 6) {
      failMalformedOutput("Malformed WSL browse output");
    }

    const currentPath = fields[1];
    const parentValue = fields[2];
    const rootCount = Number.parseInt(fields[3] ?? "", 10);
    if (!Number.isInteger(rootCount) || rootCount < 0) {
      failMalformedOutput("Malformed WSL browse output");
    }

    const rootStart = 4;
    const rootEnd = rootStart + rootCount;
    if (fields.length < rootEnd + 1) {
      failMalformedOutput("Malformed WSL browse output");
    }

    const rootPaths = fields.slice(rootStart, rootEnd);
    const directoryFields = fields.slice(rootEnd, -1);
    if (directoryFields.length % 2 !== 0) {
      failMalformedOutput("Malformed WSL browse output");
    }

    const directories: BrowseDirectoryInfo[] = [];
    for (let index = 0; index < directoryFields.length; index += 2) {
      directories.push({
        name: directoryFields[index] ?? "",
        path: directoryFields[index + 1] ?? "",
      });
    }
    directories.sort((left, right) => left.name.localeCompare(right.name));

    if (!currentPath) {
      failMalformedOutput("Malformed WSL browse output");
    }

    return {
      currentPath,
      parentPath: parentValue ? parentValue : null,
      directories,
      rootPaths,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }
    failMalformedOutput("Malformed WSL browse output");
  }
}

function parseMkdirPayload(stdout: string): { ok: true } {
  const trimmed = stdout.trim();

  if (trimmed.startsWith("{")) {
    try {
      const payload = JSON.parse(trimmed) as { ok?: boolean };
      if (payload.ok === true) {
        return { ok: true };
      }
      failMalformedOutput("Malformed WSL mkdir output");
    } catch {
      failMalformedOutput("Malformed WSL mkdir output");
    }
  }

  try {
    const fields = parseNulFields(stdout);
    if (fields.length !== 3 || fields[1] !== "true" || fields[2] !== "") {
      failMalformedOutput("Malformed WSL mkdir output");
    }
    return { ok: true };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }
    failMalformedOutput("Malformed WSL mkdir output");
  }
}

export async function browseWslDirectory(
  input: BrowseWslDirectoryInput,
  deps: WslBrowseDeps = {}
): Promise<BrowseResult> {
  const distro = requireDistro(input.distro);
  const command = await ensureWslAvailable(deps);
  return parseBrowsePayload(
    await runWslHelper("browse", { distro, path: input.path }, command, deps)
  );
}

export async function createWslDirectoryInDistro(
  input: CreateWslDirectoryInput,
  deps: WslBrowseDeps = {}
): Promise<{ ok: true }> {
  const distro = requireDistro(input.distro);
  const command = await ensureWslAvailable(deps);
  return parseMkdirPayload(
    await runWslHelper("mkdir", { distro, path: input.path }, command, deps)
  );
}
