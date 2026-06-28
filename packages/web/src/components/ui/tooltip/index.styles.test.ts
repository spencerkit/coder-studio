// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  `${process.cwd()}/src/components/ui/tooltip/index.module.css`,
  "utf8"
);

describe("Tooltip styles", () => {
  it("wraps longer copy instead of forcing a single-line bubble", () => {
    expect(stylesheet).toContain("white-space: normal;");
    expect(stylesheet).toContain("overflow-wrap: anywhere;");
  });

  it("uses a roomier text layout for longer hover previews", () => {
    expect(stylesheet).toContain("max-width: min(var(--overlay-width-md), calc(100vw - 16px));");
    expect(stylesheet).toContain("line-height: var(--type-body-4-line-height);");
  });
});
