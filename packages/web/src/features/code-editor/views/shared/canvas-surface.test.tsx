// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { fetchCanvasData } from "../../../canvas/api";
import { CanvasSurface } from "./canvas-surface";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    const dictionary: Record<string, string> = {
      "code_editor.preview_unavailable": "Preview unavailable",
      "code_editor.canvas_zoom_controls": "Canvas zoom controls",
      "code_editor.canvas_zoom_reset": "Reset zoom",
      "code_editor.image_zoom_out": "Zoom out",
      "code_editor.image_zoom_in": "Zoom in",
      "code_editor.image_zoom_level": "Zoom level",
    };
    return dictionary[key] ?? key;
  },
}));

vi.mock("../../../canvas/api", () => ({
  fetchCanvasData: vi.fn(),
}));

const runtimeFlowPayload = {
  workspaceId: "ws-1",
  sourcePath: ".coder-studio/canvases/runtime-flow.csc",
  title: "Runtime Flow",
  kind: "architecture_canvas" as const,
  renderStatus: "ready" as const,
  lastError: null,
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

function renderCanvasSurface() {
  const store = createStore();

  const view = render(
    <Provider store={store}>
      <CanvasSurface
        workspaceId="ws-1"
        tab={{
          kind: "canvas",
          id: "canvas:.coder-studio/canvases/runtime-flow.csc",
          title: "Runtime Flow",
          sourcePath: ".coder-studio/canvases/runtime-flow.csc",
        }}
      />
    </Provider>
  );

  return { store, ...view };
}

describe("CanvasSurface", () => {
  it("renders canvas inline with zoom controls", async () => {
    const fetchCanvasDataMock = vi.mocked(fetchCanvasData);
    fetchCanvasDataMock.mockResolvedValue(runtimeFlowPayload);

    const { container } = renderCanvasSurface();

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector(".canvas-surface__viewport")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Canvas zoom controls" })).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchCanvasDataMock).toHaveBeenCalledWith(
        "ws-1",
        ".coder-studio/canvases/runtime-flow.csc"
      );
    });
    expect(screen.getByRole("heading", { name: "Runtime Flow" })).toBeInTheDocument();
  });

  it("updates zoom level from the zoom buttons and ctrl+wheel", async () => {
    vi.mocked(fetchCanvasData).mockResolvedValue(runtimeFlowPayload);
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
});
