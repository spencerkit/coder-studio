import { posix } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  encodePathSegments,
  rewritePreviewCssResourceUrls,
  rewritePreviewHtmlResourceUrls,
} from "../preview/html-resource-rewriter.js";
import { renderMarkdownDocument } from "../preview/render-markdown.js";
import { loadPreviewResource, resolvePreviewResourcePath } from "../preview/resource-loader.js";
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

function getPreviewContentSecurityPolicy(): string {
  return "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'none'; base-uri 'none'; form-action 'none'";
}

function resolvePreviewAssetWorkspacePath(entryPath: string, rawPath: string): string {
  const normalizedRawPath = rawPath.replaceAll("\\", "/");
  const relativeAssetPath = posix.relative(posix.dirname(entryPath), normalizedRawPath);
  return resolvePreviewResourcePath(entryPath, relativeAssetPath);
}

const previewSessionCreateSchema = z.object({
  workspaceId: z.string().min(1),
  entryPath: z.string().min(1),
  kind: z.enum(["markdown", "html"]),
  content: z.string(),
  allowScripts: z.boolean().optional(),
});

const previewSessionUpdateSchema = z.object({
  content: z.string().optional(),
  allowScripts: z.boolean().optional(),
});

export function registerPreviewRoutes(
  app: FastifyInstance,
  deps: {
    workspaceMgr: { get(id: string): WorkspaceLookup };
    previewSessions: PreviewSessionStore;
  }
): void {
  app.post("/api/preview/session", async (request, reply) => {
    const parsed = previewSessionCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_preview_payload" });
    }

    const body = parsed.data as PreviewSessionBody;
    const workspace = deps.workspaceMgr.get(body.workspaceId);
    if (!workspace) {
      return reply.status(404).send({ error: "workspace_not_found" });
    }

    const session = deps.previewSessions.create(body);
    return reply.send({
      id: session.id,
      previewUrl: `/api/preview/session/${session.id}/${encodePathSegments(session.entryPath)}`,
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
    const parsed = previewSessionUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_preview_payload" });
    }

    const session = deps.previewSessions.update(id, parsed.data as PreviewSessionUpdateBody);
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
      const rawHtml =
        session.kind === "markdown"
          ? renderMarkdownDocument({
              markdown: session.content,
              title: session.entryPath,
            })
          : session.content;
      const html = rewritePreviewHtmlResourceUrls(rawHtml, {
        entryPath: session.entryPath,
        sessionId: session.id,
        workspaceRootPath: workspace.path,
      });
      const contentSecurityPolicy = getPreviewContentSecurityPolicy();

      const response = reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .header("X-Preview-Allow-Scripts", String(session.allowScripts));

      if (contentSecurityPolicy) {
        response.header("Content-Security-Policy", contentSecurityPolicy);
      }

      return response.send(html);
    }

    try {
      const resourcePath = resolvePreviewAssetWorkspacePath(session.entryPath, rawPath);
      const resource = await loadPreviewResource(workspace.path, resourcePath);
      const bytes =
        resource.mime === "text/css"
          ? Buffer.from(
              rewritePreviewCssResourceUrls(resource.bytes.toString("utf-8"), {
                baseWorkspacePath: resource.workspaceRelativePath,
                sessionId: session.id,
                workspaceRootPath: workspace.path,
              }),
              "utf-8"
            )
          : resource.bytes;

      return reply
        .header("Content-Type", resource.mime)
        .header("Content-Length", String(bytes.byteLength))
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(bytes);
    } catch (error) {
      const code = (error as { code?: string })?.code ?? (error as Error).message;
      if (code === "path_escape") {
        return reply.status(400).send({ error: "path_escape" });
      }
      return reply.status(404).send({ error: "not_found" });
    }
  });
}
