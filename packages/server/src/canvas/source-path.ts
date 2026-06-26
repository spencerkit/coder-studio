import { existsSync } from "node:fs";
import { join } from "node:path";
import { writeFileIfMissing } from "../fs/file-io.js";

const CANVAS_SOURCE_DIR = ".coder-studio/canvases";
const MAX_SLUG_LENGTH = 80;
const WINDOWS_RESERVED_BASENAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

function trimEdgeHyphens(value: string): string {
  return value.replace(/^-+|-+$/g, "");
}

function normalizeCanvasSlug(slug: string): string {
  if (!slug) {
    return slug;
  }

  if (WINDOWS_RESERVED_BASENAMES.has(slug)) {
    return `${slug}-canvas`;
  }

  return slug;
}

function buildCanvasSourcePath(slug: string, attempt: number): string {
  const fileName = attempt === 1 ? `${slug}.csc` : `${slug}-${attempt}.csc`;
  return `${CANVAS_SOURCE_DIR}/${fileName}`;
}

export function slugifyCanvasTitle(title: string): string {
  return normalizeCanvasSlug(
    trimEdgeHyphens(
      title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, MAX_SLUG_LENGTH)
    )
  );
}

function getValidatedCanvasSlug(title: string): string {
  const slug = slugifyCanvasTitle(title);
  if (!slug) {
    throw {
      code: "invalid_canvas_title",
      message: "Canvas title must produce a valid file name",
    };
  }

  return slug;
}

export function createCanvasSourcePath(input: {
  workspaceRootPath: string;
  title: string;
}): string {
  const slug = getValidatedCanvasSlug(input.title);

  for (let attempt = 1; ; attempt += 1) {
    const sourcePath = buildCanvasSourcePath(slug, attempt);
    if (!existsSync(join(input.workspaceRootPath, sourcePath))) {
      return sourcePath;
    }
  }
}

export async function writeNewCanvasSource(input: {
  workspaceRootPath: string;
  title: string;
  content: string;
}): Promise<string> {
  const slug = getValidatedCanvasSlug(input.title);

  for (let attempt = 1; ; attempt += 1) {
    const sourcePath = buildCanvasSourcePath(slug, attempt);

    try {
      await writeFileIfMissing(input.workspaceRootPath, sourcePath, input.content);
      return sourcePath;
    } catch (error) {
      if ((error as { code?: string }).code === "already_exists") {
        continue;
      }

      throw error;
    }
  }
}
