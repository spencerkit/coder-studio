// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCanvasInspectionData,
  saveCanvasAnchorComments,
  saveCanvasOverlay,
} from "../../../canvas/api";
import { exportCanvasPng } from "../../../canvas/utils/export-canvas-png";
import { CanvasSurface } from "./canvas-surface";

const echartsMock = vi.hoisted(() => {
  const chart = {
    dispose: vi.fn(),
    getHeight: vi.fn(() => 280),
    getWidth: vi.fn(() => 420),
    resize: vi.fn(),
    setOption: vi.fn(),
  };

  return {
    chart,
    init: vi.fn(() => chart),
  };
});

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    const dictionary: Record<string, string> = {
      "code_editor.preview_unavailable": "Preview unavailable",
      "code_editor.canvas_zoom_controls": "Canvas zoom controls",
      "code_editor.canvas_zoom_reset": "Reset zoom",
      "code_editor.image_zoom_out": "Zoom out",
      "code_editor.image_zoom_in": "Zoom in",
      "code_editor.image_zoom_level": "Zoom level",
      "code_editor.canvas_annotation_toolbar": "Canvas annotation tools",
      "code_editor.canvas_annotation_select": "Select annotation",
      "code_editor.canvas_annotation_inspect": "Inspect canvas",
      "code_editor.canvas_annotation_pen": "Draw annotation",
      "code_editor.canvas_annotation_arrow": "Arrow annotation",
      "code_editor.canvas_annotation_rect": "Rectangle annotation",
      "code_editor.canvas_annotation_text": "Text annotation",
      "code_editor.canvas_annotation_delete": "Delete annotation",
      "code_editor.canvas_annotation_clear": "Clear annotations",
      "code_editor.canvas_inspect_comment_title": "Add comment",
      "code_editor.canvas_inspect_comment_placeholder": "Describe what should change",
      "code_editor.canvas_inspect_comment_save": "Save comment",
      "code_editor.canvas_inspect_comment_cancel": "Cancel",
      "code_editor.canvas_inspect_selected_label": "Selected element",
      "code_editor.canvas_inspect_save_failed": "Failed to save comment",
      "code_editor.canvas_export_png": "Export PNG",
      "code_editor.canvas_export_in_progress": "Exporting PNG",
      "code_editor.canvas_export_failed": "Failed to export canvas",
      "code_editor.canvas_export_unavailable": "Canvas export is unavailable",
      "code_editor.canvas_export_unsaved_comment": "Save the comment before exporting",
    };
    return dictionary[key] ?? key;
  },
}));

vi.mock("../../../canvas/api", () => ({
  fetchCanvasData: vi.fn(),
  fetchCanvasInspectionData: vi.fn(),
  saveCanvasAnchorComments: vi.fn(),
  saveCanvasOverlay: vi.fn(),
}));

vi.mock("echarts", () => ({
  init: echartsMock.init,
}));

vi.mock("../../../canvas/utils/export-canvas-png", () => ({
  exportCanvasPng: vi.fn(),
}));

const runtimeFlowPayload = {
  workspaceId: "ws-1",
  sourcePath: ".coder-studio/canvases/runtime-flow.csc",
  title: "Runtime Flow",
  kind: "architecture_canvas" as const,
  renderStatus: "ready" as const,
  lastError: null,
  overlayDocument: {
    version: 1 as const,
    objects: [],
  },
  anchorCommentDocument: {
    version: 1 as const,
    comments: [],
  },
  compiledDocument: {
    kind: "architecture_canvas" as const,
    title: "Runtime Flow",
    summary: "How requests move.",
    sections: [
      {
        type: "diagram" as const,
        nodes: [{ id: "web", label: "Web UI" }],
        edges: [],
      },
      {
        type: "annotations" as const,
        items: [],
      },
    ],
  },
};

function createRuntimeFlowPayload(
  objects: Array<
    | {
        id: string;
        type: "text";
        color: string;
        fontSize: number;
        x: number;
        y: number;
        text: string;
      }
    | {
        id: string;
        type: "rect";
        color: string;
        strokeWidth: number;
        x: number;
        y: number;
        width: number;
        height: number;
      }
    | {
        id: string;
        type: "arrow";
        color: string;
        strokeWidth: number;
        from: { x: number; y: number };
        to: { x: number; y: number };
      }
    | {
        id: string;
        type: "stroke";
        color: string;
        strokeWidth: number;
        points: Array<{ x: number; y: number }>;
      }
  >
) {
  return {
    ...runtimeFlowPayload,
    overlayDocument: {
      version: 1 as const,
      objects,
    },
  };
}

