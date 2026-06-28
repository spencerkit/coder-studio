import { constants } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import type {
  WslAgentSkillDirectorySnapshot,
  WslAgentSkillExportSnapshot,
} from "./wsl-skill-snapshot.js";

function isPathInsideHome(homePath: string, absolutePath: string): boolean {
  const relativePath = relative(homePath, absolutePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function normalizeHomeRelativeRoot(homePath: string, absolutePath: string): string | null {
  if (!isPathInsideHome(homePath, absolutePath)) {
    return null;
  }

  const relativePath = relative(homePath, absolutePath).replace(/\\/g, "/");
  return relativePath.length > 0 ? relativePath : ".";
}

export function collectHomeRelativeSkillRoots(
  providers: ProviderDefinition[],
  homePath: string = homedir()
): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];

  for (const provider of providers) {
    for (const skillDir of provider.skillMountDirectories ?? []) {
      const homeRelativeRoot = normalizeHomeRelativeRoot(homePath, skillDir);
      if (!homeRelativeRoot || seen.has(homeRelativeRoot)) {
        continue;
      }

      seen.add(homeRelativeRoot);
      roots.push(homeRelativeRoot);
    }
  }

  return roots;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function exportSkillDirectory(
  rootPath: string,
  slug: string
): Promise<WslAgentSkillDirectorySnapshot> {
  const files: WslAgentSkillDirectorySnapshot["files"] = [];
  const skillPath = join(rootPath, slug);
  const visitedDirectories = new Set<string>();

  async function walk(relativeDir = ""): Promise<void> {
    const currentPath = relativeDir ? join(skillPath, relativeDir) : skillPath;
    const resolvedCurrentPath = await realpath(currentPath);
    if (visitedDirectories.has(resolvedCurrentPath)) {
      return;
    }

    visitedDirectories.add(resolvedCurrentPath);
    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const childRelativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const childPath = join(skillPath, childRelativePath);

      if (entry.isDirectory()) {
        await walk(childRelativePath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        const target = await stat(childPath);
        if (target.isDirectory()) {
          await walk(childRelativePath);
          continue;
        }
        if (!target.isFile()) {
          continue;
        }
      } else if (!entry.isFile()) {
        continue;
      }

      files.push({
        relativePath: childRelativePath,
        contentBase64: (await readFile(childPath)).toString("base64"),
      });
    }
  }

  await walk();
  files.sort((left, right) => {
    if (left.relativePath < right.relativePath) {
      return -1;
    }
    if (left.relativePath > right.relativePath) {
      return 1;
    }
    return 0;
  });

  return {
    slug,
    files,
  };
}

async function listSkillSlugs(rootPath: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const slugs: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    if (await exists(join(rootPath, entry.name, "SKILL.md"))) {
      slugs.push(entry.name);
    }
  }

  return slugs;
}

export async function exportAgentSkillSnapshot(input: {
  homePath?: string;
  providerRegistry: ProviderDefinition[];
}): Promise<WslAgentSkillExportSnapshot> {
  const homePath = input.homePath ?? homedir();
  const roots = collectHomeRelativeSkillRoots(input.providerRegistry, homePath);

  return {
    roots: await Promise.all(
      roots.map(async (homeRelativeRoot) => {
        const rootPath = join(homePath, homeRelativeRoot);
        const slugs = await listSkillSlugs(rootPath);
        return {
          homeRelativeRoot,
          skills: await Promise.all(slugs.map((slug) => exportSkillDirectory(rootPath, slug))),
        };
      })
    ),
  };
}
