import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { posix } from "node:path";
import { markdownUsesMermaid } from "@coder-studio/utils";
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
type PreviewScriptPolicy = "none" | "self" | "relaxed";

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

const require = createRequire(import.meta.url);
const MERMAID_RUNTIME_PATH =
  process.env.CODER_STUDIO_MERMAID_RUNTIME_PATH?.trim() ||
  require.resolve("mermaid/dist/mermaid.min.js");
const MARKDOWN_MERMAID_INIT_SCRIPT = [
  "if (typeof window.mermaid !== 'undefined') {",
  "  window.mermaid.initialize({ startOnLoad: true, securityLevel: 'strict' });",
  "}",
].join("\n");
let mermaidRuntimePromise: Promise<Buffer> | null = null;

function getPreviewContentSecurityPolicy(scriptPolicy: PreviewScriptPolicy): string {
  const resolvedScriptPolicy =
    scriptPolicy === "relaxed"
      ? "script-src 'self' 'unsafe-inline'; script-src-attr 'unsafe-inline'"
      : scriptPolicy === "self"
        ? "script-src 'self'"
        : "script-src 'none'";

  return `default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; ${resolvedScriptPolicy}; base-uri 'none'; form-action 'none'`;
}

function getSessionPreviewScriptPolicy(session: {
  kind: PreviewKind;
  allowScripts: boolean;
  content: string;
}): PreviewScriptPolicy {
  if (session.kind === "html") {
    return session.allowScripts ? "relaxed" : "none";
  }

  return markdownUsesMermaid(session.content) ? "self" : "none";
}

function resolvePreviewAssetWorkspacePath(entryPath: string, rawPath: string): string {
  const normalizedRawPath = rawPath.replaceAll("\\", "/");
  const relativeAssetPath = posix.relative(posix.dirname(entryPath), normalizedRawPath);
  return resolvePreviewResourcePath(entryPath, relativeAssetPath);
}

async function loadMermaidRuntime(): Promise<Buffer> {
  mermaidRuntimePromise ??= readFile(MERMAID_RUNTIME_PATH);
  return mermaidRuntimePromise;
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
  app.get("/api/preview/assets/mermaid.min.js", async (_request, reply) => {
    const script = await loadMermaidRuntime();
    return reply
      .header("Content-Type", "application/javascript; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .send(script);
  });

  app.get("/api/preview/assets/markdown-mermaid-init.js", async (_request, reply) => {
    return reply
      .header("Content-Type", "application/javascript; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .send(MARKDOWN_MERMAID_INIT_SCRIPT);
  });

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
        preserveRootRelativePrefixes:
          session.kind === "markdown" ? ["/api/preview/assets/"] : undefined,
      });
      const scriptPolicy = getSessionPreviewScriptPolicy(session);
      const allowScripts = scriptPolicy !== "none";
      const contentSecurityPolicy = getPreviewContentSecurityPolicy(scriptPolicy);

      const response = reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .header("X-Preview-Allow-Scripts", String(allowScripts));

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
