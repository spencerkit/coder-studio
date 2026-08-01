import { CanvasAnchorCommentDocumentSchema, CanvasOverlayDocumentSchema } from "@coder-studio/core";
import type { FastifyInstance } from "fastify";

export function registerCanvasRoutes(
  app: FastifyInstance,
  deps: {
    workspaceMgr: {
      get(id: string): { path: string } | null | undefined;
    };
    canvasService: {
      getCanvasData(input: {
        workspaceId: string;
        workspaceRootPath: string;
        sourcePath?: string;
        canvasId?: string;
      }): Promise<unknown>;
      getCanvasInspectionData?(input: {
        workspaceId: string;
        workspaceRootPath: string;
        sourcePath?: string;
        canvasId?: string;
      }): Promise<unknown>;
      saveOverlay?(input: {
        workspaceId: string;
        workspaceRootPath: string;
        sourcePath: string;
        overlayDocument: ReturnType<typeof CanvasOverlayDocumentSchema.parse>;
      }): Promise<unknown>;
      saveAnchorComments?(input: {
        workspaceId: string;
        workspaceRootPath: string;
        sourcePath: string;
        anchorCommentDocument: ReturnType<typeof CanvasAnchorCommentDocumentSchema.parse>;
      }): Promise<unknown>;
    };
  }
): void {
  app.get("/api/canvas/:workspaceId/data", async (request, reply) => {
    const { workspaceId } = request.params as {
      workspaceId: string;
    };
    const { sourcePath } = request.query as {
      sourcePath?: string;
    };
    const workspace = deps.workspaceMgr.get(workspaceId);
    if (!workspace) {
      return reply.status(404).send({ error: "workspace_not_found" });
    }

    if (!sourcePath) {
      return reply.status(400).send({ error: "source_path_required" });
    }

    try {
      const data = await deps.canvasService.getCanvasData({
        workspaceId,
        workspaceRootPath: workspace.path,
        sourcePath,
      });
      return reply.send(data);
    } catch (error) {
      if ((error as { code?: string })?.code === "path_escape") {
        return reply.status(400).send({ error: "path_escape" });
      }

      if ((error as { code?: string })?.code === "canvas_not_found") {
        return reply.status(404).send({ error: "canvas_not_found" });
      }

      throw error;
    }
  });

  app.get("/api/canvas/:workspaceId/inspection", async (request, reply) => {
    const { workspaceId } = request.params as {
      workspaceId: string;
    };
    const { sourcePath } = request.query as {
      sourcePath?: string;
    };
    const workspace = deps.workspaceMgr.get(workspaceId);
    if (!workspace) {
      return reply.status(404).send({ error: "workspace_not_found" });
    }

    if (!sourcePath) {
      return reply.status(400).send({ error: "source_path_required" });
    }

    if (typeof deps.canvasService.getCanvasInspectionData !== "function") {
      return reply.status(404).send({ error: "canvas_inspection_unavailable" });
    }

    try {
      const data = await deps.canvasService.getCanvasInspectionData({
        workspaceId,
        workspaceRootPath: workspace.path,
        sourcePath,
      });
      return reply.send(data);
    } catch (error) {
      if ((error as { code?: string })?.code === "path_escape") {
        return reply.status(400).send({ error: "path_escape" });
      }

      if ((error as { code?: string })?.code === "canvas_not_found") {
        return reply.status(404).send({ error: "canvas_not_found" });
      }

      throw error;
    }
  });

  app.put("/api/canvas/:workspaceId/annotations", async (request, reply) => {
    const { workspaceId } = request.params as {
      workspaceId: string;
    };
    const { sourcePath } = request.query as {
      sourcePath?: string;
    };
    const workspace = deps.workspaceMgr.get(workspaceId);
    if (!workspace) {
      return reply.status(404).send({ error: "workspace_not_found" });
    }

    if (!sourcePath) {
      return reply.status(400).send({ error: "source_path_required" });
    }

    if (typeof deps.canvasService.saveOverlay !== "function") {
      return reply.status(404).send({ error: "canvas_overlay_unavailable" });
    }

    try {
      const overlayDocument = CanvasOverlayDocumentSchema.parse(request.body);
      const data = await deps.canvasService.saveOverlay({
        workspaceId,
        workspaceRootPath: workspace.path,
        sourcePath,
        overlayDocument,
      });
      return reply.send(data);
    } catch (error) {
      if ((error as { code?: string })?.code === "path_escape") {
        return reply.status(400).send({ error: "path_escape" });
      }

      if ((error as { code?: string })?.code === "canvas_not_found") {
        return reply.status(404).send({ error: "canvas_not_found" });
      }

      throw error;
    }
  });

  app.put("/api/canvas/:workspaceId/comments", async (request, reply) => {
    const { workspaceId } = request.params as {
      workspaceId: string;
    };
    const { sourcePath } = request.query as {
      sourcePath?: string;
    };
    const workspace = deps.workspaceMgr.get(workspaceId);
    if (!workspace) {
      return reply.status(404).send({ error: "workspace_not_found" });
    }

    if (!sourcePath) {
      return reply.status(400).send({ error: "source_path_required" });
    }

    if (typeof deps.canvasService.saveAnchorComments !== "function") {
      return reply.status(404).send({ error: "canvas_anchor_comments_unavailable" });
    }

    try {
      const anchorCommentDocument = CanvasAnchorCommentDocumentSchema.parse(request.body);
      const data = await deps.canvasService.saveAnchorComments({
        workspaceId,
        workspaceRootPath: workspace.path,
        sourcePath,
        anchorCommentDocument,
      });
      return reply.send(data);
    } catch (error) {
      if ((error as { code?: string })?.code === "path_escape") {
        return reply.status(400).send({ error: "path_escape" });
      }

      if ((error as { code?: string })?.code === "canvas_not_found") {
        return reply.status(404).send({ error: "canvas_not_found" });
      }

      throw error;
    }
  });
}
