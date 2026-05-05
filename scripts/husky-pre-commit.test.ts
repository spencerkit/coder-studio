import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRE_COMMIT_HOOK = join(ROOT_DIR, ".husky", "pre-commit");

const tempDirs: string[] = [];

function runGit(repoDir: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
  });

  expect(result.status).toBe(0);
}

async function createRepoWithFakePnpm() {
  const repoDir = await mkdtemp(join(tmpdir(), "coder-studio-pre-commit-"));
  const binDir = join(repoDir, "bin");
  const pnpmLogPath = join(repoDir, "pnpm.log");

  tempDirs.push(repoDir);

  await mkdir(binDir, { recursive: true });
  await writeFile(
    join(binDir, "pnpm"),
    `#!/usr/bin/env sh
printf '%s\n' "$*" >> "$PNPM_LOG_PATH"
exit 0
`
  );
  await chmod(join(binDir, "pnpm"), 0o755);

  runGit(repoDir, ["init", "-q"]);
  runGit(repoDir, ["config", "user.email", "test@example.com"]);
  runGit(repoDir, ["config", "user.name", "Test User"]);

  return {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      PNPM_LOG_PATH: pnpmLogPath,
    },
    pnpmLogPath,
    repoDir,
  };
}

describe("husky pre-commit hook", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("rejects newly added files that still have unstaged edits", async () => {
    const { env, pnpmLogPath, repoDir } = await createRepoWithFakePnpm();
    const samplePath = join(repoDir, "sample.ts");

    await writeFile(samplePath, "const a = 1;\n");
    runGit(repoDir, ["add", "sample.ts"]);
    await writeFile(samplePath, "const a = 1;\nconst b = 2;\n");

    const result = spawnSync(PRE_COMMIT_HOOK, [], {
      cwd: repoDir,
      env,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ERROR: Some staged files have unstaged changes");
    expect(existsSync(pnpmLogPath)).toBe(false);
  });
});
