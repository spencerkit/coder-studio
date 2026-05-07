// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("web favicon wiring", () => {
  it("references the root favicon.ico asset from index.html", () => {
    const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(indexHtml).toContain('href="/favicon.ico"');
    expect(indexHtml).not.toContain("/vite.svg");
  });
});
