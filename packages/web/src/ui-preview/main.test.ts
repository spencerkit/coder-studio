// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(`${process.cwd()}/src/ui-preview/main.tsx`, "utf8");

describe("ui-preview entry", () => {
  it("loads the React dev preamble so the standalone entry works in vite dev mode", () => {
    expect(source).toContain('import "@vitejs/plugin-react/preamble";');
  });
});
