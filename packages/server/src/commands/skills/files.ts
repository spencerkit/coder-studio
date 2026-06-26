import { realpath, stat } from "node:fs/promises";
import { z } from "zod";
import {
  createDirectory,
  createFile,
  deleteEntry,
  readFile as readWorkspaceFile,
  renameEntry,
  resolveSafe,
  writeFile as writeWorkspaceFile,
} from "../../fs/file-io.js";
import { getImageTypeInfo } from "../../fs/image.js";
import { isPathInsideRoot } from "../../fs/path-safety.js";
import { readTree } from "../../fs/tree.js";
import type { CommandContext } from "../../ws/dispatch.js";
import { registerCommand } from "../../ws/dispatch.js";
import { broadcastSkillLibraryChanged, requireSkillsQuerySupport } from "./shared.js";

function getLocalSkillEntry(ctx: CommandContext, skillSlug: string) {
  requireSkillsQuerySupport(ctx);
  const entry = ctx.skillLibraryRepo.get(skillSlug);
  if (!entry || entry.source !== "custom") {
    throw { code: "skill_not_found", message: `Custom skill not found: ${skillSlug}` };
  }
  return entry;
}

async function toDisplayPath(skillRoot: string, relPath: string): Promise<string> {
  const absPath = resolveSafe(skillRoot, relPath);
  const [realRootPath, realTargetPath] = await Promise.all([
    realpath(skillRoot).catch(() => null),
    realpath(absPath).catch(() => null),
  ]);

  if (realRootPath && realTargetPath && !isPathInsideRoot(realRootPath, realTargetPath)) {
    throw { code: "path_escape", message: "Path escapes skill root" };
  }

  return absPath;
}

function broadcastSkillFilesChanged(ctx: CommandContext, skillSlug: string): void {
  broadcastSkillLibraryChanged(ctx, {
    reason: "skill_files_changed",
    skillSlug,
  });
}

export async function readSkillTree(skillRoot: string, subPath?: string) {
  return readTree(skillRoot, subPath);
}

export async function readSkillFile(skillSlug: string, skillRoot: string, relPath: string) {
  const result = await readWorkspaceFile(skillSlug, skillRoot, relPath);
  const displayPath = await toDisplayPath(skillRoot, relPath);

  if (result.kind === "image") {
    const params = new URLSearchParams({
      skillSlug,
      path: relPath,
    });
    return {
      ...result,
      url: `/api/skill-file?${params.toString()}`,
      displayPath,
    };
  }

  return {
    ...result,
    displayPath,
  };
}

export async function resolveSkillImageAsset(skillRoot: string, relPath: string) {
  const typeInfo = getImageTypeInfo(relPath);
  if (!typeInfo) {
    throw { code: "not_an_image", message: "Only image files are supported" };
  }

  const absPath = resolveSafe(skillRoot, relPath);
  const [realRootPath, realAssetPath] = await Promise.all([
    realpath(skillRoot).catch(() => null),
    realpath(absPath).catch(() => null),
  ]);

  if (!realRootPath || !realAssetPath) {
    throw { code: "not_found", message: "File not found" };
  }

  if (!isPathInsideRoot(realRootPath, realAssetPath)) {
    throw { code: "path_escape", message: "Path escapes skill root" };
  }

  const fileStats = await stat(absPath).catch(() => null);
  if (!fileStats?.isFile()) {
    throw { code: "not_found", message: "File not found" };
  }

  return {
    absPath,
    mime: typeInfo.mime,
    size: fileStats.size,
  };
}

export function registerSkillFileCommands(): void {
  registerCommand(
    "skills.files.readTree",
    z.object({
      skillSlug: z.string().trim().min(1),
      path: z.string().optional(),
    }),
    async (args, ctx) => {
      const entry = getLocalSkillEntry(ctx, args.skillSlug);
      return readSkillTree(entry.libraryPath, args.path);
    }
  );

  registerCommand(
    "skills.files.read",
    z.object({
      skillSlug: z.string().trim().min(1),
      path: z.string().trim().min(1),
    }),
    async (args, ctx) => {
      const entry = getLocalSkillEntry(ctx, args.skillSlug);
      return readSkillFile(args.skillSlug, entry.libraryPath, args.path);
    }
  );

  registerCommand(
    "skills.files.write",
    z.object({
      skillSlug: z.string().trim().min(1),
      path: z.string().trim().min(1),
      content: z.string(),
      baseHash: z.string().optional(),
    }),
    async (args, ctx) => {
      const entry = getLocalSkillEntry(ctx, args.skillSlug);
      const result = await writeWorkspaceFile(
        entry.libraryPath,
        args.path,
        args.content,
        args.baseHash
      );
      broadcastSkillFilesChanged(ctx, args.skillSlug);
      return result;
    }
  );

  registerCommand(
    "skills.files.create",
    z.object({
      skillSlug: z.string().trim().min(1),
      path: z.string().trim().min(1),
    }),
    async (args, ctx) => {
      const entry = getLocalSkillEntry(ctx, args.skillSlug);
      await createFile(entry.libraryPath, args.path);
      broadcastSkillFilesChanged(ctx, args.skillSlug);
      return { ok: true };
    }
  );

  registerCommand(
    "skills.files.mkdir",
    z.object({
      skillSlug: z.string().trim().min(1),
      path: z.string().trim().min(1),
    }),
    async (args, ctx) => {
      const entry = getLocalSkillEntry(ctx, args.skillSlug);
      await createDirectory(entry.libraryPath, args.path);
      broadcastSkillFilesChanged(ctx, args.skillSlug);
      return { ok: true };
    }
  );

  registerCommand(
    "skills.files.rename",
    z.object({
      skillSlug: z.string().trim().min(1),
      fromPath: z.string().trim().min(1),
      toPath: z.string().trim().min(1),
    }),
    async (args, ctx) => {
      const entry = getLocalSkillEntry(ctx, args.skillSlug);
      await renameEntry(entry.libraryPath, args.fromPath, args.toPath);
      broadcastSkillFilesChanged(ctx, args.skillSlug);
      return { ok: true };
    }
  );

  registerCommand(
    "skills.files.delete",
    z.object({
      skillSlug: z.string().trim().min(1),
      path: z.string().trim().min(1),
    }),
    async (args, ctx) => {
      const entry = getLocalSkillEntry(ctx, args.skillSlug);
      await deleteEntry(entry.libraryPath, args.path);
      broadcastSkillFilesChanged(ctx, args.skillSlug);
      return { ok: true };
    }
  );
}
