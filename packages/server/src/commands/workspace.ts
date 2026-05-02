/**
 * Workspace Commands
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// workspace.list
registerCommand(
  'workspace.list',
  z.object({}),
  async (_args, ctx) => {
    return ctx.workspaceMgr.list();
  }
);

// workspace.browse - List directories for path selection
registerCommand(
  'workspace.browse',
  z.object({
    path: z.string().optional(),
  }),
  async (args) => {
    const basePath = args.path || homedir();
    const entries = await readdir(basePath, { withFileTypes: true });

    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: join(basePath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      currentPath: basePath,
      parentPath: basePath !== '/' ? join(basePath, '..') : null,
      directories,
    };
  }
);

// workspace.open
registerCommand(
  'workspace.open',
  z.object({
    path: z.string(),
  }),
  async (args, ctx) => {
    return ctx.workspaceMgr.open({
      path: args.path,
    });
  }
);

// workspace.close
registerCommand(
  'workspace.close',
  z.object({
    id: z.string(),
  }),
  async (args, ctx) => {
    await ctx.workspaceMgr.close(args.id);
  }
);

registerCommand(
  'workspace.uiState.set',
  z.object({
    workspaceId: z.string(),
    uiState: z.object({
      leftPanelWidth: z.number(),
      bottomPanelHeight: z.number(),
      focusMode: z.boolean(),
      activeSessionId: z.string().optional(),
      paneLayout: z
        .object({
          id: z.string(),
          type: z.enum(['leaf', 'split']),
          sessionId: z.string().optional(),
          direction: z.enum(['horizontal', 'vertical']).optional(),
          children: z.lazy(() =>
            z.array(
              z.object({
                id: z.string(),
                type: z.enum(['leaf', 'split']),
                sessionId: z.string().optional(),
                direction: z.enum(['horizontal', 'vertical']).optional(),
                children: z.any().optional(),
              })
            )
          ).optional(),
        })
        .optional(),
    }),
  }),
  async (args, ctx) => {
    ctx.workspaceMgr.updateUiState(args.workspaceId, args.uiState);
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: 'workspace_not_found', message: `Workspace not found: ${args.workspaceId}` };
    }
    return workspace;
  }
);
