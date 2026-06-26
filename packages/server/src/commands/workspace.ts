/**
 * Workspace Commands
 */

import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { WorkspacePaneNode } from "@coder-studio/core";
import { z } from "zod";
import { createDirectory } from "../fs/file-io.js";
import { registerHostCommand } from "../host/command-registry.js";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import { WorkspaceHistoryStore } from "../workspace/history-store.js";
import { inspectWorkspaceIntelligence } from "../workspace/intelligence.js";
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

const workspacePaneLeafSchema = z.union([
  z
    .object({
      id: z.string(),
      type: z.literal("leaf"),
      leafKind: z.undefined().optional(),
      sessionId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      type: z.literal("leaf"),
      leafKind: z.literal("draft"),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      type: z.literal("leaf"),
      leafKind: z.literal("session"),
      sessionId: z.string(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      type: z.literal("leaf"),
      leafKind: z.literal("editor"),
    })
    .strict(),
]);

const workspacePaneNodeSchema: z.ZodType<WorkspacePaneNode> = z.lazy(() =>
  z.union([
    workspacePaneLeafSchema,
    z.object({
      id: z.string(),
      type: z.literal("split"),
      direction: z.enum(["horizontal", "vertical"]).optional(),
      children: z.array(workspacePaneNodeSchema).optional(),
    }),
  ])
);

const MAX_BROWSER_VIEWPORT_DIMENSION = 4096;

const workspaceEditorTabSchema = z.union([
  z
    .object({
      kind: z.literal("file"),
      path: z.string(),
      pinned: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("browser"),
      id: z.string(),
      url: z.string().nullable(),
      devicePreset: z.enum(["desktop", "iphone-14", "pixel-7", "custom"]),
      viewportWidth: z.number().int().positive().max(MAX_BROWSER_VIEWPORT_DIMENSION).nullable(),
      viewportHeight: z.number().int().positive().max(MAX_BROWSER_VIEWPORT_DIMENSION).nullable(),
      orientation: z.enum(["portrait", "landscape"]),
      userAgentMode: z.enum(["desktop", "mobile"]),
    })
    .strict(),
]);

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

    const directories = (
      await Promise.all(
        entries.map(async (entry) => {
          if (entry.isDirectory()) {
            return {
              name: entry.name,
              path: join(basePath, entry.name),
            };
          }

          if (!entry.isSymbolicLink()) {
            return null;
          }

          const entryPath = join(basePath, entry.name);
          const entryStats = await stat(entryPath).catch(() => null);
          if (!entryStats?.isDirectory()) {
            return null;
          }

          return {
            name: entry.name,
            path: entryPath,
          };
        })
      )
    )
      .filter((entry): entry is { name: string; path: string } => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      currentPath: basePath,
      parentPath: basePath !== "/" ? join(basePath, "..") : null,
      directories,
      rootPaths: await buildRootPaths(basePath),
    };
  }
);

registerCommand(
  "workspace.mkdir",
  z.object({
    path: z.string(),
  }),
  async (args) => {
    const requestedName = basename(args.path);

    if (!requestedName || requestedName === "." || requestedName === "..") {
      throw { code: "invalid_path", message: "Folder name is required" };
    }

    const targetPath = resolveBrowsePath(args.path);
    const parentPath = dirname(targetPath);
    const dirName = basename(targetPath);

    if (!dirName || dirName === "." || dirName === "..") {
      throw { code: "invalid_path", message: "Folder name is required" };
    }

    await createDirectory(parentPath, dirName);
    return { ok: true };
  }
);

// workspace.open
registerHostCommand(
  "workspace.open",
  z.object({
    path: z.string(),
  }),
  async (args, ctx) => {
    const targetRuntime = "native";
    const workspace = await ctx.workspaceMgr.open({
      path: args.path,
      targetRuntime,
    });

    ctx.runtimeBindings?.bindWorkspace(workspace.id, "native-default");
    ctx.settingsRepo && new WorkspaceHistoryStore(ctx.settingsRepo).recordOpen(workspace.path);
    await (
      ctx as {
        agentInstructionPublisher?: {
          syncWorkspace(workspaceId: string): Promise<void>;
        };
      }
    ).agentInstructionPublisher?.syncWorkspace(workspace.id);
    return workspace;
  }
);

registerRuntimeCommand(
  "workspace.intelligence",
  z.object({
    workspaceId: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      return inspectWorkspaceIntelligence({
        workspaceId: workspace.id,
        rootPath: workspace.path,
      });
    },
  }
);

// workspace.close
registerHostCommand(
  "workspace.close",
  z.object({
    id: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.id);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.id}` };
    }

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
      editorPinned: z.boolean().optional(),
      editorViewVisible: z.boolean().optional(),
      activeSessionId: z.string().optional(),
      agentInstructionsExpanded: z.boolean().optional(),
      fileTreeExpandedDirs: z.array(z.string()).optional(),
      paneLayout: workspacePaneNodeSchema.optional(),
      openEditorPaths: z.array(z.string()).optional(),
      activeEditorPath: z.string().nullable().optional(),
      openEditorTabs: z.array(workspaceEditorTabSchema).optional(),
      activeEditorTab: workspaceEditorTabSchema.nullable().optional(),
      devBrowserTargetUrl: z.string().nullable().optional(),
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
