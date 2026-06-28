/**
 * Workspace Commands
 */

import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { WorkspacePaneNode } from "@coder-studio/core";
import { z } from "zod";
import { browseDirectoryAbsolute, createDirectoryAbsolute } from "../fs/browse.js";
import { registerHostCommand } from "../host/command-registry.js";
import { getRuntimeIdForWorkspace } from "../host/runtime-orchestrator.js";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import { exportAgentSkillSnapshot } from "../runtime/wsl-skill-export.js";
import { WorkspaceHistoryStore } from "../workspace/history-store.js";
import { inspectWorkspaceIntelligence } from "../workspace/intelligence.js";
import { browseWslDirectory, createWslDirectoryInDistro } from "../workspace/wsl-browse.js";
import { listWslDistros } from "../workspace/wsl-discovery.js";
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

function assertRequestedDirectoryPath(path: string): void {
  const requestedName = basename(path);

  if (!requestedName || requestedName === "." || requestedName === "..") {
    throw { code: "invalid_path", message: "Folder name is required" };
  }
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
  async (args) => browseDirectoryAbsolute(resolveBrowsePath(args.path))
);

registerCommand(
  "workspace.mkdir",
  z.object({
    path: z.string(),
  }),
  async (args) => {
    assertRequestedDirectoryPath(args.path);
    await createDirectoryAbsolute(resolveBrowsePath(args.path));
    return { ok: true };
  }
);

// workspace.open
registerHostCommand(
  "workspace.open",
  z.object({
    path: z.string(),
    targetRuntime: z.enum(["native", "wsl"]).optional(),
    wslDistro: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = await ctx.workspaceMgr.open({
      path: args.path,
      targetRuntime: args.targetRuntime,
      wslDistro: args.wslDistro,
    });

    if (ctx.runtimeOrchestrator) {
      await ctx.runtimeOrchestrator.ensureRuntimeForWorkspace(workspace);
    } else {
      ctx.runtimeBindings?.bindWorkspace(
        workspace.id,
        getRuntimeIdForWorkspace(workspace, "native-default")
      );
    }
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

registerHostCommand("workspace.wsl.listDistros", z.object({}), async (_args, ctx) => {
  const distros = await listWslDistros({
    commandExists: ctx.providerRuntimeDeps?.commandExists,
    runCommand: ctx.providerRuntimeDeps?.runCommand,
  }).catch(() => []);

  return { distros };
});

registerHostCommand("workspace.wsl.exportAgentSkills", z.object({}), async (_args, ctx) =>
  exportAgentSkillSnapshot({
    providerRegistry: ctx.providerRegistry,
  })
);

registerHostCommand(
  "workspace.wsl.browse",
  z.object({
    distro: z.string(),
    path: z.string().optional(),
  }),
  async (args, ctx) =>
    browseWslDirectory(args, {
      commandExists: ctx.providerRuntimeDeps?.commandExists,
      runCommand: ctx.providerRuntimeDeps?.runCommand,
    })
);

registerHostCommand(
  "workspace.wsl.mkdir",
  z.object({
    distro: z.string(),
    path: z.string(),
  }),
  async (args, ctx) =>
    createWslDirectoryInDistro(args, {
      commandExists: ctx.providerRuntimeDeps?.commandExists,
      runCommand: ctx.providerRuntimeDeps?.runCommand,
    })
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
