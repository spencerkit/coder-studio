import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import {
  CANVAS_DOCUMENT_VERSION,
  type CanvasArtifactKind,
  type CanvasDataResponse,
  type CanvasDocumentEnvelope,
  type CanvasRecord,
  type CanvasRenderError,
} from "@coder-studio/core";
import { deleteEntry, readFile, writeFile } from "../fs/file-io.js";
import { CanvasRepo } from "../storage/repositories/canvas-repo.js";
import { compileCanvasDocument } from "./compiler.js";
import { writeNewCanvasSource } from "./source-path.js";
import { validateCanvasSource } from "./validation.js";

interface CanvasServiceOptions {
  canvasRepo: CanvasRepo;
  now?: () => number;
}

function createCanvasId(now: number): string {
  return `canvas_${now}_${randomBytes(4).toString("hex")}`;
}

function throwValidationError(error: CanvasRenderError): never {
  throw {
    code: "canvas_validation_error",
    message: error.message,
    details: error,
  };
}

function normalizeCompileError(error: unknown): CanvasRenderError {
  return {
    category: "compile_error",
    message: error instanceof Error ? error.message : "Failed to compile canvas",
  };
}

export class CanvasService {
  private readonly now: () => number;

  constructor(private readonly options: CanvasServiceOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  async create(input: {
    workspaceId: string;
    workspaceRootPath: string;
    sessionId?: string;
    title: string;
    kind: CanvasArtifactKind;
    document: unknown;
  }): Promise<{
    record: CanvasRecord;
    source: CanvasDocumentEnvelope;
    renderStatus: CanvasDataResponse["renderStatus"];
    lastError: CanvasRenderError | null;
  }> {
    const timestamp = this.now();
    const canvasId = createCanvasId(timestamp);
    const envelope = {
      version: CANVAS_DOCUMENT_VERSION,
      kind: input.kind,
      title: input.title,
      document: input.document,
    };
    const parsed = validateCanvasSource(JSON.stringify(envelope));
    if (!parsed.ok) {
      throwValidationError(parsed.error);
    }

    const sourcePath = await writeNewCanvasSource({
      workspaceRootPath: input.workspaceRootPath,
      title: input.title,
      content: JSON.stringify(parsed.document, null, 2) + "\n",
    });

    let record: CanvasRecord | undefined;

    try {
      record = this.options.canvasRepo.upsert({
        id: canvasId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        sourcePath,
        artifactType: parsed.document.kind,
        title: parsed.document.title,
        updatedAt: timestamp,
        renderStatus: "rendering",
        lastError: null,
      });

      const data = await this.readCanvasData({
        workspaceId: input.workspaceId,
        workspaceRootPath: input.workspaceRootPath,
        sourcePath,
        record,
      });

      return {
        record: this.options.canvasRepo.get(input.workspaceId, canvasId) ?? record,
        source: parsed.document,
        renderStatus: data.renderStatus,
        lastError: data.lastError ?? null,
      };
    } catch (error) {
      if (record) {
        this.options.canvasRepo.delete(input.workspaceId, canvasId);
      }

      try {
        await deleteEntry(input.workspaceRootPath, sourcePath);
      } catch (cleanupError) {
        if ((cleanupError as { code?: string }).code !== "not_found") {
          throw cleanupError;
        }
      }

      throw error;
    }
  }

  async update(input: {
    workspaceId: string;
    workspaceRootPath: string;
    canvasId: string;
    title?: string;
    document: unknown;
  }): Promise<{
    record: CanvasRecord;
    source: CanvasDocumentEnvelope;
    renderStatus: CanvasDataResponse["renderStatus"];
    lastError: CanvasRenderError | null;
  }> {
    const existing = this.options.canvasRepo.get(input.workspaceId, input.canvasId);
    if (!existing) {
      throw { code: "canvas_not_found", message: `Canvas not found: ${input.canvasId}` };
    }

    const currentRead = await readFile(
      input.workspaceId,
      input.workspaceRootPath,
      existing.sourcePath
    );
    if (currentRead.kind !== "text") {
      throw { code: "canvas_source_invalid", message: "Canvas source must be a text file" };
    }

    const nextEnvelope = {
      version: CANVAS_DOCUMENT_VERSION,
      kind: existing.artifactType,
      title: input.title ?? existing.title,
      document: input.document,
    };
    const nextParsed = validateCanvasSource(JSON.stringify(nextEnvelope));
    if (!nextParsed.ok) {
      throwValidationError(nextParsed.error);
    }

    if (nextParsed.document.kind !== existing.artifactType) {
      throw {
        code: "canvas_kind_mismatch",
        message: "Canvas kind cannot change in v1",
      };
    }

    await writeFile(
      input.workspaceRootPath,
      existing.sourcePath,
      JSON.stringify(nextParsed.document, null, 2) + "\n",
      currentRead.baseHash
    );

    const record = this.options.canvasRepo.upsert({
      ...existing,
      title: nextParsed.document.title,
      updatedAt: this.now(),
      renderStatus: "rendering",
      lastError: null,
    });

    const data = await this.readCanvasData({
      workspaceId: input.workspaceId,
      workspaceRootPath: input.workspaceRootPath,
      sourcePath: existing.sourcePath,
      record,
    });

    return {
      record: this.options.canvasRepo.get(input.workspaceId, input.canvasId) ?? record,
      source: nextParsed.document,
      renderStatus: data.renderStatus,
      lastError: data.lastError ?? null,
    };
  }

  async list(workspaceId: string): Promise<CanvasRecord[]> {
    return this.options.canvasRepo.list(workspaceId);
  }

  getRecord(workspaceId: string, canvasId: string): CanvasRecord | undefined {
    return this.options.canvasRepo.get(workspaceId, canvasId);
  }

  getRecordBySourcePath(workspaceId: string, sourcePath: string): CanvasRecord | undefined {
    return this.options.canvasRepo
      .list(workspaceId)
      .find((record) => record.sourcePath === sourcePath);
  }

  async getCanvasData(input: {
    workspaceId: string;
    workspaceRootPath: string;
    canvasId?: string;
    sourcePath?: string;
  }): Promise<CanvasDataResponse> {
    const recordFromCanvasId = input.canvasId
      ? this.options.canvasRepo.get(input.workspaceId, input.canvasId)
      : undefined;
    const sourcePath = input.sourcePath ?? recordFromCanvasId?.sourcePath;

    if (!sourcePath) {
      throw {
        code: "canvas_not_found",
        message: `Canvas not found: ${input.canvasId ?? input.sourcePath ?? "unknown"}`,
      };
    }

    return this.readCanvasData({
      workspaceId: input.workspaceId,
      workspaceRootPath: input.workspaceRootPath,
      sourcePath,
      record:
        input.sourcePath !== undefined
          ? this.getRecordBySourcePath(input.workspaceId, sourcePath)
          : (recordFromCanvasId ?? this.getRecordBySourcePath(input.workspaceId, sourcePath)),
    });
  }

  async renderFromSourcePath(input: {
    workspaceId: string;
    workspaceRootPath: string;
    sourcePath: string;
  }): Promise<CanvasDataResponse> {
    return this.getCanvasData(input);
  }

  private async readCanvasData(input: {
    workspaceId: string;
    workspaceRootPath: string;
    sourcePath: string;
    record?: CanvasRecord;
  }): Promise<CanvasDataResponse> {
    let sourceRead;
    try {
      sourceRead = await readFile(input.workspaceId, input.workspaceRootPath, input.sourcePath);
    } catch (error) {
      if (
        (error as { code?: string }).code === "not_found" ||
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        throw {
          code: "canvas_not_found",
          message: `Canvas not found: ${input.sourcePath}`,
        };
      }
      throw error;
    }

    if (sourceRead.kind !== "text") {
      throw { code: "canvas_source_invalid", message: "Canvas source must be a text file" };
    }

    const validated = validateCanvasSource(sourceRead.content);
    if (!validated.ok) {
      const metadata = getCanvasErrorMetadata({
        sourcePath: input.sourcePath,
        sourceContent: sourceRead.content,
        record: input.record,
      });
      const record = input.record
        ? this.options.canvasRepo.upsert({
            ...input.record,
            title: metadata.title,
            artifactType: metadata.kind,
            updatedAt: this.now(),
            renderStatus: "error",
            lastError: validated.error,
          })
        : undefined;

      return {
        ...(record ? { canvasId: record.id } : {}),
        workspaceId: input.workspaceId,
        sourcePath: input.sourcePath,
        title: record?.title ?? metadata.title,
        kind: record?.artifactType ?? metadata.kind,
        renderStatus: "error",
        lastError: validated.error,
      };
    }

    try {
      const compiledDocument = compileCanvasDocument(validated.document);
      const record = input.record
        ? this.options.canvasRepo.upsert({
            ...input.record,
            title: validated.document.title,
            artifactType: validated.document.kind,
            updatedAt: this.now(),
            renderStatus: "ready",
            lastError: null,
          })
        : undefined;

      return {
        ...(record ? { canvasId: record.id } : {}),
        workspaceId: input.workspaceId,
        sourcePath: input.sourcePath,
        title: record?.title ?? validated.document.title,
        kind: record?.artifactType ?? validated.document.kind,
        renderStatus: "ready",
        lastError: null,
        compiledDocument,
      };
    } catch (error) {
      const lastError = normalizeCompileError(error);
      const record = input.record
        ? this.options.canvasRepo.upsert({
            ...input.record,
            title: validated.document.title,
            artifactType: validated.document.kind,
            updatedAt: this.now(),
            renderStatus: "error",
            lastError,
          })
        : undefined;

      return {
        ...(record ? { canvasId: record.id } : {}),
        workspaceId: input.workspaceId,
        sourcePath: input.sourcePath,
        title: record?.title ?? validated.document.title,
        kind: record?.artifactType ?? validated.document.kind,
        renderStatus: "error",
        lastError,
      };
    }
  }
}

function getCanvasErrorMetadata(input: {
  sourcePath: string;
  sourceContent: string;
  record?: CanvasRecord;
}): {
  title: string;
  kind: CanvasArtifactKind;
} {
  if (input.record) {
    return {
      title: input.record.title,
      kind: input.record.artifactType,
    };
  }

  const parsed = tryParseCanvasMetadata(input.sourceContent);
  return {
    title: parsed?.title ?? deriveCanvasTitleFromSourcePath(input.sourcePath),
    kind: parsed?.kind ?? "architecture_canvas",
  };
}

function tryParseCanvasMetadata(sourceContent: string): {
  title?: string;
  kind?: CanvasArtifactKind;
} | null {
  try {
    const parsed = JSON.parse(sourceContent) as Record<string, unknown>;
    const title =
      typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : undefined;
    const kind =
      parsed.kind === "architecture_canvas" || parsed.kind === "report_canvas"
        ? parsed.kind
        : undefined;
    return { title, kind };
  } catch {
    return null;
  }
}

function deriveCanvasTitleFromSourcePath(sourcePath: string): string {
  const fileName = basename(sourcePath).replace(/\.csc$/i, "");
  const normalized = fileName.replace(/[-_]+/g, " ").trim();
  return normalized || sourcePath;
}
