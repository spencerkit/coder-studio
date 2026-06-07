import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "./cli.js";
import { getFileDiff } from "./diff.js";
import { applyGitHunkOperation } from "./hunk-operations.js";

const BASE_CONTENT = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "",
].join("\n");

const TWO_HUNK_CONTENT = [
  "ONE",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "TWELVE",
  "",
].join("\n");

describe("applyGitHunkOperation", () => {
  let root: string;

  beforeEach(async () => {
    root = join(tmpdir(), `coder-studio-hunk-op-${Date.now()}-${Math.random()}`);
    await mkdir(root, { recursive: true });
    await runGit(root, ["init"]);
    await runGit(root, ["config", "user.email", "test@example.com"]);
    await runGit(root, ["config", "user.name", "Test User"]);
    await writeFile(join(root, "file.txt"), BASE_CONTENT);
    await runGit(root, ["add", "file.txt"]);
    await runGit(root, ["commit", "-m", "initial"]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stages one unstaged hunk", async () => {
    await writeFile(join(root, "file.txt"), TWO_HUNK_CONTENT);
    const diff = await getFileDiff(root, "file.txt", false);
    const hunkId = diff.hunks![0]!.id;

    await applyGitHunkOperation(root, {
      workspaceId: "ws-1",
      path: "file.txt",
      staged: false,
      hunkId,
      operation: "stage",
    });

    const staged = await runGit(root, ["diff", "--staged", "--", "file.txt"]);
    const unstaged = await runGit(root, ["diff", "--", "file.txt"]);
    expect(staged.stdout).toContain("ONE");
    expect(staged.stdout).not.toContain("TWELVE");
    expect(unstaged.stdout).toContain("TWELVE");
  });

  it("unstages one staged hunk", async () => {
    await writeFile(join(root, "file.txt"), TWO_HUNK_CONTENT);
    await runGit(root, ["add", "file.txt"]);
    const diff = await getFileDiff(root, "file.txt", true);
    const hunkId = diff.hunks![0]!.id;

    await applyGitHunkOperation(root, {
      workspaceId: "ws-1",
      path: "file.txt",
      staged: true,
      hunkId,
      operation: "unstage",
    });

    const staged = await runGit(root, ["diff", "--staged", "--", "file.txt"]);
    const unstaged = await runGit(root, ["diff", "--", "file.txt"]);
    expect(staged.stdout).not.toContain("ONE");
    expect(staged.stdout).toContain("TWELVE");
    expect(unstaged.stdout).toContain("ONE");
  });

  it("discards one unstaged hunk", async () => {
    await writeFile(join(root, "file.txt"), TWO_HUNK_CONTENT);
    const diff = await getFileDiff(root, "file.txt", false);
    const hunkId = diff.hunks![0]!.id;

    await applyGitHunkOperation(root, {
      workspaceId: "ws-1",
      path: "file.txt",
      staged: false,
      hunkId,
      operation: "discard",
    });

    const unstaged = await runGit(root, ["diff", "--", "file.txt"]);
    expect(unstaged.stdout).not.toContain("ONE");
    expect(unstaged.stdout).toContain("TWELVE");
  });

  it("rejects stale hunk ids", async () => {
    await writeFile(join(root, "file.txt"), "ONE\ntwo\nthree\nfour\nfive\n");

    await expect(
      applyGitHunkOperation(root, {
        workspaceId: "ws-1",
        path: "file.txt",
        staged: false,
        hunkId: "hunk_stale",
        operation: "stage",
      })
    ).rejects.toMatchObject({
      code: "git_hunk_stale",
    });
  });
});
