import { z } from "zod";
import { buildLspRuntimeStatus } from "../lsp-tools/runtime-status.js";
import { registerCommand } from "../ws/dispatch.js";

registerCommand(
  "lsp.ensureSession",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => ctx.lspMgr.ensureSession(args)
);

registerCommand(
  "lsp.setMode",
  z.object({
    mode: z.enum(["auto", "off"]),
  }),
  async (args, ctx) => {
    await ctx.lspMgr.setRuntimeMode(args.mode);
    return { mode: ctx.lspMgr.getRuntimeMode() };
  }
);

registerCommand(
  "lsp.runtimeStatus",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    if (!ctx.lspToolMgr) {
      throw {
        code: "lsp_tool_manager_unavailable",
        message: "LSP tool manager not configured",
      };
    }

    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw {
        code: "workspace_not_found",
        message: `Workspace not found: ${args.workspaceId}`,
      };
    }

    return buildLspRuntimeStatus({
      workspace,
      lspToolMgr: ctx.lspToolMgr,
    });
  }
);

registerCommand(
  "lsp.install.start",
  z.object({
    workspaceId: z.string(),
    serverKind: z.enum(["typescript", "python", "go", "rust"]),
  }),
  async (args, ctx) => {
    if (!ctx.lspToolInstallMgr) {
      throw {
        code: "lsp_install_unavailable",
        message: "LSP install manager not configured",
      };
    }

    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw {
        code: "workspace_not_found",
        message: `Workspace not found: ${args.workspaceId}`,
      };
    }

    return ctx.lspToolInstallMgr.start({
      workspace,
      serverKind: args.serverKind,
    });
  }
);

registerCommand(
  "lsp.install.get",
  z.object({
    jobId: z.string(),
  }),
  async (args, ctx) => {
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
  }
);

registerCommand(
  "lsp.openDocument",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    languageId: z.string(),
    text: z.string(),
  }),
  async (args, ctx) => ctx.lspMgr.openDocument(args)
);

registerCommand(
  "lsp.changeDocument",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    text: z.string(),
  }),
  async (args, ctx) => ctx.lspMgr.changeDocument(args)
);

registerCommand(
  "lsp.closeDocument",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => ctx.lspMgr.closeDocument(args)
);

registerCommand(
  "lsp.definition",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  async (args, ctx) => ctx.lspMgr.definition(args)
);

registerCommand(
  "lsp.declaration",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  async (args, ctx) => ctx.lspMgr.declaration(args)
);

registerCommand(
  "lsp.typeDefinition",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  async (args, ctx) => ctx.lspMgr.typeDefinition(args)
);

registerCommand(
  "lsp.references",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  async (args, ctx) => ctx.lspMgr.references(args)
);

registerCommand(
  "lsp.hover",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  async (args, ctx) => ctx.lspMgr.hover(args)
);

registerCommand(
  "lsp.documentSymbols",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => ctx.lspMgr.documentSymbols(args)
);
