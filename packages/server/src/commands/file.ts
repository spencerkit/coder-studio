/**
 * File System Commands
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';
import { readTree, type FileNode } from '../fs/tree.js';
import { readFile, writeFile } from '../fs/file-io.js';

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
