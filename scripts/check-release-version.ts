/**
 * Verifies that a release tag matches the published CLI package version.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLI_DIR, error, success } from "./shared/index.js";

export interface CheckReleaseVersionOptions {
  tag: string;
}

export interface ReleaseVersionMatch {
  tag: string;
  version: string;
}

export function parseCheckReleaseVersionArgs(argv: string[]): CheckReleaseVersionOptions {
  let tag: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--tag":
        tag = readValue(argv, ++index, "--tag");
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown check-release-version option: ${arg}`);
    }
  }

  tag ??= process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
  if (!tag) {
    throw new Error("Missing release tag. Pass --tag vX.Y.Z or set RELEASE_TAG.");
  }

  return { tag };
}

export function versionFromReleaseTag(tag: string): string {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (!match) {
    throw new Error(`Expected release tag in vX.Y.Z format, received "${tag}"`);
  }
  return match[1];
}

export async function assertReleaseTagMatchesPackage({
  tag,
  packageJsonPath = resolve(CLI_DIR, "package.json"),
}: CheckReleaseVersionOptions & { packageJsonPath?: string }): Promise<ReleaseVersionMatch> {
  const tagVersion = versionFromReleaseTag(tag);
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown };

  if (pkg.version !== tagVersion) {
    throw new Error(
      `Release tag ${tag} does not match packages/cli/package.json version ${String(
        pkg.version
      )}`
    );
  }

  return { tag, version: tagVersion };
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printUsage(): void {
  console.log(`
Usage:
  pnpm release:check-version -- --tag vX.Y.Z

Checks that the release tag matches packages/cli/package.json version.
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertReleaseTagMatchesPackage(parseCheckReleaseVersionArgs(process.argv.slice(2)))
    .then(({ tag, version }) => {
      success(`Release tag ${tag} matches @spencer-kit/coder-studio ${version}.`);
    })
    .catch((err) => {
      error(err.message);
      process.exit(1);
    });
}
