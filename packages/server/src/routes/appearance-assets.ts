import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AppearanceAssetRecord,
  AppearanceAssetRepo,
} from "../storage/repositories/appearance-asset-repo.js";
import { ensureSafeUploadDir, sanitizeOriginalName } from "../uploads/paths.js";

const ALLOWED_APPEARANCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const APPEARANCE_ASSET_BUCKET = "appearance/default";

interface Deps {
  uploadsDir: string;
  repo: AppearanceAssetRepo;
}

interface AppearanceAssetParams {
  assetId: string;
}

function isAllowedAppearanceMime(mime: string): mime is AppearanceAssetRecord["mime"] {
  return ALLOWED_APPEARANCE_MIME_TYPES.has(mime);
}

function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function resolveAssetStoragePath(uploadsDir: string, storagePath: string): string | null {
  const resolvedUploadsDir = resolve(uploadsDir);
  const resolvedStoragePath = resolve(storagePath);
  return isPathInsideRoot(resolvedUploadsDir, resolvedStoragePath) ? resolvedStoragePath : null;
}

async function cleanupWrittenFile(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return;
  }

  await rm(filePath, { force: true });
}

async function rejectAndCleanup(
  reply: FastifyReply,
  filePath: string | undefined,
  statusCode: number,
  error: string
) {
  await cleanupWrittenFile(filePath);
  return reply.status(statusCode).send({ ok: false, error });
}

export function registerAppearanceAssetsRoutes(app: FastifyInstance, deps: Deps): void {
  app.post("/api/appearance-assets", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.isMultipart()) {
      return reply.status(400).send({ ok: false, error: "expected_multipart" });
    }

    let writtenPath: string | undefined;
    let pendingRecord: AppearanceAssetRecord | undefined;

    try {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type !== "file") {
          continue;
        }

        if (part.fieldname !== "file") {
          part.file.resume();
          return rejectAndCleanup(reply, writtenPath, 400, "file_required");
        }

        if (pendingRecord) {
          part.file.resume();
          return rejectAndCleanup(reply, writtenPath, 400, "too_many_files");
        }

        if (!isAllowedAppearanceMime(part.mimetype)) {
          part.file.resume();
          return rejectAndCleanup(reply, writtenPath, 400, "invalid_file_type");
        }

        const assetId = randomUUID();
        const createdAt = Date.now();
        const dateStr = new Date(createdAt).toISOString().slice(0, 10);
        const safeName = sanitizeOriginalName(part.filename || "file");
        const fileName = part.filename?.trim() ? part.filename.trim() : safeName;
        const dir = join(deps.uploadsDir, APPEARANCE_ASSET_BUCKET, dateStr);
        const storagePath = join(dir, `${assetId}-${safeName}`);

        try {
          await ensureSafeUploadDir(deps.uploadsDir, dir);
          await pipeline(part.file, createWriteStream(storagePath));
        } catch (error) {
          request.log.warn({ err: error }, "appearance asset write failed");
          return rejectAndCleanup(reply, storagePath, 500, "write_failed");
        }

        if (part.file.truncated) {
          return rejectAndCleanup(reply, storagePath, 413, "file_too_large");
        }

        let fileSize: number;
        try {
          const fileStat = await stat(storagePath);
          fileSize = fileStat.size;
        } catch (error) {
          request.log.warn({ err: error }, "appearance asset stat failed");
          return rejectAndCleanup(reply, storagePath, 500, "write_failed");
        }

        writtenPath = storagePath;
        pendingRecord = {
          id: assetId,
          fileName,
          mime: part.mimetype,
          size: fileSize,
          storagePath,
          createdAt,
        };
      }
    } catch (error) {
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        return rejectAndCleanup(reply, writtenPath, 413, "file_too_large");
      }

      request.log.warn({ err: error }, "appearance asset parse failed");
      return rejectAndCleanup(reply, writtenPath, 400, "parse_failed");
    }

    if (!pendingRecord) {
      return rejectAndCleanup(reply, writtenPath, 400, "file_required");
    }

    try {
      deps.repo.set(pendingRecord);
    } catch (error) {
      request.log.warn({ err: error }, "appearance asset metadata write failed");
      return rejectAndCleanup(reply, writtenPath, 500, "write_failed");
    }

    return reply.send({
      ok: true,
      asset: {
        assetId: pendingRecord.id,
        url: `/api/appearance-assets/${pendingRecord.id}`,
        mime: pendingRecord.mime,
        size: pendingRecord.size,
      },
    });
  });

  app.get(
    "/api/appearance-assets/:assetId",
    async (request: FastifyRequest<{ Params: AppearanceAssetParams }>, reply: FastifyReply) => {
      const record = deps.repo.get(request.params.assetId);
      if (!record) {
        return reply.status(404).send({ ok: false, error: "not_found" });
      }

      const storagePath = resolveAssetStoragePath(deps.uploadsDir, record.storagePath);
      if (!storagePath) {
        return reply.status(404).send({ ok: false, error: "not_found" });
      }

      let fileSize: number;
      try {
        const fileStat = await stat(storagePath);
        if (!fileStat.isFile()) {
          return reply.status(404).send({ ok: false, error: "not_found" });
        }
        fileSize = fileStat.size;
      } catch {
        return reply.status(404).send({ ok: false, error: "not_found" });
      }

      reply
        .header("Content-Type", record.mime)
        .header("Content-Length", String(fileSize))
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");

      return reply.send(createReadStream(storagePath));
    }
  );

  app.delete(
    "/api/appearance-assets/:assetId",
    async (request: FastifyRequest<{ Params: AppearanceAssetParams }>, reply: FastifyReply) => {
      const record = deps.repo.get(request.params.assetId);
      if (!record) {
        return reply.status(404).send({ ok: false, error: "not_found" });
      }

      const storagePath = resolveAssetStoragePath(deps.uploadsDir, record.storagePath);
      if (storagePath) {
        await rm(storagePath, { force: true });
      }

      deps.repo.delete(request.params.assetId);
      return reply.send({ ok: true });
    }
  );
}
