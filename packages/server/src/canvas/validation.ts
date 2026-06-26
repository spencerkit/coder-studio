import {
  type CanvasDocumentEnvelope,
  CanvasDocumentEnvelopeSchema,
  type CanvasRenderError,
} from "@coder-studio/core";
import { ZodError } from "zod";

const HTML_LIKE_PATTERN = /<[a-z!/][^>]*>/iu;

function findHtmlLikeStringField(value: unknown, path: string[] = []): string | null {
  if (typeof value === "string") {
    return HTML_LIKE_PATTERN.test(value) ? path.join(".") : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const result = findHtmlLikeStringField(item, [...path, String(index)]);
      if (result) {
        return result;
      }
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    const result = findHtmlLikeStringField(child, childPath);
    if (result) {
      return result;
    }
  }

  return null;
}

export function validateCanvasSource(
  source: string
): { ok: true; document: CanvasDocumentEnvelope } | { ok: false; error: CanvasRenderError } {
  try {
    const parsedJson = JSON.parse(source) as unknown;
    const htmlLikeFieldPath = findHtmlLikeStringField(parsedJson);
    if (htmlLikeFieldPath) {
      return {
        ok: false,
        error: {
          category: "validation_error",
          message: "Canvas source must not contain raw HTML",
          fieldPath: htmlLikeFieldPath,
        },
      };
    }

    return {
      ok: true,
      document: CanvasDocumentEnvelopeSchema.parse(parsedJson),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        error: {
          category: "validation_error",
          message: error.message,
        },
      };
    }

    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return {
        ok: false,
        error: {
          category: "validation_error",
          message: issue?.message ?? "Invalid canvas source",
          fieldPath: issue?.path.join("."),
        },
      };
    }

    return {
      ok: false,
      error: {
        category: "validation_error",
        message: (error as Error).message || "Invalid canvas source",
      },
    };
  }
}
