/**
 * File System Commands
 *
 * Note: These are placeholder implementations
 * Real implementations will use the fs/ layer when it's built
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

// file.readTree
registerCommand(
  'file.readTree',
  z.object({
    workspaceId: z.string(),
    subPath: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    const basePath = args.subPath
      ? path.join(workspace.path, args.subPath)
      : workspace.path;

    try {
      const entries = await fs.readdir(basePath, { withFileTypes: true });

      const nodes = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(basePath, entry.name);
          const relativePath = args.subPath
            ? path.join(args.subPath, entry.name)
            : entry.name;

          const stat = await fs.stat(fullPath);

          return {
            name: entry.name,
            path: relativePath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            modifiedAt: stat.mtime.getTime(),
          };
        })
      );

      return {
        path: args.subPath || '.',
        children: nodes,
      };
    } catch (error: any) {
      throw new Error(`Failed to read directory: ${error.message}`);
    }
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
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    const fullPath = path.join(workspace.path, args.path);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');

      return {
        content,
        baseHash: hash,
        encoding: 'utf-8',
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${args.path}`);
      }
      throw new Error(`Failed to read file: ${error.message}`);
    }
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
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    const fullPath = path.join(workspace.path, args.path);

    try {
      // Check for conflicts if baseHash provided
      if (args.baseHash) {
        try {
          const existing = await fs.readFile(fullPath, 'utf-8');
          const existingHash = createHash('sha256')
            .update(existing)
            .digest('hex');

          if (existingHash !== args.baseHash) {
            throw {
              code: 'conflict',
              message: 'File has been modified',
              details: {
                expectedHash: args.baseHash,
                actualHash: existingHash,
              },
            };
          }
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      // Write file
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, args.content, 'utf-8');

      const newHash = createHash('sha256').update(args.content).digest('hex');

      return {
        newHash,
      };
    } catch (error: any) {
      if (error.code === 'conflict') {
        throw error;
      }
      throw new Error(`Failed to write file: ${error.message}`);
    }
  }
);

// file.search
registerCommand(
  'file.search',
  z.object({
    workspaceId: z.string(),
    query: z.string(),
  }),
  async (args, ctx) => {
    const workspace = await ctx.db.workspace.findById(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.workspaceId}`);
    }

    // Simple filename search
    // TODO: Implement proper file search with indexing
    const results: any[] = [];

    async function search(dir: string, relativePath: string = '') {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const name = entry.name;
        const fullPath = path.join(dir, name);
        const relPath = relativePath ? path.join(relativePath, name) : name;

        if (name.toLowerCase().includes(args.query.toLowerCase())) {
          const stat = await fs.stat(fullPath);
          results.push({
            name,
            path: relPath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            modifiedAt: stat.mtime.getTime(),
          });
        }

        if (entry.isDirectory() && !name.startsWith('.') && name !== 'node_modules') {
          await search(fullPath, relPath);
        }
      }
    }

    try {
      await search(workspace.path);
      return results;
    } catch (error: any) {
      throw new Error(`Search failed: ${error.message}`);
    }
  }
);
