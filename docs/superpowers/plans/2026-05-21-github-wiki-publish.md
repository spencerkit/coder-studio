# GitHub Wiki Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe repository-native `pnpm publish:wiki` flow that syncs `docs/wiki/` into the GitHub Wiki git repository, defaults to dry-run, and documents how maintainers publish it.

**Architecture:** Add a dedicated `scripts/publish-wiki.ts` entry point that follows the repository’s existing script pattern: parse explicit CLI options, validate `docs/wiki/`, resolve a wiki remote, prepare a reusable local wiki checkout, mirror files with a Node-based sync, then either print status or commit and push. Cover the script with focused Vitest tests and update the wiki/source documentation to point to the new command.

**Tech Stack:** TypeScript, Node.js `fs/promises`, child process git commands, `tsx`, Vitest, existing `scripts/shared/*` helpers, Markdown

---

## File Structure

**Create:**
- `scripts/publish-wiki.ts`
- `scripts/publish-wiki.test.ts`

**Modify:**
- `package.json`
- `docs/wiki/README.md`
- `README.md`
- `README.zh-CN.md`

**Use existing shared utilities without creating new shared modules unless the implementation clearly benefits:**
- `scripts/shared/logger.ts`
- `scripts/shared/paths.ts`
- `scripts/shared/process.ts`
- `scripts/shared/copy.ts`

## Boundary Decisions

- `docs/wiki/` remains the only source of truth for wiki content.
- `pnpm publish:wiki` defaults to dry-run and must not commit or push.
- `--push` is the only mode that commits and pushes.
- Main-repo dirty worktree checks apply only for `--push`, unless `--allow-dirty` is passed.
- Sync must be implemented in Node and must not require `rsync`.
- If `GITHUB_TOKEN` exists and `--remote` is not provided, the script must use an authenticated HTTPS remote for git operations without logging the token.
- The local wiki checkout must be reused when valid and must fail loudly if it has diverged or is not a git repository.

## Task 1: Add CLI Parsing, Remote Resolution, and Dry-Run Tests

**Files:**
- Create: `scripts/publish-wiki.test.ts`
- Create: `scripts/publish-wiki.ts`
- Modify: `package.json`
- Test: `scripts/publish-wiki.test.ts`

- [ ] **Step 1: Write the failing script option and remote-resolution tests**

Create `scripts/publish-wiki.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  buildWikiRemote,
  parsePublishWikiArgs,
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

  it("parses explicit publish and override flags", () => {
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

  it("uses the default https remote when no override or token is present", () => {
    expect(buildWikiRemote({ remote: undefined }, {})).toBe(
      "https://github.com/spencerkit/coder-studio.wiki.git"
    );
  });

  it("uses the explicit remote override even when GITHUB_TOKEN exists", () => {
    expect(
      buildWikiRemote(
        { remote: "git@github.com:spencerkit/coder-studio.wiki.git" },
        { GITHUB_TOKEN: "secret-token" }
      )
    ).toBe("git@github.com:spencerkit/coder-studio.wiki.git");
  });

  it("builds an authenticated https remote when GITHUB_TOKEN is present", () => {
    expect(
      buildWikiRemote({ remote: undefined }, { GITHUB_TOKEN: "secret-token" })
    ).toBe("https://x-access-token:secret-token@github.com/spencerkit/coder-studio.wiki.git");
  });
});
```

- [ ] **Step 2: Run the focused script tests and confirm they fail**

Run:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/publish-wiki.test.ts
```

Expected:
- FAIL because `scripts/publish-wiki.ts` does not exist yet
- FAIL because `parsePublishWikiArgs()` and `buildWikiRemote()` do not exist yet

- [ ] **Step 3: Implement the initial script module and package entry point**

Create `scripts/publish-wiki.ts` with these exported types and helpers:

```ts
export interface PublishWikiOptions {
  allowDirty: boolean;
  message: string;
  push: boolean;
  remote?: string;
  workdir?: string;
}

export function parsePublishWikiArgs(argv: string[]): PublishWikiOptions;

