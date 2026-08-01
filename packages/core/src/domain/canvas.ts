import { z } from "zod";

export const CanvasArtifactKind = z.enum(["architecture_canvas", "report_canvas"]);
export type CanvasArtifactKind = z.infer<typeof CanvasArtifactKind>;

export const CanvasPresetIdSchema = z.enum([
  "token-consumption-trend",
  "workspace-activity-summary",
  "provider-usage-comparison",
]);
export type CanvasPresetId = z.infer<typeof CanvasPresetIdSchema>;

export const CANVAS_DOCUMENT_VERSION = 1;

export const CanvasRenderStatus = z.enum(["ready", "error", "rendering"]);
export type CanvasRenderStatus = z.infer<typeof CanvasRenderStatus>;

export const CanvasErrorCategory = z.enum(["validation_error", "compile_error", "render_error"]);
export type CanvasErrorCategory = z.infer<typeof CanvasErrorCategory>;

export const CanvasRenderErrorSchema = z.object({
  category: CanvasErrorCategory,
  message: z.string(),
  fieldPath: z.string().optional(),
});
export type CanvasRenderError = z.infer<typeof CanvasRenderErrorSchema>;

const CanvasPointSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type CanvasPoint = z.infer<typeof CanvasPointSchema>;

const CanvasOverlayStrokeSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("stroke"),
  color: z.string().trim().min(1),
  strokeWidth: z.number().positive(),
  points: z.array(CanvasPointSchema).min(1),
});

const CanvasOverlayRectSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("rect"),
  color: z.string().trim().min(1),
  strokeWidth: z.number().positive(),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

const CanvasOverlayArrowSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("arrow"),
  color: z.string().trim().min(1),
  strokeWidth: z.number().positive(),
  from: CanvasPointSchema,
  to: CanvasPointSchema,
});

const CanvasOverlayTextSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal("text"),
  color: z.string().trim().min(1),
  fontSize: z.number().positive(),
  x: z.number(),
  y: z.number(),
  text: z.string().trim().min(1),
});

export const CanvasOverlayObjectSchema = z.discriminatedUnion("type", [
  CanvasOverlayStrokeSchema,
  CanvasOverlayRectSchema,
  CanvasOverlayArrowSchema,
  CanvasOverlayTextSchema,
]);
export type CanvasOverlayObject = z.infer<typeof CanvasOverlayObjectSchema>;

export const CanvasOverlayDocumentSchema = z.object({
  version: z.literal(1),
  objects: z.array(CanvasOverlayObjectSchema),
});
export type CanvasOverlayDocument = z.infer<typeof CanvasOverlayDocumentSchema>;

export const CanvasSceneRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type CanvasSceneRect = z.infer<typeof CanvasSceneRectSchema>;

export const CanvasSceneElementKindSchema = z.enum([
  "chart-block",
  "chart-series",
  "chart-point",
  "report-stat",
  "table-cell",
  "callout",
  "markdown-block",
  "list-block",
  "mermaid-node",
  "mermaid-edge",
  "overlay-object",
]);
export type CanvasSceneElementKind = z.infer<typeof CanvasSceneElementKindSchema>;

