/**
 * File System Commands
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';
import { readTree } from '../fs/tree.js';
import { createDirectory, createFile, deleteEntry, readFile, writeFile } from '../fs/file-io.js';

// file.readTree
registerCommand(
  'file.readTree',
  z.object({
    workspaceId: z.string(),
    subPath: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    return readTree(workspace.path, args.subPath);
  }
);

// file.read
registerCommand(
  'file.read',
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    return readFile(args.workspaceId, workspace.path, args.path);
  }
);

// file.create
registerCommand(
  'file.create',
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    await createFile(workspace.path, args.path);
    return { ok: true };
  }
);

// file.mkdir
registerCommand(
  'file.mkdir',
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    await createDirectory(workspace.path, args.path);
    return { ok: true };
  }
);

// file.delete
registerCommand(
  'file.delete',
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    await deleteEntry(workspace.path, args.path);
    return { ok: true };
  }
);

// file.write
registerCommand(
  'file.write',
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    content: z.string(),
    baseHash: z.string().optional(), // For conflict detection
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }

    return writeFile(workspace.path, args.path, args.content, args.baseHash);
  }
);
