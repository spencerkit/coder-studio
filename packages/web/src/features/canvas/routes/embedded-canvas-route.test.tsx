// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddedCanvasRoute } from "./embedded-canvas-route";

const fetchCanvasDataMock = vi.fn();

vi.mock("../api", () => ({
  fetchCanvasData: (...args: unknown[]) => fetchCanvasDataMock(...args),
}));

describe("EmbeddedCanvasRoute", () => {
  beforeEach(() => {
    fetchCanvasDataMock.mockReset();
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
