import type { FastifyInstance } from "fastify";
import { loadPreviewResource } from "../preview/resource-loader.js";
import { PreviewSessionStore } from "../preview/session-store.js";

type PreviewKind = "markdown" | "html";

interface PreviewSessionBody {
  workspaceId: string;
  entryPath: string;
  kind: PreviewKind;
  content: string;
  allowScripts?: boolean;
}

interface PreviewSessionUpdateBody {
  content?: string;
  allowScripts?: boolean;
}

type WorkspaceLookup = { path: string } | null | undefined;

export function registerPreviewRoutes(
  app: FastifyInstance,
  deps: {
    workspaceMgr: { get(id: string): WorkspaceLookup };
    previewSessions: PreviewSessionStore;
  }
): void {
  app.post("/api/preview/session", async (request, reply) => {
    const body = request.body as PreviewSessionBody;
    const workspace = deps.workspaceMgr.get(body.workspaceId);
    if (!workspace) {
      return reply.status(404).send({ error: "workspace_not_found" });
    }

    const session = deps.previewSessions.create(body);
    return reply.send({
      id: session.id,
      previewUrl: `/api/preview/session/${session.id}/${encodeURI(session.entryPath)}`,
      revision: session.revision,
    });
  });

  app.get("/api/preview/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = deps.previewSessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: "preview_session_not_found" });
    }

    return reply.send(session);
  });

  app.put("/api/preview/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = deps.previewSessions.update(id, request.body as PreviewSessionUpdateBody);
    if (!session) {
      return reply.status(404).send({ error: "preview_session_not_found" });
    }

    return reply.send({ revision: session.revision });
  });

  app.delete("/api/preview/session/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    deps.previewSessions.delete(id);
    return reply.send({ ok: true });
  });

  app.get("/api/preview/session/:id/*", async (request, reply) => {
    const { id, "*": rawPath } = request.params as { id: string; "*": string };
    const session = deps.previewSessions.get(id);
    if (!session) {
      return reply.status(404).send({ error: "preview_session_not_found" });
    }

    const workspace = deps.workspaceMgr.get(session.workspaceId);
    if (!workspace) {
      return reply.status(404).send({ error: "workspace_not_found" });
    }

    if ((rawPath ?? "") === session.entryPath) {
      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .send(session.content);
    }

    const resource = await loadPreviewResource(workspace.path, rawPath);
    return reply
      .header("Content-Type", resource.mime)
      .header("Content-Length", String(resource.size))
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .send(resource.bytes);
  });
}
