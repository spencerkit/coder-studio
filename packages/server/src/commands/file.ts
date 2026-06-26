/**
 * File System Commands
 */

import { z } from "zod";
import { searchFileContents } from "../fs/content-search.js";
import {
  createDirectory,
  createFile,
  deleteEntry,
  readFile as readWorkspaceFile,
  renameEntry,
  writeFile as writeWorkspaceFile,
} from "../fs/file-io.js";
import {
  applySearchSession,
  createSearchSession,
  previewSearchSessionFile,
} from "../fs/search-replace.js";
import { readTree, searchFiles } from "../fs/tree.js";
import { registerRuntimeCommand } from "../runtime/command-registry.js";

// file.readTree
registerRuntimeCommand(
  "file.readTree",
  z.object({
    workspaceId: z.string(),
    subPath: z.string().optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      return readTree(workspace.path, args.subPath);
    },
  }
);

// file.search
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
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      return searchFiles(workspace.path, args.query, args.limit ?? 10);
    },
  }
);

// file.searchContent
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
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      return searchFileContents(workspace.path, {
        query: args.query,
        maxFiles: args.maxFiles,
        maxMatchesPerFile: args.maxMatchesPerFile,
      });
    },
  }
);

// file.read
registerRuntimeCommand(
  "file.read",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      return readWorkspaceFile(args.workspaceId, workspace.path, args.path);
    },
  }
);

// file.searchSession.start
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
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

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

// file.searchSession.previewFile
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
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      const result = await previewSearchSessionFile(workspace.path, args.sessionId, args.path);
      if (!result) {
        throw { code: "stale_session", message: "Search session is stale or missing" };
      }

      return result;
    },
  }
);

// file.searchSession.apply
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
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

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

// file.create
registerRuntimeCommand(
  "file.create",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

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

// file.mkdir
registerRuntimeCommand(
  "file.mkdir",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

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

// file.delete
registerRuntimeCommand(
  "file.delete",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

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

// file.rename
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
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

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

// file.write
registerRuntimeCommand(
  "file.write",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    content: z.string(),
    baseHash: z.string().optional(), // For conflict detection
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

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
