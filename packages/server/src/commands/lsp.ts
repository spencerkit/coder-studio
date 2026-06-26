import { z } from "zod";
import { buildLspRuntimeStatus } from "../lsp-tools/runtime-status.js";
import { registerRuntimeCommand } from "../runtime/command-registry.js";

registerRuntimeCommand(
  "lsp.ensureSession",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => ctx.lspMgr.ensureSession(args),
  }
);

registerRuntimeCommand(
  "lsp.setMode",
  z.object({
    mode: z.enum(["auto", "off"]),
  }),
  {
    resolveTarget: () => ({ kind: "default" }),
    handler: async (args, ctx) => {
      await ctx.lspMgr.setRuntimeMode(args.mode);
      return { mode: ctx.lspMgr.getRuntimeMode() };
    },
  }
);

registerRuntimeCommand(
  "lsp.runtimeStatus",
  z.object({
    workspaceId: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      if (!ctx.lspToolMgr) {
        throw {
          code: "lsp_tool_manager_unavailable",
          message: "LSP tool manager not configured",
        };
      }

      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw {
          code: "workspace_not_found",
          message: `Workspace not found: ${args.workspaceId}`,
        };
      }

      return buildLspRuntimeStatus({
        workspace: workspace as never,
        lspToolMgr: ctx.lspToolMgr,
      });
    },
  }
);

registerRuntimeCommand(
  "lsp.install.start",
  z.object({
    workspaceId: z.string(),
    serverKind: z.enum(["typescript", "python", "go", "rust", "vue"]),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      if (!ctx.lspToolInstallMgr) {
        throw {
          code: "lsp_install_unavailable",
          message: "LSP install manager not configured",
        };
      }

      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw {
          code: "workspace_not_found",
          message: `Workspace not found: ${args.workspaceId}`,
        };
      }

      return ctx.lspToolInstallMgr.start({
        workspace: workspace as never,
        serverKind: args.serverKind,
      });
    },
  }
);

registerRuntimeCommand(
  "lsp.install.get",
  z.object({
    jobId: z.string(),
  }),
  {
    resolveTarget: () => ({ kind: "default" }),
    handler: async (args, ctx) => {
      if (!ctx.lspToolInstallMgr) {
        throw {
          code: "lsp_install_unavailable",
          message: "LSP install manager not configured",
        };
      }

      const job = ctx.lspToolInstallMgr.get(args.jobId);
      if (!job) {
        throw {
          code: "lsp_install_job_not_found",
          message: `Install job not found: ${args.jobId}`,
        };
      }

      return job;
    },
  }
);

registerRuntimeCommand(
  "lsp.openDocument",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    languageId: z.string(),
    text: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => ctx.lspMgr.openDocument(args),
  }
);

registerRuntimeCommand(
  "lsp.changeDocument",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    text: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => ctx.lspMgr.changeDocument(args),
  }
);

registerRuntimeCommand(
  "lsp.closeDocument",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => ctx.lspMgr.closeDocument(args),
  }
);

registerRuntimeCommand(
  "lsp.definition",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => ctx.lspMgr.definition(args),
  }
);

registerRuntimeCommand(
  "lsp.declaration",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => ctx.lspMgr.declaration(args),
  }
);

registerRuntimeCommand(
  "lsp.typeDefinition",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => ctx.lspMgr.typeDefinition(args),
  }
);

registerRuntimeCommand(
  "lsp.references",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => ctx.lspMgr.references(args),
  }
);

registerRuntimeCommand(
  "lsp.hover",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => ctx.lspMgr.hover(args),
  }
);

registerRuntimeCommand(
  "lsp.documentSymbols",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => ctx.lspMgr.documentSymbols(args),
  }
);

registerRuntimeCommand(
  "lsp.semanticTokens",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => ctx.lspMgr.semanticTokens(args),
  }
);
