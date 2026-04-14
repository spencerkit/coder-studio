/**
 * Git Commands
 *
 * Note: These are placeholder implementations
 * Real implementations will use the git/ layer when it's built
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// git.status
registerCommand(
  'git.status',
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    try {
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: workspace.path,
      });

      const files = stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const status = line.substring(0, 2).trim();
          const path = line.substring(3);

          return {
            path,
            status: status as any,
            staged: status[0] !== ' ' && status[0] !== '?',
            modified: status[1] !== ' ',
          };
        });

      return {
        files,
        branch: '', // TODO: Get current branch
        ahead: 0, // TODO: Get ahead/behind count
        behind: 0,
      };
    } catch (error: any) {
      throw new Error(`Failed to get git status: ${error.message}`);
    }
  }
);

// git.diff
registerCommand(
  'git.diff',
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    staged: z.boolean().optional(),
  }),
  async (args, ctx) => {
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    try {
      const stagedFlag = args.staged ? '--staged' : '';
      const { stdout } = await execAsync(
        `git diff ${stagedFlag} -- "${args.path}"`,
        {
          cwd: workspace.path,
        }
      );

      return stdout;
    } catch (error: any) {
      throw new Error(`Failed to get diff: ${error.message}`);
    }
  }
);

// git.stage
registerCommand(
  'git.stage',
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  async (args, ctx) => {
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    try {
      const paths = args.paths.map((p) => `"${p}"`).join(' ');
      await execAsync(`git add ${paths}`, {
        cwd: workspace.path,
      });
    } catch (error: any) {
      throw new Error(`Failed to stage files: ${error.message}`);
    }
  }
);

// git.unstage
registerCommand(
  'git.unstage',
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  async (args, ctx) => {
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    try {
      const paths = args.paths.map((p) => `"${p}"`).join(' ');
      await execAsync(`git reset HEAD ${paths}`, {
        cwd: workspace.path,
      });
    } catch (error: any) {
      throw new Error(`Failed to unstage files: ${error.message}`);
    }
  }
);

// git.discard
registerCommand(
  'git.discard',
  z.object({
    workspaceId: z.string(),
    paths: z.array(z.string()),
  }),
  async (args, ctx) => {
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    try {
      const paths = args.paths.map((p) => `"${p}"`).join(' ');
      await execAsync(`git checkout -- ${paths}`, {
        cwd: workspace.path,
      });
    } catch (error: any) {
      throw new Error(`Failed to discard changes: ${error.message}`);
    }
  }
);

// git.commit
registerCommand(
  'git.commit',
  z.object({
    workspaceId: z.string(),
    message: z.string(),
  }),
  async (args, ctx) => {
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    try {
      const { stdout } = await execAsync(`git commit -m "${args.message}"`, {
        cwd: workspace.path,
      });

      // Extract SHA from output
      const match = stdout.match(/\[.* ([a-f0-9]+)\]/);
      const sha = match ? match[1] : '';

      return { sha };
    } catch (error: any) {
      throw new Error(`Failed to commit: ${error.message}`);
    }
  }
);
