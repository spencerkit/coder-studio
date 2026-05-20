import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthSessionRepo } from "../storage/repositories/auth-session-repo.js";

describe("AuthSessionRepo", () => {
  let tempDir: string;
  let repo: AuthSessionRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auth-session-repo-test-"));
    repo = new AuthSessionRepo({
      filePath: join(tempDir, "auth-sessions.json"),
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates and touches sessions in the file store", () => {
    const created = repo.create("token-1", 1000);

    expect(created).toEqual({
      token: "token-1",
      createdAt: 1000,
      lastSeenAt: 1000,
    });

    expect(repo.touch("token-1", 2000)).toBe(true);
    expect(repo.touch("missing", 2000)).toBe(false);
  });

  it("deletes sessions from the file store", () => {
    repo.create("token-1", 1000);

    repo.delete("token-1");

    expect(repo.touch("token-1", 2000)).toBe(false);
  });
});
