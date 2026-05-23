import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildWikiRemote,
  mirrorWikiDirectory,
  parsePublishWikiArgs,
  resolveWikiPaths,
  runPublishWiki,
} from "./publish-wiki.js";

describe("publish-wiki", () => {
  it("defaults to a safe dry-run wiki publish flow", () => {
    expect(parsePublishWikiArgs([])).toEqual({
      allowDirty: false,
      message: "docs: update wiki",
      push: false,
      remote: undefined,
      workdir: undefined,
    });
  });

  it("parses explicit wiki publish flags", () => {
    expect(
      parsePublishWikiArgs([
        "--",
        "--push",
        "--allow-dirty",
        "--message",
        "docs: sync wiki",
        "--remote",
        "git@github.com:spencerkit/coder-studio.wiki.git",
        "--workdir",
        "/tmp/coder-studio.wiki",
      ])
    ).toEqual({
      allowDirty: true,
      message: "docs: sync wiki",
      push: true,
      remote: "git@github.com:spencerkit/coder-studio.wiki.git",
      workdir: "/tmp/coder-studio.wiki",
    });
  });

  it("builds the default wiki remote when no override or token is provided", () => {
    expect(buildWikiRemote({ remote: undefined }, {})).toBe(
      "https://github.com/spencerkit/coder-studio.wiki.git"
    );
  });

  it("preserves an explicit wiki remote even when a GitHub token exists", () => {
    expect(
      buildWikiRemote(
        { remote: "git@github.com:spencerkit/coder-studio.wiki.git" },
        { GITHUB_TOKEN: "secret-token" }
      )
    ).toBe("git@github.com:spencerkit/coder-studio.wiki.git");
  });

  it("injects the GitHub token into the default wiki remote when available", () => {
    expect(buildWikiRemote({ remote: undefined }, { GITHUB_TOKEN: "secret-token" })).toBe(
      "https://x-access-token:secret-token@github.com/spencerkit/coder-studio.wiki.git"
    );
  });

  it("fails validation when docs/wiki/Home.md is missing", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "coder-studio-wiki-"));
    await mkdir(join(repoRoot, "docs", "wiki"), { recursive: true });

    await expect(resolveWikiPaths(repoRoot, undefined)).rejects.toThrow("docs/wiki/Home.md");
  });

  it("mirrors wiki files into the checkout root and removes stale files", async () => {
    const root = await mkdtemp(join(tmpdir(), "coder-studio-wiki-sync-"));
    const sourceDir = join(root, "source");
    const targetDir = join(root, "target");

    await mkdir(sourceDir, { recursive: true });
    await mkdir(join(targetDir, ".git"), { recursive: true });
    await writeFile(join(sourceDir, "Home.md"), "# Home\n");
    await writeFile(join(sourceDir, "FAQ.md"), "# FAQ\n");
    await writeFile(join(targetDir, "Old.md"), "# Old\n");

    await mirrorWikiDirectory(sourceDir, targetDir);

    await expect(readFile(join(targetDir, "Home.md"), "utf8")).resolves.toContain("# Home");
    await expect(readFile(join(targetDir, "FAQ.md"), "utf8")).resolves.toContain("# FAQ");
    await expect(readFile(join(targetDir, "Old.md"), "utf8")).rejects.toThrow();
  });

  it("refuses push from a dirty main repo unless allowDirty is enabled", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "coder-studio-wiki-repo-"));
    await mkdir(join(repoRoot, "docs", "wiki"), { recursive: true });
    await writeFile(join(repoRoot, "docs", "wiki", "Home.md"), "# Home\n");

    const exec = vi.fn(async (command: string, args: string[]) => {
      if (command === "git" && args.join(" ") === "status --porcelain") {
        return { stdout: " M README.md\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    await expect(
      runPublishWiki({
        repoRoot,
        options: {
          allowDirty: false,
          message: "docs: update wiki",
          push: true,
          remote: "https://github.com/spencerkit/coder-studio.wiki.git",
          workdir: join(repoRoot, ".tmp/wiki-publish"),
        },
        exec,
      })
    ).rejects.toThrow("Refusing to publish wiki from a dirty git worktree");
  });

  it("skips commit and push when sync produces no changes", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "coder-studio-wiki-push-"));
    const workdir = join(repoRoot, ".tmp/wiki-publish");
    await mkdir(join(repoRoot, "docs", "wiki"), { recursive: true });
    await writeFile(join(repoRoot, "docs", "wiki", "Home.md"), "# Home\n");
    await mkdir(join(workdir, ".git"), { recursive: true });

    const exec = vi.fn(async (command: string, args: string[]) => {
      if (command === "git" && args.join(" ") === "status --porcelain") {
        return { stdout: "", stderr: "" };
      }
      if (command === "git" && args.join(" ") === "status --short") {
        return { stdout: "", stderr: "" };
      }
      if (command === "git" && args[0] === "rev-parse") {
        return { stdout: "main\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    await expect(
      runPublishWiki({
        repoRoot,
        options: {
          allowDirty: true,
          message: "docs: update wiki",
          push: true,
          remote: "https://github.com/spencerkit/coder-studio.wiki.git",
          workdir,
        },
        exec,
      })
    ).resolves.toBeUndefined();

    expect(exec).not.toHaveBeenCalledWith("git", ["add", "."], expect.any(Object));
    expect(exec).not.toHaveBeenCalledWith(
      "git",
      ["commit", "-m", "docs: update wiki"],
      expect.any(Object)
    );
    expect(exec).not.toHaveBeenCalledWith("git", ["push", "origin", "main"], expect.any(Object));
  });

  it("commits and pushes when push mode has synced changes", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "coder-studio-wiki-push-"));
    const workdir = join(repoRoot, ".tmp/wiki-publish");
    await mkdir(join(repoRoot, "docs", "wiki"), { recursive: true });
    await writeFile(join(repoRoot, "docs", "wiki", "Home.md"), "# Home\n");
    await mkdir(join(workdir, ".git"), { recursive: true });
    await writeFile(join(workdir, "Home.md"), "# Old Home\n");

    const exec = vi.fn(async (command: string, args: string[]) => {
      if (command === "git" && args.join(" ") === "status --porcelain") {
        return { stdout: "", stderr: "" };
      }
      if (command === "git" && args.join(" ") === "status --short") {
        return { stdout: " M Home.md\n", stderr: "" };
      }
      if (command === "git" && args[0] === "rev-parse") {
        return { stdout: "main\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    await runPublishWiki({
      repoRoot,
      options: {
        allowDirty: true,
        message: "docs: sync wiki",
        push: true,
        remote: "https://github.com/spencerkit/coder-studio.wiki.git",
        workdir,
      },
      exec,
    });

    expect(exec).toHaveBeenCalledWith("git", ["add", "."], {
      cwd: workdir,
      stdio: "inherit",
    });
    expect(exec).toHaveBeenCalledWith("git", ["commit", "-m", "docs: sync wiki"], {
      cwd: workdir,
      stdio: "inherit",
    });
    expect(exec).toHaveBeenCalledWith("git", ["push", "origin", "main"], {
      cwd: workdir,
      stdio: "inherit",
    });
  });
});
