/**
 * Tests for workspace validator.
 */

import { mkdir, rmdir, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validatePath, WorkspaceValidator } from "../../workspace/validator.js";

describe("validatePath", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `validator-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    try {
      await rmdir(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should validate existing readable/writable directory", async () => {
    const result = await validatePath(testDir);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should reject non-existent path", async () => {
    const result = await validatePath(join(testDir, "nonexistent"));
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Path does not exist");
  });

  it("should reject file path (not directory)", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "test");

    const result = await validatePath(filePath);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Path is not a directory");

    await unlink(filePath);
  });

  it("accepts WSL workspace paths using distro discovery instead of host stat", async () => {
    const result = await validatePath("/home/spencer/workspace", {
      targetRuntime: "wsl",
      wslDistro: "Ubuntu-24.04",
      commandExists: async () => true,
      runCommand: async (file: string, args?: string[]) => {
        if (file === "wsl.exe" && args?.join(" ") === "-l -q") {
          return { stdout: "Ubuntu-24.04\n", stderr: "" };
        }
        throw new Error(`unexpected command: ${file}`);
      },
    });

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe("WorkspaceValidator", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `validator-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    try {
      await rmdir(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should not throw for valid directory", async () => {
    const validator = new WorkspaceValidator();
    await expect(validator.validate(testDir)).resolves.toBeUndefined();
  });

  it("should throw for non-existent directory", async () => {
    const validator = new WorkspaceValidator();
    await expect(validator.validate(join(testDir, "nonexistent"))).rejects.toThrow(
      "Invalid workspace path: Path does not exist"
    );
  });
});