const tokenConsumptionPayload = {
  workspaceId: "ws-1",
  sourcePath: ".coder-studio/canvases/token-consumption.csc",
  title: "Token Consumption",
  kind: "report_canvas" as const,
  renderStatus: "ready" as const,
  lastError: null,
  overlayDocument: {
    version: 1 as const,
    objects: [],
  },
  sceneManifest: {
    version: 1 as const,
    elements: [
      {
        id: "chart-point:prompt:10:00",
        kind: "chart-point" as const,
        rect: { x: 112, y: 40, width: 28, height: 24 },
        label: "Prompt at 10:00",
        payload: {
          category: "10:00",
          chartKind: "line",
          seriesName: "Prompt",
          value: 1800,
        },
      },
    ],
  },
  anchorCommentDocument: {
    version: 1 as const,
    comments: [],
  },
  compiledDocument: {
    kind: "report_canvas" as const,
    title: "Token Consumption",
    summary: "Prompt versus completion usage.",
    stats: [],
    sections: [
      {
        type: "section" as const,
        title: "Usage",
        blocks: [
          {
            type: "chart" as const,
            kind: "line" as const,
            title: "Token Consumption",
            summary: "Prompt vs completion over the last 3 hours.",
            unit: "tokens",
            categories: ["09:00", "10:00", "11:00"],
            series: [
              { name: "Prompt", values: [1200, 1800, 900] },
              { name: "Completion", values: [400, 700, 500] },
            ],
            showLegend: true,
          },
        ],
      },
    ],
  },
};

function renderCanvasSurface(options: { sourcePath?: string; title?: string } = {}) {
  const store = createStore();
  const sourcePath = options.sourcePath ?? ".coder-studio/canvases/runtime-flow.csc";
  const title = options.title ?? "Runtime Flow";

  const view = render(
    <Provider store={store}>
      <CanvasSurface
        workspaceId="ws-1"
        tab={{
          kind: "canvas",
          id: `canvas:${sourcePath}`,
          title,
          sourcePath,
        }}
      />
    </Provider>
  );

  return { store, ...view };
}

