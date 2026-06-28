import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Result } from "@coder-studio/core";
import type { RelayHostCommandInput } from "./wsl-host-api-proxy.js";
import type { WslAgentSkillExportSnapshot } from "./wsl-skill-snapshot.js";

type PreparedRootPromotion = {
  homeRelativeRoot: string;
  writableRoot: string;
  stagingDir: string;
  backupDir: string;
  rollbackDir: string;
  backupCreated: boolean;
  promoted: boolean;
};

function isWithinDirectoryOrSame(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertSafeHomeRelativeRoot(homePath: string, homeRelativeRoot: string): string {
  if (!homeRelativeRoot || homeRelativeRoot === "." || isAbsolute(homeRelativeRoot)) {
    throw new Error(`Invalid WSL agent skill root: ${homeRelativeRoot}`);
  }

  const targetRoot = resolve(homePath, homeRelativeRoot);
  if (!isWithinDirectoryOrSame(homePath, targetRoot)) {
    throw new Error(`Invalid WSL agent skill root: ${homeRelativeRoot}`);
  }

  return targetRoot;
}

function assertSafeSkillFilePath(skillDir: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath)) {
    throw new Error(`Invalid WSL agent skill file path: ${relativePath}`);
  }

  const targetPath = resolve(skillDir, relativePath);
  if (!isWithinDirectoryOrSame(skillDir, targetPath)) {
    throw new Error(`Invalid WSL agent skill file path: ${relativePath}`);
  }

  return targetPath;
}

async function findNearestExistingAncestor(path: string): Promise<string | null> {
  let currentPath = resolve(path);
  while (true) {
    try {
      return await realpath(currentPath);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }

      const parentPath = dirname(currentPath);
      if (parentPath === currentPath) {
        return null;
      }
      currentPath = parentPath;
    }
  }
}

async function resolveWritableSkillRoot(
  homePath: string,
  homeRelativeRoot: string
): Promise<{ targetRoot: string; writableRoot: string }> {
  const targetRoot = assertSafeHomeRelativeRoot(homePath, homeRelativeRoot);

  let rootStats: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    rootStats = await lstat(targetRoot);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  if (!rootStats) {
    const nearestAncestor = await findNearestExistingAncestor(dirname(targetRoot));
    if (nearestAncestor && !isWithinDirectoryOrSame(homePath, nearestAncestor)) {
      throw new Error(`Invalid WSL agent skill root: ${homeRelativeRoot}`);
    }
    return {
      targetRoot,
      writableRoot: targetRoot,
    };
  }

  if (rootStats.isSymbolicLink()) {
    const linkedPath = await readlink(targetRoot);
    const writableRoot = resolve(dirname(targetRoot), linkedPath);
    if (!isWithinDirectoryOrSame(homePath, writableRoot)) {
      throw new Error(`Invalid WSL agent skill root: ${homeRelativeRoot}`);
    }

    try {
      const targetStats = await stat(targetRoot);
      if (!targetStats.isDirectory()) {
        throw new Error(`Invalid WSL agent skill root: ${homeRelativeRoot}`);
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }

      const nearestAncestor = await findNearestExistingAncestor(dirname(writableRoot));
      if (nearestAncestor && !isWithinDirectoryOrSame(homePath, nearestAncestor)) {
        throw new Error(`Invalid WSL agent skill root: ${homeRelativeRoot}`);
      }
    }

    return {
      targetRoot,
      writableRoot,
    };
  }

  if (!rootStats.isDirectory()) {
    throw new Error(`Invalid WSL agent skill root: ${homeRelativeRoot}`);
  }

  const writableRoot = await realpath(targetRoot);
  if (!isWithinDirectoryOrSame(homePath, writableRoot)) {
    throw new Error(`Invalid WSL agent skill root: ${homeRelativeRoot}`);
  }

  return {
    targetRoot,
    writableRoot,
  };
}

async function writeRootSnapshot(
  rootPath: string,
  rootSnapshot: WslAgentSkillExportSnapshot["roots"][number]
) {
  for (const skill of rootSnapshot.skills) {
    const skillDir = join(rootPath, skill.slug);
    if (!isWithinDirectoryOrSame(rootPath, skillDir)) {
      throw new Error(`Invalid WSL agent skill slug: ${skill.slug}`);
    }

    await mkdir(skillDir, { recursive: true });

    for (const file of skill.files) {
      const targetPath = assertSafeSkillFilePath(skillDir, file.relativePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, Buffer.from(file.contentBase64, "base64"));
    }
  }
}

