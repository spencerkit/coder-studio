// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { toPngMock } = vi.hoisted(() => ({
  toPngMock: vi.fn(),
}));

vi.mock("html-to-image", () => ({
  toPng: toPngMock,
}));

import { exportCanvasPng } from "./export-canvas-png";

describe("exportCanvasPng", () => {
  const createObjectURL = vi.fn(() => "blob:canvas");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    toPngMock.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal(
      "URL",
      Object.assign(globalThis.URL ?? {}, {
        createObjectURL,
        revokeObjectURL,
      })
    );
  });

  it("downloads a png for the provided element", async () => {
    document.body.innerHTML = `<div data-testid="root">canvas export</div>`;
    const root = document.querySelector("[data-testid='root']") as HTMLElement;
    toPngMock.mockResolvedValue("data:image/png;base64,abc123");

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await exportCanvasPng({
      element: root,
      filename: "runtime-flow.png",
    });

    expect(toPngMock).toHaveBeenCalledWith(root, expect.objectContaining({ pixelRatio: 1 }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("throws when no element is provided", async () => {
    await expect(
      exportCanvasPng({
        element: null,
        filename: "runtime-flow.png",
      })
    ).rejects.toThrow("canvas_export_root_missing");
  });
});
