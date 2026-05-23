// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(`${process.cwd()}/src/components/ui/tag/index.module.css`, "utf8");

describe("Tag styles", () => {
  it("keeps shared tags from shrinking or wrapping inside tight flex rows", () => {
    expect(stylesheet).toContain("flex-shrink: 0;");
    expect(stylesheet).toContain("white-space: nowrap;");
  });
});
