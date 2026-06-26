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
}
