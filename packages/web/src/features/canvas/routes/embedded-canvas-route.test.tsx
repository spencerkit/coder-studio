// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchCanvasDataMock = vi.fn();
const echartsMock = vi.hoisted(() => {
  const chart = {
    dispose: vi.fn(),
    resize: vi.fn(),
    setOption: vi.fn(),
  };

  return {
    chart,
    init: vi.fn(() => chart),
  };
});

vi.mock("../api", () => ({
  fetchCanvasData: (...args: unknown[]) => fetchCanvasDataMock(...args),
}));

vi.mock("echarts", () => ({
  init: echartsMock.init,
}));

const { EmbeddedCanvasRoute } = await import("./embedded-canvas-route");

describe("EmbeddedCanvasRoute", () => {
  beforeEach(() => {
    fetchCanvasDataMock.mockReset();
    echartsMock.init.mockClear();
    echartsMock.chart.dispose.mockClear();
    echartsMock.chart.resize.mockClear();
    echartsMock.chart.setOption.mockClear();
  });

  it("renders a loading state while the request is in flight", async () => {
    fetchCanvasDataMock.mockImplementationOnce(
      () => new Promise(() => undefined) as Promise<unknown>
    );

    render(
      <MemoryRouter
        initialEntries={[
          "/embedded/canvas/ws-1?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc",
        ]}
      >
        <Routes>
          <Route path="/embedded/canvas/:workspaceId" element={<EmbeddedCanvasRoute />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Loading canvas...")).toBeInTheDocument();
  });

  it("renders architecture canvas data", async () => {
    fetchCanvasDataMock.mockResolvedValueOnce({
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      title: "Runtime Flow",
      kind: "architecture_canvas",
      renderStatus: "ready",
      lastError: null,
      compiledDocument: {
        kind: "architecture_canvas",
        title: "Runtime Flow",
        summary: "How requests move.",
        sections: [
          {
            type: "diagram",
            nodes: [{ id: "WebUI", label: "WebUI" }],
            edges: [{ from: "WebUI", to: "Server" }],
          },
          {
            type: "annotations",
            items: [{ title: "Boundary", body: "Server owns execution." }],
          },
        ],
      },
    });

    render(
      <MemoryRouter
        initialEntries={[
          "/embedded/canvas/ws-1?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc",
        ]}
      >
        <Routes>
          <Route path="/embedded/canvas/:workspaceId" element={<EmbeddedCanvasRoute />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Runtime Flow")).toBeInTheDocument();
    expect(screen.getByText("Canvas Renderer")).toBeInTheDocument();
    expect(screen.getByText("WebUI")).toBeInTheDocument();
    expect(screen.getByText("Boundary")).toBeInTheDocument();
    expect(fetchCanvasDataMock).toHaveBeenCalledWith(
      "ws-1",
      ".coder-studio/canvases/runtime-flow.csc"
    );
  });

  it("renders report canvas data", async () => {
    fetchCanvasDataMock.mockResolvedValueOnce({
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/audit.csc",
      title: "Audit",
      kind: "report_canvas",
      renderStatus: "ready",
      lastError: null,
      compiledDocument: {
        kind: "report_canvas",
        title: "Audit",
        sections: [
          {
            type: "stats",
            items: [{ label: "Packages", value: "6", tone: "neutral" }],
          },
          {
            type: "section",
            title: "Key Findings",
            blocks: [{ type: "list", items: ["Server owns rendering."] }],
          },
        ],
      },
    });

    render(
      <MemoryRouter
        initialEntries={["/embedded/canvas/ws-1?sourcePath=.coder-studio%2Fcanvases%2Faudit.csc"]}
      >
        <Routes>
          <Route path="/embedded/canvas/:workspaceId" element={<EmbeddedCanvasRoute />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Key Findings")).toBeInTheDocument();
    expect(screen.getByText("Packages")).toBeInTheDocument();
    expect(screen.getByText("Server owns rendering.")).toBeInTheDocument();
  });

  it("renders report canvas charts", async () => {
    fetchCanvasDataMock.mockResolvedValueOnce({
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/token-consumption.csc",
      title: "Token Consumption",
      kind: "report_canvas",
      renderStatus: "ready",
      lastError: null,
      compiledDocument: {
        kind: "report_canvas",
        title: "Token Consumption",
        sections: [
          {
            type: "section",
            title: "Usage",
            blocks: [
              {
                type: "chart",
                kind: "line",
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
    });

    render(
      <MemoryRouter
        initialEntries={[
          "/embedded/canvas/ws-1?sourcePath=.coder-studio%2Fcanvases%2Ftoken-consumption.csc",
        ]}
      >
        <Routes>
          <Route path="/embedded/canvas/:workspaceId" element={<EmbeddedCanvasRoute />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Token Consumption" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("report-canvas-chart-line")).toBeInTheDocument();
    expect(screen.getByLabelText("Token Consumption line chart")).toBeInTheDocument();
    await waitFor(() => {
      expect(echartsMock.init).toHaveBeenCalledTimes(1);
    });
  });

  it("renders canvas error state when renderStatus is error", async () => {
    fetchCanvasDataMock.mockResolvedValueOnce({
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/broken-canvas.csc",
      title: "Broken Canvas",
      kind: "architecture_canvas",
      renderStatus: "error",
      lastError: {
        category: "compile_error",
        message: "Missing node referenced by edge: Missing",
      },
    });

    render(
      <MemoryRouter
        initialEntries={[
          "/embedded/canvas/ws-1?sourcePath=.coder-studio%2Fcanvases%2Fbroken-canvas.csc",
        ]}
      >
        <Routes>
          <Route path="/embedded/canvas/:workspaceId" element={<EmbeddedCanvasRoute />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Render failed")).toBeInTheDocument();
    expect(screen.getByText("Missing node referenced by edge: Missing")).toBeInTheDocument();
  });

  it("renders request errors", async () => {
    fetchCanvasDataMock.mockRejectedValueOnce(new Error("canvas_request_failed:404"));

    render(
      <MemoryRouter
        initialEntries={[
          "/embedded/canvas/ws-1?sourcePath=.coder-studio%2Fcanvases%2Fmissing-flow.csc",
        ]}
      >
        <Routes>
          <Route path="/embedded/canvas/:workspaceId" element={<EmbeddedCanvasRoute />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("canvas_request_failed:404")).toBeInTheDocument();
    });
  });

  it("renders invalid payload errors", async () => {
    fetchCanvasDataMock.mockRejectedValueOnce(new Error("canvas_response_invalid"));

    render(
      <MemoryRouter
        initialEntries={[
          "/embedded/canvas/ws-1?sourcePath=.coder-studio%2Fcanvases%2Finvalid-flow.csc",
        ]}
      >
        <Routes>
          <Route path="/embedded/canvas/:workspaceId" element={<EmbeddedCanvasRoute />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("canvas_response_invalid")).toBeInTheDocument();
    });
  });

  it("renders a missing-param error when sourcePath is absent", async () => {
    render(
      <MemoryRouter initialEntries={["/embedded/canvas/ws-1"]}>
        <Routes>
          <Route path="/embedded/canvas/:workspaceId" element={<EmbeddedCanvasRoute />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByText("Canvas route is missing workspace or source path.")
    ).toBeInTheDocument();
    expect(fetchCanvasDataMock).not.toHaveBeenCalled();
  });
});
