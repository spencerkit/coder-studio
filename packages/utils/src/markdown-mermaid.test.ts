import { describe, expect, it } from "vitest";

import * as utils from "./index.js";

describe("markdownUsesMermaid", () => {
  it("detects mermaid fenced code blocks and ignores other markdown", () => {
    const markdownUsesMermaid = (utils as Record<string, unknown>).markdownUsesMermaid;

    expect(typeof markdownUsesMermaid).toBe("function");
    if (typeof markdownUsesMermaid !== "function") {
      return;
    }

    expect(markdownUsesMermaid("```mermaid\ngraph TD\nA --> B\n```")).toBe(true);
    expect(markdownUsesMermaid("~~~mermaid\ngraph TD\nA --> B\n~~~")).toBe(true);
    expect(markdownUsesMermaid("```ts\nconst diagram = 'mermaid';\n```")).toBe(false);
    expect(markdownUsesMermaid("# README\n\nNo diagrams here.")).toBe(false);
  });
});
