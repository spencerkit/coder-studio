import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const testHome = mkdtempSync(join(tmpdir(), "coder-studio-server-vitest-home-"));

process.env.HOME = testHome;
process.env.USERPROFILE = testHome;

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});
