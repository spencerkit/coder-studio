import {
  CANVAS_DOCUMENT_VERSION,
  type CanvasDocumentEnvelope,
  type CanvasPresetId,
  type CanvasPresetSummary,
} from "@coder-studio/core";

interface CanvasPresetDefinition extends CanvasPresetSummary {
  buildDocument(input: { title: string }): CanvasDocumentEnvelope;
}

const CANVAS_PRESETS: CanvasPresetDefinition[] = [
  {
    id: "token-consumption-trend",
    title: "Token Consumption Trend",
    description: "Time-series prompt and completion token usage.",
    kind: "report_canvas",
    buildDocument: ({ title }) => ({
      version: CANVAS_DOCUMENT_VERSION,
      kind: "report_canvas",
      title,
      document: {
        summary: "Token usage trend report.",
        stats: [],
        sections: [
          {
            title: "Usage",
            blocks: [
              {
                type: "chart",
                kind: "line",
                title,
                summary: "Prompt and completion token usage over time.",
                unit: "tokens",
                categories: ["09:00", "10:00", "11:00"],
                series: [
                  { name: "Prompt", values: [0, 0, 0] },
                  { name: "Completion", values: [0, 0, 0] },
                ],
                showLegend: true,
              },
            ],
          },
        ],
      },
    }),
  },
  {
    id: "workspace-activity-summary",
    title: "Workspace Activity Summary",
    description: "Compact summary of recent workspace activity.",
    kind: "report_canvas",
    buildDocument: ({ title }) => ({
      version: CANVAS_DOCUMENT_VERSION,
      kind: "report_canvas",
      title,
      document: {
        summary: "Workspace activity summary.",
        stats: [],
        sections: [
          {
            title: "Activity",
            blocks: [
              {
                type: "chart",
                kind: "bar",
                title,
                summary: "Activity counts by time bucket.",
                unit: "events",
                categories: ["Mon", "Tue", "Wed"],
                series: [{ name: "Events", values: [0, 0, 0] }],
                showLegend: false,
              },
            ],
          },
        ],
      },
    }),
  },
  {
    id: "provider-usage-comparison",
    title: "Provider Usage Comparison",
    description: "Side-by-side provider usage comparison.",
    kind: "report_canvas",
    buildDocument: ({ title }) => ({
      version: CANVAS_DOCUMENT_VERSION,
      kind: "report_canvas",
      title,
      document: {
        summary: "Provider usage comparison.",
        stats: [],
        sections: [
          {
            title: "Providers",
            blocks: [
              {
                type: "chart",
                kind: "bar",
                title,
                summary: "Usage totals by provider.",
                unit: "requests",
                categories: ["Claude", "Codex", "Gemini"],
                series: [{ name: "Requests", values: [0, 0, 0] }],
                showLegend: false,
              },
            ],
          },
        ],
      },
    }),
  },
];

export function listCanvasPresets(): CanvasPresetSummary[] {
  return CANVAS_PRESETS.map(({ buildDocument: _buildDocument, ...preset }) => preset);
}

export function getCanvasPresetOrThrow(presetId: CanvasPresetId): CanvasPresetDefinition {
  const preset = CANVAS_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) {
    throw { code: "canvas_preset_not_found", message: `Canvas preset not found: ${presetId}` };
  }

  return preset;
}
