import { createWriteStream } from "node:fs";
import { rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { enforceBucketCap } from "../uploads/cleanup.js";
import { MAX_FILES_PER_BATCH, UPLOAD_BUCKET_MAX_BYTES } from "../uploads/constants.js";
import { ensureSafeUploadDir, generateBucketPath } from "../uploads/paths.js";

interface UploadLogger {
  warn(ctx: Record<string, unknown>, message: string): void;
}

interface Deps {
  uploadsDir: string;
  workspaceMgr: { get(id: string): { path: string } | null | undefined };
}

interface UploadedFileMeta {
  path: string;
  originalName: string;
  size: number;
}

type WorkspaceLookup = { path: string };

function inferClipboardFilename(
  filename: string | undefined,
  mimeType: string | undefined,
  now: Date
): string {
  const trimmed = filename?.trim();
  if (trimmed) {
    return trimmed;
  }

  const hhmmss = now.toISOString().slice(11, 19).replace(/:/g, "");
  let ext = "bin";
  if (mimeType === "image/png") {
    ext = "png";
  } else if (mimeType === "image/jpeg") {
    ext = "jpg";
  } else if (mimeType === "image/webp") {
    ext = "webp";
  } else if (mimeType === "application/pdf") {
    ext = "pdf";
  }

  return `screenshot-${hhmmss}.${ext}`;
}

async function cleanupWrittenFiles(files: UploadedFileMeta[]): Promise<void> {
  await Promise.all(files.map((file) => rm(file.path, { force: true })));
}

function getRequestLogger(request: FastifyRequest): UploadLogger | undefined {
  const logger = request.log as UploadLogger | undefined;
  if (logger && typeof logger.warn === "function") {
    return logger;
  }
  return undefined;
}

async function rejectAndCleanup(
  reply: FastifyReply,
  written: UploadedFileMeta[],
  statusCode: number,
  error: string
) {
  await cleanupWrittenFiles(written);
  return reply.status(statusCode).send({ ok: false, error });
}

function getActiveWorkspace(deps: Deps, workspaceId: string | undefined): WorkspaceLookup | null {
  if (!workspaceId) {
    return null;
  }

  return deps.workspaceMgr.get(workspaceId) ?? null;
}

async function ensureWorkspaceStillActive(
  deps: Deps,
  workspaceId: string | undefined,
  reply: FastifyReply,
  written: UploadedFileMeta[]
): Promise<WorkspaceLookup | null> {
  const workspace = getActiveWorkspace(deps, workspaceId);
  if (!workspace) {
    await rejectAndCleanup(reply, written, 404, "workspace_not_found");
    return null;
  }

  return workspace;
}

function lockWorkspaceId(
  currentWorkspaceId: string | undefined,
  nextWorkspaceId: string
): string | "mismatch" {
  if (!currentWorkspaceId) {
    return nextWorkspaceId;
  }
  return currentWorkspaceId === nextWorkspaceId ? currentWorkspaceId : "mismatch";
}

export function registerUploadsRoute(app: FastifyInstance, deps: Deps): void {
  app.post("/api/uploads", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.isMultipart()) {
      return reply.status(400).send({ ok: false, error: "expected_multipart" });
    }

    let workspaceId: string | undefined;
    let workspaceValidated = false;
    let fileCount = 0;
    const written: UploadedFileMeta[] = [];
    const logger = getRequestLogger(request);

    try {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === "field" && part.fieldname === "workspaceId") {
          const lockedWorkspaceId = lockWorkspaceId(workspaceId, String(part.value));
          if (lockedWorkspaceId === "mismatch") {
            return rejectAndCleanup(reply, written, 400, "workspace_mismatch");
          }
          workspaceId = lockedWorkspaceId;
          if (!getActiveWorkspace(deps, workspaceId)) {
            return rejectAndCleanup(reply, written, 404, "workspace_not_found");
          }
          workspaceValidated = true;
          continue;
        }

        if (part.type === "field" && part.fieldname === "files") {
          if (!workspaceId) {
            return rejectAndCleanup(reply, written, 400, "workspace_required");
          }

          fileCount += 1;
          if (fileCount > MAX_FILES_PER_BATCH) {
            return rejectAndCleanup(reply, written, 400, "too_many_files");
          }

          const now = new Date();
          const originalName = inferClipboardFilename(undefined, part.mimetype, now);
          const target = generateBucketPath({
            uploadsDir: deps.uploadsDir,
            workspaceId,
            originalName,
            now,
          });

          if (!(await ensureWorkspaceStillActive(deps, workspaceId, reply, written))) {
            return;
          }

          try {
            await ensureSafeUploadDir(deps.uploadsDir, target.dir);
            await writeFile(target.absolutePath, String(part.value));
          } catch (error) {
            await rm(target.absolutePath, { force: true });
            await cleanupWrittenFiles(written);
            logger?.warn({ err: error }, "upload write failed");
            return reply.status(500).send({ ok: false, error: "write_failed" });
          }

          try {
            const fileStat = await stat(target.absolutePath);
            written.push({
              path: target.absolutePath,
              originalName,
              size: fileStat.size,
            });
          } catch (error) {
            await rm(target.absolutePath, { force: true });
            await cleanupWrittenFiles(written);
            logger?.warn({ err: error }, "upload stat failed");
            return reply.status(500).send({ ok: false, error: "write_failed" });
          }

          continue;
        }

        if (part.type !== "file" || part.fieldname !== "files") {
          if (part.type === "file") {
            part.file.resume();
          }
          continue;
        }

        if (!workspaceId) {
          part.file.resume();
          return rejectAndCleanup(reply, written, 400, "workspace_required");
        }

        fileCount += 1;
        if (fileCount > MAX_FILES_PER_BATCH) {
          part.file.resume();
          return rejectAndCleanup(reply, written, 400, "too_many_files");
        }

        const now = new Date();
        const originalName = inferClipboardFilename(part.filename, part.mimetype, now);
        const target = generateBucketPath({
          uploadsDir: deps.uploadsDir,
          workspaceId,
          originalName,
          now,
        });

        if (!(await ensureWorkspaceStillActive(deps, workspaceId, reply, written))) {
          part.file.resume();
          return;
        }

        try {
          await ensureSafeUploadDir(deps.uploadsDir, target.dir);
          await pipeline(part.file, createWriteStream(target.absolutePath));
        } catch (error) {
          await rm(target.absolutePath, { force: true });
          await cleanupWrittenFiles(written);
          logger?.warn({ err: error }, "upload write failed");
          return reply.status(500).send({ ok: false, error: "write_failed" });
        }

        if (part.file.truncated) {
          await rm(target.absolutePath, { force: true });
          await cleanupWrittenFiles(written);
          return reply.status(413).send({ ok: false, error: "file_too_large" });
        }

        try {
          const fileStat = await stat(target.absolutePath);
          written.push({
            path: target.absolutePath,
            originalName,
            size: fileStat.size,
          });
        } catch (error) {
          await rm(target.absolutePath, { force: true });
          await cleanupWrittenFiles(written);
          logger?.warn({ err: error }, "upload stat failed");
          return reply.status(500).send({ ok: false, error: "write_failed" });
        }
      }
    } catch (error) {
      await cleanupWrittenFiles(written);
      if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.status(413).send({ ok: false, error: "file_too_large" });
      }
      logger?.warn({ err: error }, "upload parse failed");
      return reply.status(400).send({ ok: false, error: "parse_failed" });
    }

    if (!workspaceId) {
      return rejectAndCleanup(reply, written, 400, "workspace_required");
    }

    if (!workspaceValidated) {
      return rejectAndCleanup(reply, written, 404, "workspace_not_found");
    }

    if (written.length === 0) {
      return rejectAndCleanup(reply, written, 400, "no_files");
    }

    if (!(await ensureWorkspaceStillActive(deps, workspaceId, reply, written))) {
      return;
    }

    void enforceBucketCap(deps.uploadsDir, workspaceId, UPLOAD_BUCKET_MAX_BYTES, logger).catch(
      (error) => logger?.warn({ err: error }, "bucket cap enforcement failed")
    );

    return reply.send({ ok: true, files: written });
  });
}
