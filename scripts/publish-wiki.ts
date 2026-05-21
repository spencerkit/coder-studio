import { isDirectExecution } from "./shared/process.js";

export interface PublishWikiOptions {
  allowDirty: boolean;
  message: string;
  push: boolean;
  remote?: string;
  workdir?: string;
}

export const DEFAULT_WIKI_REMOTE = "https://github.com/spencerkit/coder-studio.wiki.git";
export const DEFAULT_COMMIT_MESSAGE = "docs: update wiki";

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
  parsePublishWikiArgs(process.argv.slice(2));
}

if (isDirectExecution(import.meta.url)) {
  main();
}
