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

import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WorkspaceManager } from '../workspace/manager.js';
import { resolveSafe } from '../fs/file-io.js';
import { getImageTypeInfo } from '../fs/image.js';

interface FileAssetQuery {
  workspaceId?: string;
  path?: string;
}

export function registerFileAssetRoutes(
  app: FastifyInstance,
  deps: { workspaceMgr: WorkspaceManager }
) {
  app.get(
    '/api/file',
    async (
      request: FastifyRequest<{ Querystring: FileAssetQuery }>,
      reply: FastifyReply
    ) => {
      const { workspaceId, path: relPath } = request.query;

      if (!workspaceId || !relPath) {
        return reply
          .status(400)
          .send({ ok: false, error: 'workspaceId and path are required' });
      }

      const workspace = deps.workspaceMgr.get(workspaceId);
      if (!workspace) {
        return reply.status(404).send({ ok: false, error: 'workspace_not_found' });
      }

      const typeInfo = getImageTypeInfo(relPath);
      if (!typeInfo) {
        // Enforce allowlist: this endpoint exists for image previews only,
        // not as a generic file fetcher. Text files keep using file.read
        // over WS where we can attach baseHash / encoding metadata.
        return reply.status(404).send({ ok: false, error: 'not_an_image' });
      }

      let absPath: string;
      try {
        absPath = resolveSafe(workspace.path, relPath);
      } catch {
        return reply.status(400).send({ ok: false, error: 'path_escape' });
      }

      let fileSize: number;
      try {
        const stats = await stat(absPath);
        if (!stats.isFile()) {
          return reply.status(404).send({ ok: false, error: 'not_a_file' });
        }
        fileSize = stats.size;
      } catch {
        return reply.status(404).send({ ok: false, error: 'not_found' });
      }

      // no-store here is deliberate: the editor re-fetches on demand and we
      // want changes on disk to reflect immediately without stale caches.
      reply
        .header('Content-Type', typeInfo.mime)
        .header('Content-Length', String(fileSize))
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff');

      return reply.send(createReadStream(absPath));
    }
  );
}
