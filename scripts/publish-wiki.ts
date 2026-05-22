import { spawn } from "node:child_process";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { error, info, step, success } from "./shared/index.js";
import { ROOT_DIR } from "./shared/paths.js";
import { isDirectExecution, shouldUseShellForCommand } from "./shared/process.js";

export interface PublishWikiOptions {
  allowDirty: boolean;
  message: string;
  push: boolean;
  remote?: string;
  workdir?: string;
}

export const DEFAULT_WIKI_REMOTE = "https://github.com/spencerkit/coder-studio.wiki.git";
export const DEFAULT_COMMIT_MESSAGE = "docs: update wiki";
export const DEFAULT_WIKI_WORKDIR = ".tmp/wiki-publish";

export interface WikiPaths {
  repoRoot: string;
  sourceDir: string;
  homePath: string;
  workdir: string;
}

export interface ExecOptions {
  cwd: string;
  stdio?: "inherit" | "pipe";
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFn = (command: string, args: string[], options: ExecOptions) => Promise<ExecResult>;

export function parsePublishWikiArgs(argv: string[]): PublishWikiOptions {
  const options: PublishWikiOptions = {
    allowDirty: false,
    message: DEFAULT_COMMIT_MESSAGE,
    push: false,
    remote: undefined,
    workdir: undefined,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--push":
        options.push = true;
        break;
      case "--dry-run":
        options.push = false;
        break;
      case "--allow-dirty":
        options.allowDirty = true;
        break;
      case "--message":
        options.message = readValue(argv, ++index, "--message");
        break;
      case "--remote":
        options.remote = readValue(argv, ++index, "--remote");
        break;
      case "--workdir":
        options.workdir = readValue(argv, ++index, "--workdir");
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown publish:wiki option: ${arg}`);
    }
  }

  return options;
}

export function buildWikiRemote(
  options: Pick<PublishWikiOptions, "remote">,
  env: NodeJS.ProcessEnv
): string {
  if (options.remote) {
    return options.remote;
  }

  const token = env.GITHUB_TOKEN;
  if (token) {
    return `https://x-access-token:${token}@github.com/spencerkit/coder-studio.wiki.git`;
  }

  return DEFAULT_WIKI_REMOTE;
}

export function redactRemote(remote: string): string {
  return remote.replace(/(https:\/\/[^:]+:)[^@]+(@.+)/, "$1***$2");
}

export async function resolveWikiPaths(
  repoRoot: string,
  workdirOverride?: string
): Promise<WikiPaths> {
  const sourceDir = resolve(repoRoot, "docs/wiki");
  const homePath = resolve(sourceDir, "Home.md");
  const workdir = workdirOverride
    ? resolve(workdirOverride)
    : resolve(repoRoot, DEFAULT_WIKI_WORKDIR);

  const sourceStats = await stat(sourceDir).catch(() => null);
  if (!sourceStats?.isDirectory()) {
    throw new Error(`Wiki source directory is missing: ${sourceDir}`);
  }

  const homeStats = await stat(homePath).catch(() => null);
  if (!homeStats?.isFile()) {
    throw new Error(`Wiki source file is missing: ${homePath}`);
  }

  return {
    repoRoot,
    sourceDir,
    homePath,
    workdir,
  };
}

export async function mirrorWikiDirectory(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  await syncDirectoryContents(sourceDir, targetDir);
}

export async function runPublishWiki({
  repoRoot = ROOT_DIR,
  options,
  exec = execCommand,
}: {
  repoRoot?: string;
  options: PublishWikiOptions;
  exec?: ExecFn;
}): Promise<void> {
  const paths = await resolveWikiPaths(repoRoot, options.workdir);
  const remote = buildWikiRemote(options, process.env);

  step("PUBLISH WIKI", `Preparing GitHub wiki ${options.push ? "publish" : "dry-run"}...\n`);
  info(`Using wiki remote: ${redactRemote(remote)}`);

  if (options.push && !options.allowDirty) {
    await assertCleanGitWorktree(paths.repoRoot, exec);
  }

  await mkdir(dirname(paths.workdir), { recursive: true });

  const workdirStats = await stat(paths.workdir).catch(() => null);
  if (!workdirStats) {
    info("Cloning wiki repository checkout...");
    try {
      await exec("git", ["clone", remote, paths.workdir], {
        cwd: paths.repoRoot,
        stdio: "inherit",
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("exited with code 128")) {
        throw new Error(
          "GitHub Wiki repository not found. GitHub only creates <repo>.wiki.git after the repository Wiki is initialized on GitHub. Open the repository Wiki once, create the initial wiki, then retry."
        );
      }
      throw err;
    }
  } else {
    const gitDirStats = await stat(resolve(paths.workdir, ".git")).catch(() => null);
    if (!gitDirStats) {
      throw new Error(
        `Wiki workdir exists but is not a git repository: ${paths.workdir}. Remove or fix it before retrying.`
      );
    }
  }

  info("Refreshing wiki checkout...");
  await exec("git", ["fetch", "origin"], {
    cwd: paths.workdir,
    stdio: "inherit",
  });
  const branchResult = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: paths.workdir,
    stdio: "pipe",
  });
  const branch = branchResult.stdout.trim();
  try {
    await exec("git", ["merge", "--ff-only", `origin/${branch}`], {
      cwd: paths.workdir,
      stdio: "inherit",
    });
  } catch {
    throw new Error(
      `Wiki workdir has diverged from origin/${branch}. Inspect or remove ${paths.workdir} before retrying.`
    );
  }

