import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildDevServerEnv, ensureDevCliShim, prependPathEntry } from "./dev-cli-shim.js";

const tempDirs: string[] = [];
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const requireFromHere = createRequire(import.meta.url);
const NODE_EXEC = process.execPath;
const TSX_LOADER = requireFromHere.resolve("tsx");

function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteWindowsCmdArg(value: string): string {
  return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("dev cli shim", () => {
  it("writes unix and windows coder-studio-cli shims that forward to the workspace cli", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "coder-studio-dev-shim-root-"));
    tempDirs.push(rootDir);
    const cliDir = join(rootDir, "packages", "cli");

    const result = ensureDevCliShim({ rootDir, cliDir });

    expect(result.binDir).toBe(join(rootDir, ".tmp", "dev-bin"));
    expect(readFileSync(result.unixShimPath, "utf8")).toContain(
      `exec ${quotePosixShellArg(NODE_EXEC)} --import ${quotePosixShellArg(TSX_LOADER)} ${quotePosixShellArg(join(cliDir, "src", "bin.ts"))} "$@"`
    );
    expect(readFileSync(result.windowsShimPath, "utf8")).toContain(
      `${quoteWindowsCmdArg(NODE_EXEC)} --import ${quoteWindowsCmdArg(TSX_LOADER)} ${quoteWindowsCmdArg(join(cliDir, "src", "bin.ts"))} %*`
    );
    expect(statSync(result.unixShimPath).mode & 0o111).not.toBe(0);
  });

  it("quotes shim root directories for unix shells and cmd files", () => {
    const rootDir = join(tmpdir(), "coder studio root $HOME \"quoted\" 'single'");
    tempDirs.push(rootDir);
    const cliDir = join(rootDir, "packages", "cli");

    const result = ensureDevCliShim({ rootDir, cliDir });

    expect(readFileSync(result.unixShimPath, "utf8")).toContain(
      `exec ${quotePosixShellArg(NODE_EXEC)} --import ${quotePosixShellArg(TSX_LOADER)} ${quotePosixShellArg(join(cliDir, "src", "bin.ts"))} "$@"`
    );
    expect(readFileSync(result.windowsShimPath, "utf8")).toContain(
      `${quoteWindowsCmdArg(NODE_EXEC)} --import ${quoteWindowsCmdArg(TSX_LOADER)} ${quoteWindowsCmdArg(join(cliDir, "src", "bin.ts"))} %*`
    );
  });

  it("escapes percent signs in windows cmd shims", () => {
    const rootDir = join(tmpdir(), "coder-studio-%USERPROFILE%-root");
    tempDirs.push(rootDir);
    const cliDir = join(rootDir, "packages", "cli");

    const result = ensureDevCliShim({ rootDir, cliDir });

    expect(readFileSync(result.windowsShimPath, "utf8")).toContain(
      `${quoteWindowsCmdArg(NODE_EXEC)} --import ${quoteWindowsCmdArg(TSX_LOADER)} ${quoteWindowsCmdArg(join(cliDir, "src", "bin.ts"))} %*`
    );
  });

  it("prepends the shim directory using the existing PATH key casing", () => {
    const env = prependPathEntry(
      {
        Path: "/usr/bin",
        HOME: "/tmp/dev-home",
      },
      "/tmp/dev-bin",
      { delimiter: ":" }
    );

    expect(env).toEqual({
      Path: "/tmp/dev-bin:/usr/bin",
      HOME: "/tmp/dev-home",
    });
  });

  it("creates a PATH entry when the base env does not define one", () => {
    const env = prependPathEntry({ HOME: "/tmp/dev-home" }, "/tmp/dev-bin", {
      delimiter: ":",
    });

    expect(env).toEqual({
      HOME: "/tmp/dev-home",
      PATH: "/tmp/dev-bin",
    });
  });

  it("normalizes duplicate PATH-like keys before prepending the shim directory", () => {
    const env = prependPathEntry(
      {
        Path: "C:\\Windows",
        PATH: "/usr/bin",
        PaTh: "/custom/bin",
        HOME: "/tmp/dev-home",
      },
      "/tmp/dev-bin",
      { delimiter: ":" }
    );

    expect(env).toEqual({
      Path: "/tmp/dev-bin:C:\\Windows:/usr/bin:/custom/bin",
      HOME: "/tmp/dev-home",
    });
  });

  it("builds the dev server env by generating the shim and prepending it to PATH", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "coder-studio-dev-env-root-"));
    tempDirs.push(rootDir);
    const cliDir = join(rootDir, "packages", "cli");

    const env = buildDevServerEnv({
      rootDir,
      cliDir,
      env: {
        Path: "/usr/bin",
        HOME: "/tmp/dev-home",
      },
    });

    expect(env).toEqual({
      Path: `${join(rootDir, ".tmp", "dev-bin")}:/usr/bin`,
      HOME: "/tmp/dev-home",
    });
    expect(statSync(join(rootDir, ".tmp", "dev-bin", "coder-studio-cli")).mode & 0o111).not.toBe(0);
  });

  it.runIf(process.platform !== "win32")(
    "executes the generated coder-studio-cli shim without depending on a preinstalled global command",
    () => {
      const result = ensureDevCliShim({
        rootDir: REPO_ROOT,
        cliDir: join(REPO_ROOT, "packages", "cli"),
      });
      const command = spawnSync(result.unixShimPath, ["help"], {
        encoding: "utf8",
        timeout: 40_000,
        env: {
          HOME: process.env.HOME ?? tmpdir(),
          PATH: "/usr/bin:/bin",
        },
      });

      expect(command.status).toBe(0);
      expect(command.error).toBeUndefined();
      expect(command.stdout).toContain("Coder Studio CLI");
    },
    40_000
  );
});
