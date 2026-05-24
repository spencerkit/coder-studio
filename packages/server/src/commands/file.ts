/**
 * File System Commands
 */

import { z } from "zod";
import { searchFileContents } from "../fs/content-search.js";
import {
  createDirectory,
  createFile,
  deleteEntry,
  readFile,
  renameEntry,
  writeFile,
} from "../fs/file-io.js";
import { readTree, searchFiles } from "../fs/tree.js";
import { registerCommand } from "../ws/dispatch.js";

// file.readTree
registerCommand(
  "file.readTree",
  z.object({
    workspaceId: z.string(),
    subPath: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return readTree(workspace.path, args.subPath);
  }
);

// file.search
registerCommand(
  "file.search",
  z.object({
    workspaceId: z.string(),
    query: z.string(),
    limit: z.number().int().positive().max(50).optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return searchFiles(workspace.path, args.query, args.limit ?? 10);
  }
);

// file.searchContent
registerCommand(
  "file.searchContent",
  z.object({
    workspaceId: z.string(),
    query: z.string(),
    maxFiles: z.number().int().positive().max(100),
    maxMatchesPerFile: z.number().int().positive().max(100),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return searchFileContents(workspace.path, {
      query: args.query,
      maxFiles: args.maxFiles,
      maxMatchesPerFile: args.maxMatchesPerFile,
    });
  }
);

// file.read
registerCommand(
  "file.read",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return readFile(args.workspaceId, workspace.path, args.path);
  }
);

// file.create
registerCommand(
  "file.create",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
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
  }
);

// file.mkdir
registerCommand(
  "file.mkdir",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
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
  }
);

// file.delete
registerCommand(
  "file.delete",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
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
  }
);

// file.rename
registerCommand(
  "file.rename",
  z.object({
    workspaceId: z.string(),
    fromPath: z.string(),
    toPath: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
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
  }
);

// file.write
registerCommand(
  "file.write",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    content: z.string(),
    baseHash: z.string().optional(), // For conflict detection
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const result = await writeFile(workspace.path, args.path, args.content, args.baseHash);
    ctx.eventBus.emit({
      type: "fs.dirty",
      workspaceId: args.workspaceId,
      reason: "file_content",
    });
    return result;
  }
);
