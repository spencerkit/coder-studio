import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAutomationEntryPath } from "../session/automation-entry-path.js";

describe("resolveAutomationEntryPath", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors in test temp dirs.
      }
    }
  });

  it("prefers the repo source automation entry during development", () => {
    const resolvedPath = resolveAutomationEntryPath();

    expect(isAbsolute(resolvedPath)).toBe(true);
    expect(normalize(resolvedPath)).toContain(normalize("packages/cli/src/automation-entry.ts"));
  });

  it("resolves a same-directory automation entry artifact for packaged dist runtimes", () => {
    const packageRoot = mkdtempSync(join(tmpdir(), "coder-studio-cli-dist-"));
    tempDirs.push(packageRoot);

    const distDir = join(packageRoot, "dist", "esm");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "server-runner.mjs"), "export {};\n");
    writeFileSync(join(distDir, "automation-entry.mjs"), "export {};\n");

    const resolvedPath = resolveAutomationEntryPath(
      pathToFileURL(join(distDir, "server-runner.mjs")).href
    );

    expect(resolvedPath).toBe(join(distDir, "automation-entry.mjs"));
  });
});
