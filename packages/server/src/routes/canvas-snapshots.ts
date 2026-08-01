import type { FastifyInstance } from "fastify";

export function registerCanvasSnapshotRoutes(
  app: FastifyInstance,
  deps: {
    canvasService: {
      getSnapshot(snapshotId: string): unknown;
    };
  }
): void {
  app.get("/api/canvas-snapshots/:snapshotId", async (request, reply) => {
    const { snapshotId } = request.params as { snapshotId: string };

    try {
      return reply.send(deps.canvasService.getSnapshot(snapshotId));
    } catch (error) {
      if ((error as { code?: string }).code === "canvas_snapshot_not_found") {
        return reply.status(404).send({ error: "canvas_snapshot_not_found" });
      }

      throw error;
    }
  });
}
