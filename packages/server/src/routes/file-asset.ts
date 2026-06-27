/**
 * /api/file — binary file streaming endpoint.
 *
 * This exists so the web client can render image previews via native
 * `<img src>` without forcing us to base64-encode large files onto the
 * WebSocket channel. Scope is deliberately narrow:
 *
 *   - GET only, read only.
 *   - Allowed mime types gated by `getImageTypeInfo` (extension allowlist).
 *     Non-image files 404 so the endpoint isn't a general exfiltration
 *     channel against the workspace.
 *   - `resolveSafe` rejects any path that escapes the workspace root.
 *   - Auth is inherited from the global `onRequest` guard in `app.ts`
 *     (cookie-based), same model as every other non-public route.
 *
 * Browsers attach the auth cookie automatically for `<img src="/api/file?…">`
 * requests, so no extra work is needed on the client beyond constructing
 * the URL.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createReadStream } from "fs";
import { realpath, stat } from "fs/promises";
import { resolveSafe } from "../fs/file-io.js";
import { getImageTypeInfo } from "../fs/image.js";
import { isPathInsideRoot } from "../fs/path-safety.js";
import { parseGitImageRevisionSelector, readImageAtRevision } from "../git/image-revision.js";
import type { RuntimeRouter } from "../host/runtime-router.js";
import type { WorkspaceManager } from "../workspace/manager.js";

interface FileAssetQuery {
  workspaceId?: string;
  path?: string;
  revision?: string;
}

interface RuntimeAssetPayload {
  mime: string;
  size: number;
  bytesBase64: string;
}

function sendRuntimeAsset(reply: FastifyReply, asset: RuntimeAssetPayload) {
  const bytes = Buffer.from(asset.bytesBase64, "base64");
  return reply
    .header("Content-Type", asset.mime)
    .header("Content-Length", String(asset.size))
    .header("Cache-Control", "no-store")
    .header("X-Content-Type-Options", "nosniff")
    .send(bytes);
}

function handleRuntimeAssetError(reply: FastifyReply, error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : undefined;

  if (code === "invalid_revision" || code === "path_escape") {
    return reply.status(400).send({ ok: false, error: code });
  }

  if (code === "runtime_router_unavailable") {
    return reply.status(503).send({ ok: false, error: code });
  }

  return reply.status(404).send({ ok: false, error: code ?? "not_found" });
}

export function registerFileAssetRoutes(
  app: FastifyInstance,
  deps: { workspaceMgr: WorkspaceManager; runtimeRouter?: RuntimeRouter }
) {
  app.get(
    "/api/file",
    async (request: FastifyRequest<{ Querystring: FileAssetQuery }>, reply: FastifyReply) => {
      const { workspaceId, path: relPath, revision } = request.query;

      if (!workspaceId || !relPath) {
        return reply.status(400).send({ ok: false, error: "workspaceId and path are required" });
      }

      const workspace = deps.workspaceMgr.get(workspaceId);
      if (!workspace) {
        return reply.status(404).send({ ok: false, error: "workspace_not_found" });
      }

      const typeInfo = getImageTypeInfo(relPath);
      if (!typeInfo) {
        return reply.status(404).send({ ok: false, error: "not_an_image" });
      }

      if (workspace.targetRuntime === "wsl") {
        try {
          const asset = (await deps.runtimeRouter?.executeOnTarget(
            { kind: "workspace", workspaceId },
            "file.asset.read",
            {
              workspaceId,
              path: relPath,
              revision,
            }
          )) as RuntimeAssetPayload | undefined;

          if (!asset) {
            throw { code: "runtime_router_unavailable", message: "Runtime router unavailable" };
          }

          return sendRuntimeAsset(reply, asset);
        } catch (error) {
          return handleRuntimeAssetError(reply, error);
        }
      }

      const revisionSelector = revision ? parseGitImageRevisionSelector(revision) : null;
      if (revision && !revisionSelector) {
        return reply.status(400).send({ ok: false, error: "invalid_revision" });
      }

      let absPath: string;
      try {
        absPath = resolveSafe(workspace.path, relPath);
      } catch {
        return reply.status(400).send({ ok: false, error: "path_escape" });
      }

      if (revisionSelector) {
        try {
          const asset = await readImageAtRevision(workspace.path, revisionSelector, relPath);
          if (!asset.exists || !asset.bytes) {
            return reply.status(404).send({ ok: false, error: "not_found" });
          }

          reply
            .header("Content-Type", asset.mime)
            .header("Content-Length", String(asset.bytes.byteLength))
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff");

          return reply.send(asset.bytes);
        } catch {
          return reply.status(404).send({ ok: false, error: "not_found" });
        }
      }

      try {
        const [realWorkspacePath, realAssetPath] = await Promise.all([
          realpath(workspace.path),
          realpath(absPath),
        ]);

        if (!isPathInsideRoot(realWorkspacePath, realAssetPath)) {
          return reply.status(400).send({ ok: false, error: "path_escape" });
        }
      } catch {
        return reply.status(404).send({ ok: false, error: "not_found" });
      }

      let fileSize: number;
      try {
        const fileStats = await stat(absPath);
        if (!fileStats.isFile()) {
          return reply.status(404).send({ ok: false, error: "not_a_file" });
        }
        fileSize = fileStats.size;
      } catch {
        return reply.status(404).send({ ok: false, error: "not_found" });
      }

      reply
        .header("Content-Type", typeInfo.mime)
        .header("Content-Length", String(fileSize))
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");

      return reply.send(createReadStream(absPath));
    }
  );
}