export const CanvasSceneElementSchema = z.object({
  id: z.string().trim().min(1),
  kind: CanvasSceneElementKindSchema,
  rect: CanvasSceneRectSchema,
  label: z.string().trim().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type CanvasSceneElement = z.infer<typeof CanvasSceneElementSchema>;

export const CanvasSceneManifestSchema = z.object({
  version: z.literal(1),
  elements: z.array(CanvasSceneElementSchema),
});
export type CanvasSceneManifest = z.infer<typeof CanvasSceneManifestSchema>;

export const CanvasAnchorCommentSchema = z.object({
  id: z.string().trim().min(1),
  elementIds: z.array(z.string().trim().min(1)),
  targets: z.array(CanvasSceneElementSchema).optional(),
  selectionRect: CanvasSceneRectSchema.optional(),
  body: z.string().trim().min(1),
  status: z.enum(["open", "resolved"]),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
});
export type CanvasAnchorComment = z.infer<typeof CanvasAnchorCommentSchema>;

export const CanvasAnchorCommentDocumentSchema = z.object({
  version: z.literal(1),
  comments: z.array(CanvasAnchorCommentSchema),
});
export type CanvasAnchorCommentDocument = z.infer<typeof CanvasAnchorCommentDocumentSchema>;

export function createEmptyCanvasOverlayDocument(): CanvasOverlayDocument {
  return {
    version: 1,
    objects: [],
  };
}

const GraphDiagramSchema = z.object({
  dsl: z.literal("mermaid"),
  source: z.string().trim().min(1),
});

const ArchitectureCanvasAnnotationSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

const ArchitectureCanvasDocumentSchema = z.object({
  summary: z.string().trim().min(1),
  diagram: GraphDiagramSchema,
  annotations: z.array(ArchitectureCanvasAnnotationSchema),
});
export type ArchitectureCanvasDocument = z.infer<typeof ArchitectureCanvasDocumentSchema>;

const ReportStatSchema = z.object({
  label: z.string().trim().min(1),
  value: z.union([z.string(), z.number()]),
  tone: z.enum(["neutral", "info", "success", "warning", "danger"]).optional(),
});

export const ReportChartKindSchema = z.enum(["line", "bar", "sparkline"]);
export type ReportChartKind = z.infer<typeof ReportChartKindSchema>;

export const ReportChartSeriesSchema = z.object({
  name: z.string().trim().min(1),
  values: z.array(z.number()),
});
export type ReportChartSeries = z.infer<typeof ReportChartSeriesSchema>;

export const ReportChartBlockSchema = z.object({
  type: z.literal("chart"),
  kind: ReportChartKindSchema,
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1).optional(),
  unit: z.string().trim().min(1).optional(),
  categories: z.array(z.string().trim().min(1)).min(1),
  series: z.array(ReportChartSeriesSchema).min(1),
  showLegend: z.boolean().optional(),
});
export type ReportChartBlock = z.infer<typeof ReportChartBlockSchema>;

function validateReportChartSeriesAlignment(
  sections: Array<{
    blocks: Array<{ type: string; series?: Array<{ values: unknown[] }>; categories?: unknown[] }>;
  }>,
  ctx: z.RefinementCtx
) {
  sections.forEach((section, sectionIndex) => {
    section.blocks.forEach((block, blockIndex) => {
      if (block.type !== "chart") {
        return;
      }

      block.series?.forEach((series, seriesIndex) => {
        if (series.values.length === block.categories?.length) {
          return;
        }

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", sectionIndex, "blocks", blockIndex, "series", seriesIndex, "values"],
          message: "series.values length must match categories length",
        });
      });
    });
  });
}

const ReportBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stats"),
    items: z.array(ReportStatSchema).min(1),
  }),
  ReportChartBlockSchema,
  z.object({
    type: z.literal("markdown"),
    markdown: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("list"),
    items: z.array(z.string().trim().min(1)).min(1),
  }),
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string().trim().min(1)).min(1),
    rows: z.array(z.array(z.string())).min(1),
  }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(["info", "success", "warning", "danger"]),
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
  }),
]);

const ReportCanvasDocumentBaseSchema = z.object({
  summary: z.string().trim().min(1),
  stats: z.array(ReportStatSchema),
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        blocks: z.array(ReportBlockSchema).min(1),
      })
    )
    .min(1),
});
export const ReportCanvasDocumentSchema = ReportCanvasDocumentBaseSchema.superRefine(
  (value, ctx) => {
    validateReportChartSeriesAlignment(value.sections, ctx);
  }
);
export type ReportCanvasDocument = z.infer<typeof ReportCanvasDocumentSchema>;

export const CanvasDocumentEnvelopeSchema = z.discriminatedUnion("kind", [
  z.object({
    version: z.literal(CANVAS_DOCUMENT_VERSION),
    kind: z.literal("architecture_canvas"),
    title: z.string().trim().min(1),
    document: ArchitectureCanvasDocumentSchema,
  }),
  z.object({
    version: z.literal(CANVAS_DOCUMENT_VERSION),
    kind: z.literal("report_canvas"),
    title: z.string().trim().min(1),
    document: ReportCanvasDocumentSchema,
  }),
]);
export type CanvasDocumentEnvelope = z.infer<typeof CanvasDocumentEnvelopeSchema>;

const CompiledArchitectureCanvasSchema = z.object({
  kind: z.literal("architecture_canvas"),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  sections: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("diagram"),
        mermaidSource: z.string().trim().min(1).optional(),
        direction: z.enum(["TB", "TD", "BT", "LR", "RL"]).optional(),
        groups: z
          .array(
            z.object({
              id: z.string().trim().min(1),
              label: z.string().trim().min(1),
              nodeIds: z.array(z.string().trim().min(1)).min(1),
            })
          )
          .optional(),
        nodes: z.array(
          z.object({
            id: z.string().trim().min(1),
            label: z.string().trim().min(1).optional(),
          })
        ),
        edges: z.array(
          z.object({
            from: z.string().trim().min(1),
            to: z.string().trim().min(1),
            label: z.string().trim().min(1).optional(),
          })
        ),
      }),
      z.object({
        type: z.literal("annotations"),
        items: z.array(ArchitectureCanvasAnnotationSchema),
      }),
    ])
  ),
});

const CompiledReportBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("markdown"),
    markdown: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("list"),
    items: z.array(z.string().trim().min(1)).min(1),
  }),
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string().trim().min(1)).min(1),
    rows: z.array(z.array(z.string())).min(1),
  }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(["info", "success", "warning", "danger"]),
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("stats"),
    items: z.array(
      z.object({
        label: z.string().trim().min(1),
        value: z.string(),
        tone: z.enum(["neutral", "info", "success", "warning", "danger"]).optional(),
      })
    ),
  }),
  ReportChartBlockSchema,
]);

const CompiledReportCanvasBaseSchema = z.object({
  kind: z.literal("report_canvas"),
  title: z.string().trim().min(1),
  sections: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("stats"),
        items: z.array(
          z.object({
            label: z.string().trim().min(1),
            value: z.string(),
            tone: z.enum(["neutral", "info", "success", "warning", "danger"]).optional(),
          })
        ),
      }),
      z.object({
        type: z.literal("section"),
        title: z.string().trim().min(1),
        blocks: z.array(CompiledReportBlockSchema),
      }),
    ])
  ),
});
const CompiledReportCanvasSchema = CompiledReportCanvasBaseSchema.superRefine((value, ctx) => {
  value.sections.forEach((section, sectionIndex) => {
    if (section.type !== "section") {
      return;
    }

    section.blocks.forEach((block, blockIndex) => {
      if (block.type !== "chart") {
        return;
      }

      block.series.forEach((series, seriesIndex) => {
        if (series.values.length === block.categories.length) {
          return;
        }

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", sectionIndex, "blocks", blockIndex, "series", seriesIndex, "values"],
          message: "series.values length must match categories length",
        });
      });
    });
  });
});

export const CompiledCanvasSchema = z.discriminatedUnion("kind", [
  CompiledArchitectureCanvasSchema,
  CompiledReportCanvasSchema,
]);
export type CompiledCanvas = z.infer<typeof CompiledCanvasSchema>;

export const CanvasPresetSummarySchema = z.object({
  id: CanvasPresetIdSchema,
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  kind: z.literal("report_canvas"),
});
export type CanvasPresetSummary = z.infer<typeof CanvasPresetSummarySchema>;

export const CanvasDataResponseSchema = z
  .object({
    canvasId: z.string().trim().min(1).optional(),
    workspaceId: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
    title: z.string().trim().min(1),
    kind: CanvasArtifactKind,
    renderStatus: z.enum(["ready", "error"]),
    lastError: CanvasRenderErrorSchema.nullable().optional(),
    overlayDocument: CanvasOverlayDocumentSchema.optional(),
    compiledDocument: CompiledCanvasSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.renderStatus === "ready") {
      if (!value.compiledDocument) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compiledDocument"],
          message: "compiledDocument is required when renderStatus is ready",
        });
      }

      if (value.compiledDocument && value.compiledDocument.kind !== value.kind) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compiledDocument", "kind"],
          message: "compiledDocument.kind must match kind",
        });
      }

      if (value.lastError !== null && value.lastError !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lastError"],
          message: "lastError must be null or undefined when renderStatus is ready",
        });
      }
    }

    if (value.renderStatus === "error") {
      if (value.compiledDocument) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["compiledDocument"],
          message: "compiledDocument must be absent when renderStatus is error",
        });
      }

      if (value.lastError == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lastError"],
          message: "lastError is required when renderStatus is error",
        });
      }
    }
  });
export type CanvasDataResponse = z.infer<typeof CanvasDataResponseSchema>;

export const CanvasInspectionResponseSchema = CanvasDataResponseSchema.extend({
  sceneManifest: CanvasSceneManifestSchema.optional(),
  anchorCommentDocument: CanvasAnchorCommentDocumentSchema.optional(),
  inspectionImageUrl: z.string().trim().min(1).optional(),
});
export type CanvasInspectionResponse = z.infer<typeof CanvasInspectionResponseSchema>;

export const CanvasSnapshotDataResponseSchema = z.object({
  snapshotId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  kind: CanvasArtifactKind,
  createdAt: z.number().int().nonnegative(),
  sourceHash: z.string().trim().min(1),
  compiledDocument: CompiledCanvasSchema,
});
export type CanvasSnapshotDataResponse = z.infer<typeof CanvasSnapshotDataResponseSchema>;

export interface CanvasRecord {
  id: string;
  workspaceId: string;
  sessionId?: string;
  sourcePath: string;
  artifactType: CanvasArtifactKind;
  title: string;
  updatedAt: number;
  renderStatus: CanvasRenderStatus;
  lastError?: CanvasRenderError | null;
}

export function parseCanvasDocumentEnvelope(value: unknown): CanvasDocumentEnvelope {
  const result = CanvasDocumentEnvelopeSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const firstIssue = result.error.issues[0];
  if (!firstIssue) {
    throw new Error("Invalid canvas");
  }

  const path = firstIssue?.path?.length ? firstIssue.path.join(".") : undefined;
  const message = path ? `${path}: ${firstIssue.message}` : firstIssue.message;

  throw new Error(message);
}