export function buildWikiRemote(
  options: Pick<PublishWikiOptions, "remote">,
  env: NodeJS.ProcessEnv
): string;
```

Implement the concrete defaults:

```ts
const DEFAULT_WIKI_REMOTE = "https://github.com/spencerkit/coder-studio.wiki.git";
const DEFAULT_COMMIT_MESSAGE = "docs: update wiki";
```

Argument behavior:

```ts
--push
--dry-run
--allow-dirty
--message <text>
--remote <url>
--workdir <path>
--help
```

Update `package.json`:

```json
{
  "scripts": {
    "publish:wiki": "tsx scripts/publish-wiki.ts"
  }
}
```

The initial `printUsage()` block should match repository conventions and clearly state that dry-run is the default.

- [ ] **Step 4: Run the focused script tests and verify they pass**

Run:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/publish-wiki.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit the script entry-point foundation**

```bash
git add scripts/publish-wiki.ts scripts/publish-wiki.test.ts package.json
git commit -m "Add GitHub wiki publish script entry point"
```

## Task 2: Implement Validation, Checkout Preparation, and Node-Based Sync

**Files:**
- Modify: `scripts/publish-wiki.ts`
- Modify: `scripts/publish-wiki.test.ts`
- Test: `scripts/publish-wiki.test.ts`

- [ ] **Step 1: Write the failing sync and validation tests**

Extend `scripts/publish-wiki.test.ts` with:

```ts
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  mirrorWikiDirectory,
  resolveWikiPaths,
  runPublishWiki,
} from "./publish-wiki.js";

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
  const exec = vi.fn(async (command: string, args: string[]) => {
    if (command === "git" && args.join(" ") === "status --porcelain") {
      return { stdout: " M README.md\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  });

  await expect(
    runPublishWiki({
      repoRoot: "/repo",
      options: {
        allowDirty: false,
        message: "docs: update wiki",
        push: true,
        remote: "https://github.com/spencerkit/coder-studio.wiki.git",
        workdir: "/repo/.tmp/wiki-publish",
      },
      exec,
    })
  ).rejects.toThrow("Refusing to publish wiki from a dirty git worktree");
});
```

- [ ] **Step 2: Run the script tests and confirm the new cases fail**

Run:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/publish-wiki.test.ts
```

Expected:
- FAIL because `resolveWikiPaths()`, `mirrorWikiDirectory()`, and `runPublishWiki()` are incomplete or missing
- FAIL because the mirror behavior and dirty-worktree checks are not implemented

- [ ] **Step 3: Implement filesystem validation and checkout mirroring**

In `scripts/publish-wiki.ts`, add:

```ts
export interface WikiPaths {
  repoRoot: string;
  sourceDir: string;
  homePath: string;
  workdir: string;
}

export async function resolveWikiPaths(
  repoRoot: string,
  workdirOverride?: string
): Promise<WikiPaths>;

export async function mirrorWikiDirectory(sourceDir: string, targetDir: string): Promise<void>;
```

`resolveWikiPaths()` must:

- resolve `docs/wiki`
- verify `docs/wiki` exists
- verify `docs/wiki/Home.md` exists
- default the checkout path to `<repoRoot>/.tmp/wiki-publish` when no override is provided

`mirrorWikiDirectory()` must:

- recursively copy all files from `sourceDir` into `targetDir`
- preserve `targetDir/.git`
- remove files and directories in `targetDir` that do not exist in `sourceDir`, excluding `.git`

Use only Node filesystem APIs such as:

```ts
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
```

- [ ] **Step 4: Implement checkout preparation and dry-run execution flow**

Add these script helpers:

```ts
export interface ExecOptions {
  cwd: string;
  stdio?: "inherit" | "pipe";
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFn = (
  command: string,
  args: string[],
  options: ExecOptions
) => Promise<ExecResult>;

export async function runPublishWiki(input: {
  repoRoot?: string;
  options: PublishWikiOptions;
  exec?: ExecFn;
}): Promise<void>;
```

`runPublishWiki()` must implement this sequence:

1. resolve repo and wiki paths
2. if `options.push && !options.allowDirty`, run `git status --porcelain` in the main repo and fail if non-empty
3. create the workdir parent directory when needed
4. if the workdir is absent, run:

```bash
git clone <resolved-remote> <workdir>
```

5. if the workdir exists, verify it contains `.git`
6. run:

```bash
git fetch origin
git rev-parse --abbrev-ref HEAD
git merge --ff-only origin/<branch>
```

7. mirror `docs/wiki/` into the workdir
8. run `git status --short` in the workdir
9. if not pushing, stop after status output

For the divergent local checkout case, fail with a message that tells the maintainer to inspect or delete the workdir before retrying.

- [ ] **Step 5: Run the script tests and verify they pass**

Run:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/publish-wiki.test.ts
```

Expected:
- PASS

- [ ] **Step 6: Commit validation and sync behavior**

```bash
git add scripts/publish-wiki.ts scripts/publish-wiki.test.ts
git commit -m "Implement GitHub wiki sync and validation flow"
```

## Task 3: Implement Commit/Push Behavior, No-Change Handling, and Safe Logging

**Files:**
- Modify: `scripts/publish-wiki.ts`
- Modify: `scripts/publish-wiki.test.ts`
- Test: `scripts/publish-wiki.test.ts`

- [ ] **Step 1: Write the failing publish-mode behavior tests**

Extend `scripts/publish-wiki.test.ts` with:

```ts
it("skips commit and push when sync produces no changes", async () => {
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
      repoRoot: "/repo",
      options: {
        allowDirty: true,
        message: "docs: update wiki",
        push: true,
        remote: "https://github.com/spencerkit/coder-studio.wiki.git",
        workdir: "/repo/.tmp/wiki-publish",
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
    repoRoot: "/repo",
    options: {
      allowDirty: true,
      message: "docs: sync wiki",
      push: true,
      remote: "https://github.com/spencerkit/coder-studio.wiki.git",
      workdir: "/repo/.tmp/wiki-publish",
    },
    exec,
  });

  expect(exec).toHaveBeenCalledWith("git", ["add", "."], {
    cwd: "/repo/.tmp/wiki-publish",
    stdio: "inherit",
  });
  expect(exec).toHaveBeenCalledWith("git", ["commit", "-m", "docs: sync wiki"], {
    cwd: "/repo/.tmp/wiki-publish",
    stdio: "inherit",
  });
  expect(exec).toHaveBeenCalledWith("git", ["push", "origin", "main"], {
    cwd: "/repo/.tmp/wiki-publish",
    stdio: "inherit",
  });
});
```

- [ ] **Step 2: Run the script tests and confirm the publish-mode cases fail**

Run:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/publish-wiki.test.ts
```

Expected:
- FAIL because `runPublishWiki()` does not yet branch correctly on no-change versus push
- FAIL because commit/push commands are not yet emitted

- [ ] **Step 3: Implement push-mode commit and secret-safe logging**

Update `scripts/publish-wiki.ts` so `runPublishWiki()`:

- captures `git status --short` output from the wiki checkout
- exits successfully with an explicit "already up to date" style message when there are no synced changes
- in dry-run mode, prints the status summary and exits without `git add`, `git commit`, or `git push`
- in push mode with changes, runs:

```bash
git add .
git commit -m "<message>"
git push origin <branch>
```

Add a logging helper that redacts tokenized remotes before printing them:

```ts
export function redactRemote(remote: string): string;
```

`redactRemote()` should turn:

```txt
https://x-access-token:secret-token@github.com/spencerkit/coder-studio.wiki.git
```

into:

```txt
https://x-access-token:***@github.com/spencerkit/coder-studio.wiki.git
```

Use the redacted value in informational logs only. Child git commands still receive the full remote value.

- [ ] **Step 4: Run the script tests and verify they pass**

Run:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/publish-wiki.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit publish-mode behavior**

```bash
git add scripts/publish-wiki.ts scripts/publish-wiki.test.ts
git commit -m "Add GitHub wiki push flow"
```

## Task 4: Update Maintainer Documentation and Verify the Full Flow

**Files:**
- Modify: `docs/wiki/README.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `package.json`
- Test: `scripts/publish-wiki.test.ts`

- [ ] **Step 1: Write the documentation updates**

Update `docs/wiki/README.md` so it becomes the canonical publish guide with these sections:

```md
# GitHub Wiki Source

This directory is the source of truth for the GitHub Wiki.

## Publish

```bash
pnpm publish:wiki
pnpm publish:wiki -- --push
```

Default behavior is a dry run. Real publication requires `--push`.

## Authentication

- default: existing git https credentials
- optional: `GITHUB_TOKEN`
- optional override: `--remote git@github.com:spencerkit/coder-studio.wiki.git`

## First-Time Setup

GitHub only creates `<repo>.wiki.git` after the repository Wiki is initialized on GitHub. If clone fails with repository not found, open the GitHub Wiki once and create the initial wiki before retrying.
```

Update the `README.md` resource row to:

```md
| [GitHub Wiki Source](docs/wiki/README.md) | Wiki source pages and publish flow |
```

Update the `README.zh-CN.md` resource row to:

```md
| [GitHub Wiki 源文件](docs/wiki/README.md) | Wiki 源页面与发布流程 |
```

- [ ] **Step 2: Run the script test suite and a focused diff check**

Run:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts scripts/publish-wiki.test.ts
git diff --check -- package.json scripts/publish-wiki.ts scripts/publish-wiki.test.ts docs/wiki/README.md README.md README.zh-CN.md
```

Expected:
- Vitest PASS
- `git diff --check` exits cleanly

- [ ] **Step 3: Run a local dry-run command against the real repository**

Run:

```bash
pnpm publish:wiki -- --dry-run
```

Expected:
- the script validates `docs/wiki/Home.md`
- the script attempts to prepare the wiki checkout
- if the GitHub Wiki is still uninitialized, the error explicitly explains the setup requirement
- otherwise the script prints the wiki status without pushing

- [ ] **Step 4: Commit documentation and final verification**

```bash
git add package.json scripts/publish-wiki.ts scripts/publish-wiki.test.ts docs/wiki/README.md README.md README.zh-CN.md
git commit -m "Document GitHub wiki publish flow"
```

## Plan Self-Review

- Spec coverage:
  - `pnpm publish:wiki` entry point: covered in Task 1
  - dry-run default and explicit `--push`: covered in Tasks 1 and 3
  - HTTPS default, `GITHUB_TOKEN`, and `--remote`: covered in Tasks 1 and 3
  - reusable local checkout plus divergence failure: covered in Task 2
  - Node-based sync without `rsync`: covered in Task 2
  - explicit first-time wiki initialization guidance: covered in Task 4
- Placeholder scan:
  - no `TODO`, `TBD`, or deferred implementation markers remain
- Type consistency:
  - the plan consistently uses `PublishWikiOptions`, `runPublishWiki()`, `buildWikiRemote()`, `resolveWikiPaths()`, and `mirrorWikiDirectory()`
