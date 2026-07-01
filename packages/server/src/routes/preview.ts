import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { markdownUsesMermaid } from "@coder-studio/utils";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RuntimeRouter } from "../host/runtime-router.js";
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

type WorkspaceLookup = { path: string; targetRuntime?: "native" | "wsl" } | null | undefined;

const require = createRequire(import.meta.url);
const MARKDOWN_MERMAID_INIT_SCRIPT = [
  "if (typeof window.mermaid !== 'undefined') {",
  "  window.mermaid.initialize({ startOnLoad: true, securityLevel: 'strict' });",
  "}",
].join("\n");
let mermaidRuntimePromise: Promise<Buffer> | null = null;

function resolveEmbeddedMermaidRuntimePath(importMetaUrl: string): string | null {
  const currentDir = dirname(fileURLToPath(importMetaUrl));
  const candidates = [
    resolve(currentDir, "../../assets/preview/mermaid.min.js"),
    resolve(currentDir, "../assets/preview/mermaid.min.js"),
    resolve(currentDir, "../../../desktop/dist/runtime/embedded/dist/assets/preview/mermaid.min.js"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function resolveMermaidRuntimePath(importMetaUrl: string): string {
  return resolveEmbeddedMermaidRuntimePath(importMetaUrl) ?? require.resolve("mermaid/dist/mermaid.min.js");
}

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
  mermaidRuntimePromise ??= readFile(resolveMermaidRuntimePath(import.meta.url));
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
    runtimeRouter?: RuntimeRouter;
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
      const resource =
        workspace.targetRuntime === "wsl"
          ? ((await deps.runtimeRouter?.executeOnTarget(
              { kind: "workspace", workspaceId: session.workspaceId },
              "file.previewResource.read",
              {
                workspaceId: session.workspaceId,
                path: resourcePath,
              }
            )) as
              | {
                  mime: string;
                  size: number;
                  bytesBase64: string;
                  workspaceRelativePath?: string;
                }
              | undefined)
          : await loadPreviewResource(workspace.path, resourcePath);

      if (!resource) {
        throw { code: "runtime_router_unavailable", message: "Runtime router unavailable" };
      }

      const workspaceRelativePath =
        "workspaceRelativePath" in resource && typeof resource.workspaceRelativePath === "string"
          ? resource.workspaceRelativePath
          : resourcePath;
      const resourceBytes =
        "bytes" in resource ? resource.bytes : Buffer.from(resource.bytesBase64, "base64");
      const bytes =
        resource.mime === "text/css"
          ? Buffer.from(
              rewritePreviewCssResourceUrls(resourceBytes.toString("utf-8"), {
                baseWorkspacePath: workspaceRelativePath,
                sessionId: session.id,
                workspaceRootPath: workspace.path,
              }),
              "utf-8"
            )
          : resourceBytes;

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
      if (code === "runtime_router_unavailable") {
        return reply.status(503).send({ error: code });
      }
      return reply.status(404).send({ error: "not_found" });
    }
  });
}
