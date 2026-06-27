import { readFile as readFileBytes, realpath, stat } from "node:fs/promises";
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
import { registerRuntimeCommand } from "../../runtime/command-registry.js";
import type { RuntimeCommandContext } from "../../runtime/context.js";
import {
  broadcastSkillLibraryChanged,
  requireSkillsQuerySupport,
  resolveSkillRuntimeTarget,
  skillRuntimeTargetSchema,
} from "./shared.js";

function getLocalSkillEntry(ctx: RuntimeCommandContext, skillSlug: string) {
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

function broadcastSkillFilesChanged(
  ctx: Pick<RuntimeCommandContext, "hostBridge">,
  skillSlug: string
): void {
  broadcastSkillLibraryChanged(ctx, {
    reason: "skill_files_changed",
    skillSlug,
  });
}

export async function readSkillTree(skillRoot: string, subPath?: string) {
  return readTree(skillRoot, subPath);
}

export async function readSkillFile(
  skillSlug: string,
  skillRoot: string,
  relPath: string,
  options?: {
    workspaceId?: string;
  }
) {
  const result = await readWorkspaceFile(skillSlug, skillRoot, relPath);
  const displayPath = await toDisplayPath(skillRoot, relPath);

  if (result.kind === "image") {
    const params = new URLSearchParams();
    if (options?.workspaceId) {
      params.set("workspaceId", options.workspaceId);
    }
    params.set("skillSlug", skillSlug);
    params.set("path", relPath);
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

async function readSkillImageAsset(skillRoot: string, relPath: string) {
  const asset = await resolveSkillImageAsset(skillRoot, relPath);
  const bytes = await readFileBytes(asset.absPath);
  return {
    mime: asset.mime,
    size: asset.size,
    bytesBase64: bytes.toString("base64"),
  };
}

export function registerSkillFileCommands(): void {
  registerRuntimeCommand(
    "skills.files.readTree",
    skillRuntimeTargetSchema.extend({
      skillSlug: z.string().trim().min(1),
      path: z.string().optional(),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        const entry = getLocalSkillEntry(ctx, args.skillSlug);
        return readSkillTree(entry.libraryPath, args.path);
      },
    }
  );

  registerRuntimeCommand(
    "skills.files.read",
    skillRuntimeTargetSchema.extend({
      skillSlug: z.string().trim().min(1),
      path: z.string().trim().min(1),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        const entry = getLocalSkillEntry(ctx, args.skillSlug);
        return readSkillFile(args.skillSlug, entry.libraryPath, args.path, {
          workspaceId: args.workspaceId,
        });
      },
    }
  );

  registerRuntimeCommand(
    "skills.files.readAsset",
    skillRuntimeTargetSchema.extend({
      skillSlug: z.string().trim().min(1),
      path: z.string().trim().min(1),
    }),
    {
      visibility: "internal",
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        const entry = getLocalSkillEntry(ctx, args.skillSlug);
        return readSkillImageAsset(entry.libraryPath, args.path);
      },
    }
  );

  registerRuntimeCommand(
    "skills.files.write",
    skillRuntimeTargetSchema.extend({
      skillSlug: z.string().trim().min(1),
      path: z.string().trim().min(1),
      content: z.string(),
      baseHash: z.string().optional(),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        const entry = getLocalSkillEntry(ctx, args.skillSlug);
        const result = await writeWorkspaceFile(
          entry.libraryPath,
          args.path,
          args.content,
          args.baseHash
        );
        broadcastSkillFilesChanged(ctx, args.skillSlug);
        return result;
      },
    }
  );

  registerRuntimeCommand(
    "skills.files.create",
    skillRuntimeTargetSchema.extend({
      skillSlug: z.string().trim().min(1),
      path: z.string().trim().min(1),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        const entry = getLocalSkillEntry(ctx, args.skillSlug);
        await createFile(entry.libraryPath, args.path);
        broadcastSkillFilesChanged(ctx, args.skillSlug);
        return { ok: true };
      },
    }
  );

  registerRuntimeCommand(
    "skills.files.mkdir",
    skillRuntimeTargetSchema.extend({
      skillSlug: z.string().trim().min(1),
      path: z.string().trim().min(1),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        const entry = getLocalSkillEntry(ctx, args.skillSlug);
        await createDirectory(entry.libraryPath, args.path);
        broadcastSkillFilesChanged(ctx, args.skillSlug);
        return { ok: true };
      },
    }
  );

  registerRuntimeCommand(
    "skills.files.rename",
    skillRuntimeTargetSchema.extend({
      skillSlug: z.string().trim().min(1),
      fromPath: z.string().trim().min(1),
      toPath: z.string().trim().min(1),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        const entry = getLocalSkillEntry(ctx, args.skillSlug);
        await renameEntry(entry.libraryPath, args.fromPath, args.toPath);
        broadcastSkillFilesChanged(ctx, args.skillSlug);
        return { ok: true };
      },
    }
  );

  registerRuntimeCommand(
    "skills.files.delete",
    skillRuntimeTargetSchema.extend({
      skillSlug: z.string().trim().min(1),
      path: z.string().trim().min(1),
    }),
    {
      resolveTarget: (args) => resolveSkillRuntimeTarget(args),
      handler: async (args, ctx) => {
        const entry = getLocalSkillEntry(ctx, args.skillSlug);
        await deleteEntry(entry.libraryPath, args.path);
        broadcastSkillFilesChanged(ctx, args.skillSlug);
        return { ok: true };
      },
    }
  );
}
