import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Topics } from "@coder-studio/core";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceWatcher } from "../../fs/watcher.js";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}

async function waitFor(
  predicate: () => boolean,
  onTimeout: () => string,
  timeoutMs = 5_000,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for expected watcher event. ${onTimeout()}`);
}

describe("WorkspaceWatcher worktree events", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("broadcasts worktreeChanged when git worktree add and remove mutate git metadata", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "watcher-worktree-"));
    tempDirs.push(repoDir);

    await runGit(repoDir, ["init", "-b", "main"]);
    await runGit(repoDir, ["config", "user.email", "test@example.com"]);
    await runGit(repoDir, ["config", "user.name", "Watcher Test"]);
    await writeFile(join(repoDir, ".gitignore"), ".worktrees/\n");
    await writeFile(join(repoDir, "README.md"), "root\n");
    await runGit(repoDir, ["add", "."]);
    await runGit(repoDir, ["commit", "-m", "init"]);

    const broadcasts: Array<{ topic: string; payload: unknown }> = [];
    const watcher = new WorkspaceWatcher("ws-test", repoDir, {
      broadcast(topic, payload) {
        broadcasts.push({ topic, payload });
      },
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await runGit(repoDir, ["worktree", "add", ".worktrees/feature-a", "-b", "feature/a"]);

      await waitFor(
        () =>
          broadcasts.some(
            (event) =>
              event.topic === Topics.workspaceGitState("ws-test") &&
              event.payload &&
              typeof event.payload === "object" &&
              "worktreeChanged" in event.payload &&
              (event.payload as { worktreeChanged?: boolean }).worktreeChanged === true
          ),
        () => `Observed broadcasts after add: ${JSON.stringify(broadcasts)}`
      );

      broadcasts.length = 0;

      await runGit(repoDir, ["worktree", "remove", ".worktrees/feature-a", "--force"]);

      await waitFor(
        () =>
          broadcasts.some(
            (event) =>
              event.topic === Topics.workspaceGitState("ws-test") &&
              event.payload &&
              typeof event.payload === "object" &&
              "worktreeChanged" in event.payload &&
              (event.payload as { worktreeChanged?: boolean }).worktreeChanged === true
          ),
        () => `Observed broadcasts after remove: ${JSON.stringify(broadcasts)}`
      );
    } finally {
      await watcher.close();
    }
  }, 15_000);
});
