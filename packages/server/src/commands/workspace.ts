/**
 * Workspace Commands
 */

import { readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { WorkspacePaneNode } from "@coder-studio/core";
import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

function resolveBrowsePath(path: string | undefined): string {
  const home = homedir();

  if (!path || path === "~") {
    return home;
  }

  if (path.startsWith("~/")) {
    return join(home, path.slice(2));
  }

  return isAbsolute(path) ? path : resolve(home, path);
}

async function buildRootPaths(currentPath: string): Promise<string[]> {
  const roots = new Set<string>(["/"]);
  const home = homedir();

  roots.add(home);

  try {
    roots.add(await realpath(home));
  } catch {
    // Ignore realpath resolution failures and keep the visible home path.
  }

  const currentSegments = currentPath.split("/").filter(Boolean);
  if (currentSegments.length > 0) {
    roots.add(`/${currentSegments[0]}`);
  }

  return Array.from(roots);
}

const workspacePaneNodeSchema: z.ZodType<WorkspacePaneNode> = z.lazy(() =>
  z.union([
    z.object({
      id: z.string(),
      type: z.literal("leaf"),
      leafKind: z.enum(["draft", "session", "editor"]).optional(),
      sessionId: z.string().optional(),
    }),
    z.object({
      id: z.string(),
      type: z.literal("split"),
      direction: z.enum(["horizontal", "vertical"]).optional(),
      children: z.array(workspacePaneNodeSchema).optional(),
    }),
  ])
);

// workspace.list
registerCommand("workspace.list", z.object({}), async (_args, ctx) => {
  return ctx.workspaceMgr.list();
});

// workspace.browse - List directories for path selection
registerCommand(
  "workspace.browse",
  z.object({
    path: z.string().optional(),
  }),
  async (args) => {
    const basePath = resolveBrowsePath(args.path);
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
      parentPath: basePath !== "/" ? join(basePath, "..") : null,
      directories,
      rootPaths: await buildRootPaths(basePath),
    };
  }
);

// workspace.open
registerCommand(
  "workspace.open",
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
  "workspace.close",
  z.object({
    id: z.string(),
  }),
  async (args, ctx) => {
    await ctx.workspaceMgr.close(args.id);
  }
);

registerCommand(
  "workspace.uiState.set",
  z.object({
    workspaceId: z.string(),
    uiState: z.object({
      leftPanelWidth: z.number(),
      bottomPanelHeight: z.number(),
      focusMode: z.boolean(),
      activeSessionId: z.string().optional(),
      fileTreeExpandedDirs: z.array(z.string()).optional(),
      paneLayout: workspacePaneNodeSchema.optional(),
    }),
  }),
  async (args, ctx) => {
    ctx.workspaceMgr.updateUiState(args.workspaceId, args.uiState);
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }
    return workspace;
  }
);