describe("CanvasSurface", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    echartsMock.init.mockClear();
    echartsMock.chart.dispose.mockClear();
    echartsMock.chart.getHeight.mockClear();
    echartsMock.chart.getWidth.mockClear();
    echartsMock.chart.resize.mockClear();
    echartsMock.chart.setOption.mockClear();
  });

  it("renders canvas inline with zoom controls", async () => {
    const fetchCanvasInspectionDataMock = vi.mocked(fetchCanvasInspectionData);
    fetchCanvasInspectionDataMock.mockResolvedValue(runtimeFlowPayload);

    const { container } = renderCanvasSurface();

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector(".canvas-surface__viewport")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Canvas zoom controls" })).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchCanvasInspectionDataMock).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc"
      );
    });
    expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
  });

  it("updates zoom level from the zoom buttons and ctrl+wheel", async () => {
    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(runtimeFlowPayload);
    const { container } = renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("100%");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("110%");

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("100%");

    const viewport = container.querySelector(".canvas-surface__viewport");
    expect(viewport).toBeTruthy();
    fireEvent.wheel(viewport as HTMLElement, { deltaY: -1, ctrlKey: true });
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("110%");

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("100%");
  });

  it("shows annotation tools and saves a text annotation", async () => {
    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(runtimeFlowPayload);
    vi.mocked(saveCanvasOverlay).mockResolvedValue({
      version: 1,
      objects: [
        {
          id: "text-1",
          type: "text",
          color: "#0f172a",
          fontSize: 16,
          x: 40,
          y: 52,
          text: "Investigate this edge",
        },
      ],
    });

    const { container } = renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    expect(screen.getByRole("toolbar", { name: "Canvas annotation tools" })).toBeInTheDocument();

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Text annotation" }));
    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 40,
      clientY: 52,
      button: 0,
    });

    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Investigate this edge" } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(saveCanvasOverlay).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc",
        expect.objectContaining({
          objects: [expect.objectContaining({ type: "text", text: "Investigate this edge" })],
        })
      );
    });
  });

  it("deletes the selected annotation", async () => {
    const removableAnnotation = {
      id: "text-1",
      type: "text" as const,
      color: "#0f172a",
      fontSize: 16,
      x: 40,
      y: 52,
      text: "Remove me",
    };
    const remainingAnnotation = {
      id: "text-2",
      type: "text" as const,
      color: "#0f172a",
      fontSize: 16,
      x: 180,
      y: 120,
      text: "Keep me",
    };

    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(
      createRuntimeFlowPayload([removableAnnotation, remainingAnnotation])
    );
    vi.mocked(saveCanvasOverlay).mockResolvedValue({
      version: 1,
      objects: [remainingAnnotation],
    });

    const { container } = renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 40,
      clientY: 52,
      button: 0,
    });
    fireEvent.pointerUp(scene as HTMLDivElement, {
      clientX: 40,
      clientY: 52,
      button: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete annotation" }));

    await waitFor(() => {
      expect(saveCanvasOverlay).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc",
        {
          version: 1,
          objects: [remainingAnnotation],
        }
      );
    });
  });

  it("clears all annotations", async () => {
    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(
      createRuntimeFlowPayload([
        {
          id: "rect-1",
          type: "rect",
          color: "#ff3366",
          strokeWidth: 3,
          x: 20,
          y: 24,
          width: 140,
          height: 88,
        },
        {
          id: "text-1",
          type: "text",
          color: "#0f172a",
          fontSize: 16,
          x: 40,
          y: 52,
          text: "Investigate this edge",
        },
      ])
    );
    vi.mocked(saveCanvasOverlay).mockResolvedValue({
      version: 1,
      objects: [],
    });

    renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear annotations" }));

    await waitFor(() => {
      expect(saveCanvasOverlay).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc",
        {
          version: 1,
          objects: [],
        }
      );
    });
  });

  it("keeps annotations that are added after clearing all annotations", async () => {
    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(
      createRuntimeFlowPayload([
        {
          id: "rect-1",
          type: "rect",
          color: "#ff3366",
          strokeWidth: 3,
          x: 20,
          y: 24,
          width: 140,
          height: 88,
        },
      ])
    );
    vi.mocked(saveCanvasOverlay).mockImplementation(
      async (_workspaceId, _sourcePath, document) => document
    );

    const { container } = renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear annotations" }));

    await waitFor(() => {
      expect(saveCanvasOverlay).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc",
        {
          version: 1,
          objects: [],
        }
      );
    });
    await waitFor(() => {
      expect(container.querySelectorAll(".canvas-overlay-layer__svg rect")).toHaveLength(0);
    });

    vi.mocked(saveCanvasOverlay).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Rectangle annotation" }));
    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 220,
      clientY: 80,
      button: 0,
    });
    fireEvent.pointerMove(scene as HTMLDivElement, {
      clientX: 300,
      clientY: 150,
      button: 0,
    });
    fireEvent.pointerUp(scene as HTMLDivElement, {
      clientX: 300,
      clientY: 150,
      button: 0,
    });

    await waitFor(() => {
      expect(saveCanvasOverlay).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc",
        expect.objectContaining({
          objects: [
            expect.objectContaining({
              type: "rect",
              x: 220,
              y: 80,
              width: 80,
              height: 70,
            }),
          ],
        })
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveCanvasOverlay).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".canvas-overlay-layer__svg rect")).toHaveLength(1);
  });

  it("does not delete a later selection from a stale delete command", async () => {
    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(
      createRuntimeFlowPayload([
        {
          id: "rect-1",
          type: "rect",
          color: "#ff3366",
          strokeWidth: 3,
          x: 20,
          y: 24,
          width: 140,
          height: 88,
        },
      ])
    );
    vi.mocked(saveCanvasOverlay).mockImplementation(
      async (_workspaceId, _sourcePath, document) => document
    );

    const { container } = renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete annotation" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 60,
      clientY: 60,
      button: 0,
    });
    fireEvent.pointerUp(scene as HTMLDivElement, {
      clientX: 60,
      clientY: 60,
      button: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveCanvasOverlay).not.toHaveBeenCalled();
    expect(container.querySelector(".canvas-overlay-layer__selection")).toBeTruthy();
    expect(container.querySelectorAll(".canvas-overlay-layer__svg rect")).toHaveLength(3);
  });

  it("moves a selected text annotation and saves the updated position", async () => {
    const movedAnnotation = {
      id: "text-1",
      type: "text" as const,
      color: "#0f172a",
      fontSize: 16,
      x: 40,
      y: 52,
      text: "Move me",
    };

    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(
      createRuntimeFlowPayload([movedAnnotation])
    );
    vi.mocked(saveCanvasOverlay).mockResolvedValue({
      version: 1,
      objects: [
        {
          ...movedAnnotation,
          x: 120,
          y: 140,
        },
      ],
    });

    const { container } = renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 40,
      clientY: 52,
      button: 0,
    });
    fireEvent.pointerMove(scene as HTMLDivElement, {
      clientX: 120,
      clientY: 140,
      button: 0,
    });
    fireEvent.pointerUp(scene as HTMLDivElement, {
      clientX: 120,
      clientY: 140,
      button: 0,
    });

    await waitFor(() => {
      expect(saveCanvasOverlay).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc",
        {
          version: 1,
          objects: [
            {
              ...movedAnnotation,
              x: 120,
              y: 140,
            },
          ],
        }
      );
    });
  });

  it("moves a selected arrow annotation and saves the updated points", async () => {
    const movedAnnotation = {
      id: "arrow-1",
      type: "arrow" as const,
      color: "#ff3366",
      strokeWidth: 3,
      from: { x: 40, y: 60 },
      to: { x: 140, y: 120 },
    };

    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(
      createRuntimeFlowPayload([movedAnnotation])
    );
    vi.mocked(saveCanvasOverlay).mockResolvedValue({
      version: 1,
      objects: [
        {
          ...movedAnnotation,
          from: { x: 100, y: 110 },
          to: { x: 200, y: 170 },
        },
      ],
    });

    const { container } = renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 90,
      clientY: 90,
      button: 0,
    });
    fireEvent.pointerMove(scene as HTMLDivElement, {
      clientX: 150,
      clientY: 140,
      button: 0,
    });
    fireEvent.pointerUp(scene as HTMLDivElement, {
      clientX: 150,
      clientY: 140,
      button: 0,
    });

    await waitFor(() => {
      expect(saveCanvasOverlay).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc",
        {
          version: 1,
          objects: [
            {
              ...movedAnnotation,
              from: { x: 100, y: 110 },
              to: { x: 200, y: 170 },
            },
          ],
        }
      );
    });
  });

  it("resizes a selected rectangle annotation and saves the updated bounds", async () => {
    const resizedAnnotation = {
      id: "rect-1",
      type: "rect" as const,
      color: "#ff3366",
      strokeWidth: 3,
      x: 20,
      y: 24,
      width: 140,
      height: 88,
    };

    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(
      createRuntimeFlowPayload([resizedAnnotation])
    );
    vi.mocked(saveCanvasOverlay).mockResolvedValue({
      version: 1,
      objects: [
        {
          ...resizedAnnotation,
          width: 200,
          height: 136,
        },
      ],
    });

    const { container } = renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 60,
      clientY: 60,
      button: 0,
    });
    fireEvent.pointerUp(scene as HTMLDivElement, {
      clientX: 60,
      clientY: 60,
      button: 0,
    });

    await waitFor(() => {
      expect(container.querySelector(".canvas-overlay-layer__handle--rect-resize")).toBeTruthy();
    });
    const resizeHandle = container.querySelector(".canvas-overlay-layer__handle--rect-resize");

    fireEvent.pointerDown(resizeHandle as Element, {
      clientX: 160,
      clientY: 112,
      button: 0,
    });
    fireEvent.pointerMove(scene as HTMLDivElement, {
      clientX: 220,
      clientY: 160,
      button: 0,
    });
    fireEvent.pointerUp(scene as HTMLDivElement, {
      clientX: 220,
      clientY: 160,
      button: 0,
    });

    await waitFor(() => {
      expect(saveCanvasOverlay).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc",
        {
          version: 1,
          objects: [
            {
              ...resizedAnnotation,
              width: 200,
              height: 136,
            },
          ],
        }
      );
    });
  });

  it("drags a selected arrow endpoint and saves the updated endpoint", async () => {
    const movedEndpointAnnotation = {
      id: "arrow-1",
      type: "arrow" as const,
      color: "#ff3366",
      strokeWidth: 3,
      from: { x: 40, y: 60 },
      to: { x: 140, y: 120 },
    };

    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(
      createRuntimeFlowPayload([movedEndpointAnnotation])
    );
    vi.mocked(saveCanvasOverlay).mockResolvedValue({
      version: 1,
      objects: [
        {
          ...movedEndpointAnnotation,
          to: { x: 220, y: 180 },
        },
      ],
    });

    const { container } = renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 90,
      clientY: 90,
      button: 0,
    });
    fireEvent.pointerUp(scene as HTMLDivElement, {
      clientX: 90,
      clientY: 90,
      button: 0,
    });

    const endpointHandle = container.querySelector(".canvas-overlay-layer__handle--arrow-to");
    expect(endpointHandle).toBeTruthy();

    fireEvent.pointerDown(endpointHandle as Element, {
      clientX: 140,
      clientY: 120,
      button: 0,
    });
    fireEvent.pointerMove(scene as HTMLDivElement, {
      clientX: 220,
      clientY: 180,
      button: 0,
    });
    fireEvent.pointerUp(scene as HTMLDivElement, {
      clientX: 220,
      clientY: 180,
      button: 0,
    });

    await waitFor(() => {
      expect(saveCanvasOverlay).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc",
        {
          version: 1,
          objects: [
            {
              ...movedEndpointAnnotation,
              to: { x: 220, y: 180 },
            },
          ],
        }
      );
    });
  });

  it("moves a selected stroke annotation and saves the translated path", async () => {
    const movedAnnotation = {
      id: "stroke-1",
      type: "stroke" as const,
      color: "#ff3366",
      strokeWidth: 3,
      points: [
        { x: 30, y: 40 },
        { x: 55, y: 60 },
        { x: 80, y: 90 },
      ],
    };

    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(
      createRuntimeFlowPayload([movedAnnotation])
    );
    vi.mocked(saveCanvasOverlay).mockResolvedValue({
      version: 1,
      objects: [
        {
          ...movedAnnotation,
          points: [
            { x: 90, y: 95 },
            { x: 115, y: 115 },
            { x: 140, y: 145 },
          ],
        },
      ],
    });

    const { container } = renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 55,
      clientY: 60,
      button: 0,
    });
    fireEvent.pointerMove(scene as HTMLDivElement, {
      clientX: 115,
      clientY: 115,
      button: 0,
    });
    fireEvent.pointerUp(scene as HTMLDivElement, {
      clientX: 115,
      clientY: 115,
      button: 0,
    });

    await waitFor(() => {
      expect(saveCanvasOverlay).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc",
        {
          version: 1,
          objects: [
            {
              ...movedAnnotation,
              points: [
                { x: 90, y: 95 },
                { x: 115, y: 115 },
                { x: 140, y: 145 },
              ],
            },
          ],
        }
      );
    });
  });

  it("includes an inspect mode button in the annotation toolbar", async () => {
    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(runtimeFlowPayload);

    renderCanvasSurface();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Inspect canvas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export PNG" })).toBeInTheDocument();
  });

  it("selects a semantic scene element in inspect mode", async () => {
    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(tokenConsumptionPayload);

    const { container } = renderCanvasSurface({
      sourcePath: ".coder-studio/canvases/token-consumption.csc",
      title: "Token Consumption",
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Token Consumption" })
      ).toBeInTheDocument();
    });

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Inspect canvas" }));
    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 120,
      clientY: 52,
      button: 0,
    });

    expect(container.querySelector(".canvas-overlay-layer__inspect-selection")).toBeTruthy();
    expect(screen.getByText("Add comment")).toBeInTheDocument();
    expect(screen.getByText("Prompt at 10:00")).toBeInTheDocument();
  });

  it("saves an anchor comment for the selected semantic scene element", async () => {
    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(tokenConsumptionPayload);
    vi.mocked(saveCanvasAnchorComments).mockResolvedValue({
      version: 1,
      comments: [
        {
          id: "comment-1",
          elementIds: ["chart-point:prompt:10:00"],
          targets: [
            {
              id: "chart-point:prompt:10:00",
              kind: "chart-point",
              rect: { x: 112, y: 40, width: 28, height: 24 },
              label: "Prompt at 10:00",
              payload: {
                category: "10:00",
                chartKind: "line",
                seriesName: "Prompt",
                value: 1800,
              },
            },
          ],
          selectionRect: { x: 112, y: 40, width: 28, height: 24 },
          body: "Explain this peak",
          status: "open",
          createdAt: "2026-06-28T10:00:00.000Z",
          updatedAt: "2026-06-28T10:00:00.000Z",
        },
      ],
    });

    const { container } = renderCanvasSurface({
      sourcePath: ".coder-studio/canvases/token-consumption.csc",
      title: "Token Consumption",
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Token Consumption" })
      ).toBeInTheDocument();
    });

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Inspect canvas" }));
    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 120,
      clientY: 52,
      button: 0,
    });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Explain this peak" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));

    await waitFor(() => {
      expect(saveCanvasAnchorComments).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/token-consumption.csc",
        expect.objectContaining({
          comments: [
            expect.objectContaining({
              elementIds: ["chart-point:prompt:10:00"],
              targets: [
                expect.objectContaining({
                  id: "chart-point:prompt:10:00",
                  kind: "chart-point",
                  label: "Prompt at 10:00",
                  payload: expect.objectContaining({
                    category: "10:00",
                    chartKind: "line",
                    seriesName: "Prompt",
                    value: 1800,
                  }),
                }),
              ],
              selectionRect: { x: 112, y: 40, width: 28, height: 24 },
              body: "Explain this peak",
            }),
          ],
        })
      );
    });
  });

  it("blocks export while an inspect comment draft is unsaved", async () => {
    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(tokenConsumptionPayload);

    const { container } = renderCanvasSurface({
      sourcePath: ".coder-studio/canvases/token-consumption.csc",
      title: "Token Consumption",
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Token Consumption" })
      ).toBeInTheDocument();
    });

    const scene = container.querySelector(".canvas-overlay-layer__scene");
    expect(scene).toBeTruthy();
    vi.spyOn(scene as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Inspect canvas" }));
    fireEvent.pointerDown(scene as HTMLDivElement, {
      clientX: 120,
      clientY: 52,
      button: 0,
    });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Add a warning note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export PNG" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Save the comment before exporting");
  });

  it("exports the canvas content root as png", async () => {
    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(runtimeFlowPayload);

    let resolveExport!: () => void;
    const exportPromise = new Promise<void>((resolve) => {
      resolveExport = resolve;
    });
    vi.mocked(exportCanvasPng).mockImplementation(({ element }) => {
      expect(element?.querySelector(".canvas-overlay-layer__textarea")).toBeNull();
      expect(document.querySelector(".canvas-content__scene--export")).toBeTruthy();
      return exportPromise;
    });

    renderCanvasSurface();
    await screen.findByText("Runtime Flow");

    const exportButton = screen.getByRole("button", { name: "Export PNG" });
    await waitFor(() => {
      expect(exportButton).toBeEnabled();
    });
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(document.querySelector(".canvas-content__scene--export")).toBeTruthy();
    });

    resolveExport();

    await waitFor(() => {
      expect(exportCanvasPng).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "Runtime Flow.png" })
      );
    });
  });

  it("shows an inline export error when png export fails", async () => {
    vi.mocked(fetchCanvasInspectionData).mockResolvedValue(runtimeFlowPayload);
    vi.mocked(exportCanvasPng).mockRejectedValue(new Error("boom"));

    renderCanvasSurface();
    await screen.findByText("Runtime Flow");

    const exportButton = screen.getByRole("button", { name: "Export PNG" });
    await waitFor(() => {
      expect(exportButton).toBeEnabled();
    });
    fireEvent.click(exportButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to export canvas");
  });
});