async function prepareRootPromotions(input: {
  homePath: string;
  snapshot: WslAgentSkillExportSnapshot;
}): Promise<PreparedRootPromotion[]> {
  const preparedRoots: PreparedRootPromotion[] = [];
  const seenWritableRoots = new Set<string>();

  try {
    for (const rootSnapshot of input.snapshot.roots) {
      const { writableRoot } = await resolveWritableSkillRoot(
        input.homePath,
        rootSnapshot.homeRelativeRoot
      );
      if (seenWritableRoots.has(writableRoot)) {
        throw new Error(`Duplicate WSL agent skill root target: ${rootSnapshot.homeRelativeRoot}`);
      }
      seenWritableRoots.add(writableRoot);

      const parentDir = dirname(writableRoot);
      await mkdir(parentDir, { recursive: true });
      const rootName = basename(writableRoot) || "skills";
      const stagingDir = await mkdtemp(join(parentDir, `${rootName}.staging-`));
      try {
        await writeRootSnapshot(stagingDir, rootSnapshot);
      } catch (error) {
        await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }

      preparedRoots.push({
        homeRelativeRoot: rootSnapshot.homeRelativeRoot,
        writableRoot,
        stagingDir,
        backupDir: `${writableRoot}.backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        rollbackDir: `${writableRoot}.rollback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        backupCreated: false,
        promoted: false,
      });
    }
  } catch (error) {
    await Promise.all(
      preparedRoots.map((root) =>
        rm(root.stagingDir, { recursive: true, force: true }).catch(() => undefined)
      )
    );
    throw error;
  }

  return preparedRoots;
}

async function rollbackPreparedRoots(preparedRoots: PreparedRootPromotion[]): Promise<void> {
  const rollbackErrors: Error[] = [];

  for (const root of [...preparedRoots].reverse()) {
    try {
      if (root.promoted) {
        if (root.backupCreated) {
          await rename(root.writableRoot, root.rollbackDir);
          await rename(root.backupDir, root.writableRoot);
          await rm(root.rollbackDir, { recursive: true, force: true });
          root.backupCreated = false;
        } else {
          await rm(root.writableRoot, { recursive: true, force: true });
        }
        root.promoted = false;
        continue;
      }

      if (root.backupCreated) {
        await rename(root.backupDir, root.writableRoot);
        root.backupCreated = false;
      }
    } catch (error) {
      rollbackErrors.push(new Error(`${root.homeRelativeRoot}: ${formatErrorMessage(error)}`));
    }
  }

  await Promise.all(
    preparedRoots.map((root) =>
      rm(root.stagingDir, { recursive: true, force: true }).catch(() => undefined)
    )
  );

  if (rollbackErrors.length > 0) {
    throw new Error(
      `Failed to roll back mirrored WSL skills: ${rollbackErrors.map((error) => error.message).join("; ")}`
    );
  }
}

async function promotePreparedRoots(preparedRoots: PreparedRootPromotion[]): Promise<void> {
  try {
    for (const root of preparedRoots) {
      try {
        await rename(root.writableRoot, root.backupDir);
        root.backupCreated = true;
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }

      await rename(root.stagingDir, root.writableRoot);
      root.promoted = true;
    }
  } catch (promotionError) {
    try {
      await rollbackPreparedRoots(preparedRoots);
    } catch (rollbackError) {
      throw new Error(
        `Failed to promote mirrored WSL skills (${formatErrorMessage(promotionError)}); rollback also failed (${formatErrorMessage(rollbackError)})`
      );
    }

    throw promotionError;
  }

  await Promise.all(
    preparedRoots.map(async (root) => {
      if (!root.backupCreated) {
        return;
      }
      await rm(root.backupDir, { recursive: true, force: true }).catch(() => undefined);
      root.backupCreated = false;
    })
  );
}

export async function mirrorWslAgentSkillSnapshot(input: {
  homePath?: string;
  snapshot: WslAgentSkillExportSnapshot;
}): Promise<void> {
  const homePath = resolve(input.homePath ?? homedir());
  const preparedRoots = await prepareRootPromotions({
    homePath,
    snapshot: input.snapshot,
  });

  await promotePreparedRoots(preparedRoots);
}

function assertRelaySuccess(result: Result): WslAgentSkillExportSnapshot {
  if (!result.ok) {
    throw new Error(result.error?.message ?? "WSL agent skill export failed");
  }

  return result.data as WslAgentSkillExportSnapshot;
}

export async function syncWindowsAgentSkillsFromHost(input: {
  homePath?: string;
  relayHostCommand: (input: RelayHostCommandInput) => Promise<Result>;
}): Promise<void> {
  const result = await input.relayHostCommand({
    id: "skill-sync",
    op: "workspace.wsl.exportAgentSkills",
    args: {},
  });

  await mirrorWslAgentSkillSnapshot({
    homePath: input.homePath,
    snapshot: assertRelaySuccess(result),
  });
}
