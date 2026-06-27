/**
 * File System Commands
 */

import { readFile as readFileBytes, realpath, stat } from "node:fs/promises";
import { z } from "zod";
import { browseDirectoryAbsolute, createDirectoryAbsolute } from "../fs/browse.js";
import { searchFileContents } from "../fs/content-search.js";
import {
  createDirectory,
  createFile,
  deleteEntry,
  readFile as readWorkspaceFile,
  renameEntry,
  resolveSafe,
  writeFile as writeWorkspaceFile,
} from "../fs/file-io.js";
import { getImageTypeInfo } from "../fs/image.js";
import { isPathInsideRoot } from "../fs/path-safety.js";
import {
  applySearchSession,
  createSearchSession,
  previewSearchSessionFile,
} from "../fs/search-replace.js";
import { readTree, searchFiles } from "../fs/tree.js";
import { parseGitImageRevisionSelector, readImageAtRevision } from "../git/image-revision.js";
import { loadPreviewResource } from "../preview/resource-loader.js";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import type { RuntimeCommandContext } from "../runtime/context.js";

function getWorkspaceOrThrow(ctx: RuntimeCommandContext, workspaceId: string) {
  const workspace = ctx.workspaceLookup.get(workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
  }

  return workspace;
}

async function readWorkspaceImageAsset(
  workspacePath: string,
  relPath: string,
  revision?: string
): Promise<{ mime: string; size: number; bytesBase64: string }> {
  const typeInfo = getImageTypeInfo(relPath);
  if (!typeInfo) {
    throw { code: "not_an_image", message: "Only image files are supported" };
  }

  const revisionSelector = revision ? parseGitImageRevisionSelector(revision) : null;
  if (revision && !revisionSelector) {
    throw { code: "invalid_revision", message: "Invalid revision selector" };
  }

  if (revisionSelector) {
    try {
      const asset = await readImageAtRevision(workspacePath, revisionSelector, relPath);
      if (!asset.exists || !asset.bytes) {
        throw new Error("not_found");
      }

      return {
        mime: asset.mime,
        size: asset.bytes.byteLength,
        bytesBase64: asset.bytes.toString("base64"),
      };
    } catch {
      throw { code: "not_found", message: "File not found" };
    }
  }

  const absPath = resolveSafe(workspacePath, relPath);
  let realWorkspacePath: string;
  let realAssetPath: string;
  try {
    [realWorkspacePath, realAssetPath] = await Promise.all([
      realpath(workspacePath),
      realpath(absPath),
    ]);
  } catch {
    throw { code: "not_found", message: "File not found" };
  }

  if (!isPathInsideRoot(realWorkspacePath, realAssetPath)) {
    throw { code: "path_escape", message: "Path escapes workspace root" };
  }

  const [bytes, fileStats] = await Promise.all([
    readFileBytes(absPath).catch(() => null),
    stat(absPath).catch(() => null),
  ]);

  if (!bytes || !fileStats?.isFile()) {
    throw { code: "not_found", message: "File not found" };
  }

  return {
    mime: typeInfo.mime,
    size: fileStats.size,
    bytesBase64: bytes.toString("base64"),
  };
}

async function readWorkspacePreviewResourceAsset(
  workspacePath: string,
  relPath: string
): Promise<{ mime: string; size: number; bytesBase64: string; workspaceRelativePath: string }> {
  try {
    const resource = await loadPreviewResource(workspacePath, relPath);
    return {
      mime: resource.mime,
      size: resource.size,
      bytesBase64: resource.bytes.toString("base64"),
      workspaceRelativePath: resource.workspaceRelativePath,
    };
  } catch (error) {
    const code = (error as { code?: string })?.code ?? (error as Error).message;
    if (code === "path_escape") {
      throw { code: "path_escape", message: "Path escapes workspace root" };
    }

    throw { code: "not_found", message: "File not found" };
  }
}

registerRuntimeCommand(
  "file.browse",
  z.object({
    workspaceId: z.string(),
    path: z.string().optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return browseDirectoryAbsolute(args.path ?? workspace.path);
    },
  }
);

registerRuntimeCommand(
  "file.readTree",
  z.object({
    workspaceId: z.string(),
    subPath: z.string().optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return readTree(workspace.path, args.subPath);
    },
  }
);

registerRuntimeCommand(
  "file.search",
  z.object({
    workspaceId: z.string(),
    query: z.string(),
    limit: z.number().int().positive().max(50).optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return searchFiles(workspace.path, args.query, args.limit ?? 10);
    },
  }
);

registerRuntimeCommand(
  "file.searchContent",
  z.object({
    workspaceId: z.string(),
    query: z.string(),
    maxFiles: z.number().int().positive().max(100),
    maxMatchesPerFile: z.number().int().positive().max(100),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return searchFileContents(workspace.path, {
        query: args.query,
        maxFiles: args.maxFiles,
        maxMatchesPerFile: args.maxMatchesPerFile,
      });
    },
  }
);

