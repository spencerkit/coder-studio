// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchCanvasSnapshotDataMock = vi.fn();
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
  fetchCanvasSnapshotData: (...args: unknown[]) => fetchCanvasSnapshotDataMock(...args),
}));

vi.mock("echarts", () => ({
  init: echartsMock.init,
}));

const { EmbeddedCanvasSnapshotRoute } = await import("./embedded-canvas-snapshot-route");

describe("EmbeddedCanvasSnapshotRoute", () => {
  beforeEach(() => {
    fetchCanvasSnapshotDataMock.mockReset();
    echartsMock.init.mockClear();
    echartsMock.chart.dispose.mockClear();
    echartsMock.chart.resize.mockClear();
    echartsMock.chart.setOption.mockClear();
  });

  it("renders a loading state while the request is in flight", async () => {
    fetchCanvasSnapshotDataMock.mockImplementationOnce(
      () => new Promise(() => undefined) as Promise<unknown>
    );

    render(
      <MemoryRouter initialEntries={["/embedded/canvas-snapshot/snapshot_123"]}>
        <Routes>
          <Route
            path="/embedded/canvas-snapshot/:snapshotId"
            element={<EmbeddedCanvasSnapshotRoute />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Loading canvas...")).toBeInTheDocument();
  });

  it("renders a report snapshot without requiring workspaceId and sourcePath", async () => {
    fetchCanvasSnapshotDataMock.mockResolvedValueOnce({
      snapshotId: "snapshot_123",
      workspaceId: "ws-1",
      title: "Weekly Metrics",
      kind: "report_canvas",
      createdAt: 123456,
      sourceHash: "abc123",
      compiledDocument: {
        kind: "report_canvas",
        title: "Weekly Metrics",
        sections: [
          {
            type: "section",
            title: "Usage",
            blocks: [
              {
                type: "chart",
                kind: "line",
                title: "Token Consumption",
                categories: ["09:00", "10:00", "11:00"],
                series: [{ name: "Prompt", values: [1200, 1800, 900] }],
              },
            ],
          },
        ],
      },
    });

    render(
      <MemoryRouter initialEntries={["/embedded/canvas-snapshot/snapshot_123"]}>
        <Routes>
          <Route
            path="/embedded/canvas-snapshot/:snapshotId"
            element={<EmbeddedCanvasSnapshotRoute />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Weekly Metrics" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("report-canvas-chart-line")).toBeInTheDocument();
    expect(fetchCanvasSnapshotDataMock).toHaveBeenCalledWith("snapshot_123");
  });

  it("renders request errors", async () => {
    fetchCanvasSnapshotDataMock.mockRejectedValueOnce(new Error("canvas_request_failed:404"));

    render(
      <MemoryRouter initialEntries={["/embedded/canvas-snapshot/snapshot_404"]}>
        <Routes>
          <Route
            path="/embedded/canvas-snapshot/:snapshotId"
            element={<EmbeddedCanvasSnapshotRoute />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("canvas_request_failed:404")).toBeInTheDocument();
    });
  });

  it("renders an error when the route is missing a snapshot id", async () => {
    render(
      <MemoryRouter initialEntries={["/embedded/canvas-snapshot"]}>
        <Routes>
          <Route path="/embedded/canvas-snapshot" element={<EmbeddedCanvasSnapshotRoute />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByText("Canvas snapshot route is missing snapshot id.")
    ).toBeInTheDocument();
  });
});
