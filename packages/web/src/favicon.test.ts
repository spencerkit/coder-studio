// @vitest-environment node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readRgbaPixel(filePath: URL, x: number, y: number) {
  const output = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      filePath,
      "-vf",
      `crop=1:1:${x}:${y}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-",
    ],
    {
      encoding: "buffer",
    }
  );

  return [...output];
}

describe("web favicon wiring", () => {
  it("references the root favicon.ico asset from index.html", () => {
    const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(indexHtml).toContain('href="/favicon.ico"');
    expect(indexHtml).not.toContain("/vite.svg");
  });

  it("keeps the exported favicon PNG transparent at the corners", () => {
    const pngPath = new URL("../public/favicon.png", import.meta.url);
    const size = 1024;

    const corners = [
      [0, 0],
      [size - 1, 0],
      [0, size - 1],
      [size - 1, size - 1],
    ] as const;

    for (const [x, y] of corners) {
      expect(readRgbaPixel(pngPath, x, y)).toEqual([0, 0, 0, 0]);
    }
  });
});
