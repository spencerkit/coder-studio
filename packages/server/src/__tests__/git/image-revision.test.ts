import { execFile } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readImageAtRevision } from "../../git/image-revision.js";

const execFileAsync = promisify(execFile);
const PNG_BYTES = Buffer.from(
  "89504E470D0A1A0A0000000D4948445200000001000000010806000000" +
    "1F15C4890000000A49444154789C63000100000005000157CFC4A30000" +
    "0000049454E44AE426082",
  "hex"
);

describe("readImageAtRevision", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-image-revision-test-${Date.now()}`);
    await mkdir(testDir);

    await execFileAsync("git", ["init"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: testDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: testDir });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("reads committed image bytes from HEAD", async () => {
    await writeFile(join(testDir, "pixel.png"), PNG_BYTES);
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "Add pixel"], { cwd: testDir });

    const asset = await readImageAtRevision(testDir, "HEAD", "pixel.png");

    expect(asset.exists).toBe(true);
    expect(asset.mime).toBe("image/png");
    expect(asset.bytes?.equals(PNG_BYTES)).toBe(true);
  });

  it("reads staged image bytes from INDEX", async () => {
    await writeFile(join(testDir, "pixel.png"), PNG_BYTES);
    await execFileAsync("git", ["add", "."], { cwd: testDir });
    await execFileAsync("git", ["commit", "-m", "Add pixel"], { cwd: testDir });

    const nextBytes = Buffer.from(PNG_BYTES);
    nextBytes[nextBytes.length - 1] ^= 0x01;
    await writeFile(join(testDir, "pixel.png"), nextBytes);
    await execFileAsync("git", ["add", "."], { cwd: testDir });

    const asset = await readImageAtRevision(testDir, "INDEX", "pixel.png");

    expect(asset.exists).toBe(true);
    expect(asset.mime).toBe("image/png");
    expect(asset.bytes?.equals(nextBytes)).toBe(true);
  });
});