registerRuntimeCommand(
  "file.read",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return readWorkspaceFile(args.workspaceId, workspace.path, args.path);
    },
  }
);

registerRuntimeCommand(
  "file.asset.read",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    revision: z.string().optional(),
  }),
  {
    visibility: "internal",
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return readWorkspaceImageAsset(workspace.path, args.path, args.revision);
    },
  }
);

registerRuntimeCommand(
  "file.previewResource.read",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    visibility: "internal",
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      return readWorkspacePreviewResourceAsset(workspace.path, args.path);
    },
  }
);

registerRuntimeCommand(
  "file.searchSession.start",
  z.object({
    workspaceId: z.string(),
    query: z.string(),
    replace: z.string(),
    isRegex: z.boolean(),
    matchCase: z.boolean(),
    matchWholeWord: z.boolean(),
    preserveCase: z.boolean(),
    includeGlobs: z.array(z.string()),
    excludeGlobs: z.array(z.string()),
    useIgnoreFiles: z.boolean(),
    useExcludeSettings: z.boolean(),
    onlyOpenEditors: z.boolean(),
    openEditorPaths: z.array(z.string()),
    maxFiles: z.number().int().positive().max(100),
    maxMatchesPerFile: z.number().int().positive().max(100),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      const result = await createSearchSession(workspace.path, {
        query: args.query,
        replace: args.replace,
        isRegex: args.isRegex,
        matchCase: args.matchCase,
        matchWholeWord: args.matchWholeWord,
        preserveCase: args.preserveCase,
        includeGlobs: args.includeGlobs,
        excludeGlobs: args.excludeGlobs,
        useIgnoreFiles: args.useIgnoreFiles,
        useExcludeSettings: args.useExcludeSettings,
        onlyOpenEditors: args.onlyOpenEditors,
        openEditorPaths: args.openEditorPaths,
        maxFiles: args.maxFiles,
        maxMatchesPerFile: args.maxMatchesPerFile,
      });

      return result.result;
    },
  }
);

registerRuntimeCommand(
  "file.searchSession.previewFile",
  z.object({
    workspaceId: z.string(),
    sessionId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      const result = await previewSearchSessionFile(workspace.path, args.sessionId, args.path);
      if (!result) {
        throw { code: "stale_session", message: "Search session is stale or missing" };
      }

      return result;
    },
  }
);

registerRuntimeCommand(
  "file.searchSession.apply",
  z.object({
    workspaceId: z.string(),
    sessionId: z.string(),
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("all") }),
      z.object({ kind: z.literal("file"), path: z.string() }),
      z.object({ kind: z.literal("match"), path: z.string(), matchId: z.string() }),
    ]),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      const result = await applySearchSession(workspace.path, args.sessionId, args.scope);
      if (result.status === "ok" || result.status === "partial") {
        ctx.eventBus.emit({
          type: "fs.dirty",
          workspaceId: args.workspaceId,
          reason: "file_content",
        });
      }

      return result;
    },
  }
);

registerRuntimeCommand(
  "file.create",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      await createFile(workspace.path, args.path);
      ctx.eventBus.emit({
        type: "fs.dirty",
        workspaceId: args.workspaceId,
        reason: "fs_change",
      });
      return { ok: true };
    },
  }
);

registerRuntimeCommand(
  "file.mkdir",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      await createDirectory(workspace.path, args.path);
      ctx.eventBus.emit({
        type: "fs.dirty",
        workspaceId: args.workspaceId,
        reason: "fs_change",
      });
      return { ok: true };
    },
  }
);

registerRuntimeCommand(
  "file.mkdirAbsolute",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      getWorkspaceOrThrow(ctx, args.workspaceId);
      await createDirectoryAbsolute(args.path);
      ctx.eventBus.emit({
        type: "fs.dirty",
        workspaceId: args.workspaceId,
        reason: "fs_change",
      });
      return { ok: true };
    },
  }
);

registerRuntimeCommand(
  "file.delete",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      await deleteEntry(workspace.path, args.path);
      ctx.eventBus.emit({
        type: "fs.dirty",
        workspaceId: args.workspaceId,
        reason: "fs_change",
      });
      return { ok: true };
    },
  }
);

registerRuntimeCommand(
  "file.rename",
  z.object({
    workspaceId: z.string(),
    fromPath: z.string(),
    toPath: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      await renameEntry(workspace.path, args.fromPath, args.toPath);
      ctx.eventBus.emit({
        type: "fs.dirty",
        workspaceId: args.workspaceId,
        reason: "fs_change",
      });
      return { ok: true };
    },
  }
);

registerRuntimeCommand(
  "file.write",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    content: z.string(),
    baseHash: z.string().optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
      const result = await writeWorkspaceFile(
        workspace.path,
        args.path,
        args.content,
        args.baseHash
      );
      ctx.eventBus.emit({
        type: "fs.dirty",
        workspaceId: args.workspaceId,
        reason: "file_content",
      });
      return result;
    },
  }
);
