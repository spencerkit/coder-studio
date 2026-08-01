import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerCanvasSnapshotRoutes } from "./canvas-snapshots.js";

describe("/api/canvas-snapshots", () => {
  it("serves snapshot payloads by snapshot id", async () => {
    const getSnapshot = vi.fn(() => ({
      snapshotId: "snapshot_123",
      workspaceId: "ws-1",
      title: "Weekly Metrics",
      kind: "report_canvas",
      createdAt: 123456,
      sourceHash: "abc123",
      compiledDocument: {
        kind: "report_canvas",
        title: "Weekly Metrics",
        sections: [],
      },
    }));

    const app = Fastify({ logger: false });
    registerCanvasSnapshotRoutes(app, {
      canvasService: {
        getSnapshot,
      },
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/canvas-snapshots/snapshot_123",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      snapshotId: "snapshot_123",
      title: "Weekly Metrics",
      kind: "report_canvas",
    });
    expect(getSnapshot).toHaveBeenCalledWith("snapshot_123");

    await app.close();
  });

  it("returns not found when the snapshot is missing", async () => {
    const app = Fastify({ logger: false });
    registerCanvasSnapshotRoutes(app, {
      canvasService: {
        getSnapshot: () => {
          throw {
            code: "canvas_snapshot_not_found",
            message: "Canvas snapshot not found: snapshot_404",
          };
        },
      },
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/canvas-snapshots/snapshot_404",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "canvas_snapshot_not_found",
    });

    await app.close();
  });
});