  info("Syncing wiki source files...");
  await mirrorWikiDirectory(paths.sourceDir, paths.workdir);

  const statusResult = await exec("git", ["status", "--short"], {
    cwd: paths.workdir,
    stdio: "pipe",
  });

  if (statusResult.stdout.trim().length > 0) {
    info(`Wiki checkout changes:\n${statusResult.stdout.trimEnd()}`);
  } else {
    success("Wiki checkout is already up to date.");
    return;
  }

  if (!options.push) {
    success("Dry-run complete. Re-run with --push to publish the wiki.");
    return;
  }

  info("Committing wiki updates...");
  await exec("git", ["add", "."], {
    cwd: paths.workdir,
    stdio: "inherit",
  });
  await exec("git", ["commit", "-m", options.message], {
    cwd: paths.workdir,
    stdio: "inherit",
  });
  await exec("git", ["push", "origin", branch], {
    cwd: paths.workdir,
    stdio: "inherit",
  });
  success("Wiki publish completed.");
}

function readValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function printUsage(): void {
  console.log(`
Usage: pnpm publish:wiki -- [options]

Publish the GitHub wiki content.

Dry-run is the default. Re-run with --push to enable remote updates.

Options:
  --push           Push wiki changes to the remote
  --dry-run        Disable pushing and keep the run local (default)
  --allow-dirty    Allow running with a dirty git worktree
  --message <text> Commit message to use for wiki updates
  --remote <url>   Override the wiki git remote URL
  --workdir <path> Override the local wiki checkout directory
  --help, -h       Show this help message
`);
}

function main(): void {
  runPublishWiki({ options: parsePublishWikiArgs(process.argv.slice(2)) }).catch((err) => {
    error(err.message);
    process.exit(1);
  });
}

if (isDirectExecution(import.meta.url)) {
  main();
}

async function assertCleanGitWorktree(repoRoot: string, exec: ExecFn): Promise<void> {
  const result = await exec("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    stdio: "pipe",
  });

  if (result.stdout.trim().length > 0) {
    throw new Error(
      "Refusing to publish wiki from a dirty git worktree. Commit/stash changes or pass --allow-dirty."
    );
  }
}

async function syncDirectoryContents(sourceDir: string, targetDir: string): Promise<void> {
  const sourceEntries = await readdir(sourceDir, { withFileTypes: true });
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name));
  const targetEntries = await readdir(targetDir, { withFileTypes: true }).catch(() => []);

  for (const targetEntry of targetEntries) {
    if (targetEntry.name === ".git") {
      continue;
    }
    if (!sourceNames.has(targetEntry.name)) {
      await rm(resolve(targetDir, targetEntry.name), { force: true, recursive: true });
    }
  }

  for (const sourceEntry of sourceEntries) {
    const sourcePath = resolve(sourceDir, sourceEntry.name);
    const targetPath = resolve(targetDir, sourceEntry.name);

    if (sourceEntry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await syncDirectoryContents(sourcePath, targetPath);
      continue;
    }

    await cp(sourcePath, targetPath, { force: true, recursive: false });
  }
}

export async function execCommand(
  command: string,
  args: string[],
  options: ExecOptions
): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    const stdio = options.stdio ?? "inherit";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      shell: shouldUseShellForCommand(command),
      stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    if (stdio === "pipe") {
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}
