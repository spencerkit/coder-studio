import { describe, expect, it } from "vitest";
import { renderSnapshotToText } from "../snapshot-render.js";

describe("renderSnapshotToText", () => {
  it("strips ANSI sequences from serialized snapshot", () => {
    const ansi = Buffer.from("hello \x1b[31mworld\x1b[0m\n", "utf8");
    const result = renderSnapshotToText(ansi, { maxLines: 100, maxChars: 1000 });
    expect(result).toBe("hello world");
  });

  it("truncates to last N lines", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const result = renderSnapshotToText(Buffer.from(lines, "utf8"), {
      maxLines: 5,
      maxChars: 10000,
    });

    expect(result.split("\n")).toHaveLength(5);
    expect(result).toContain("line 49");
    expect(result).not.toContain("line 44");
  });

  it("truncates to last N chars", () => {
    const text = "a".repeat(2000);
    const result = renderSnapshotToText(Buffer.from(text, "utf8"), {
      maxLines: 1000,
      maxChars: 500,
    });

    expect(result).toHaveLength(500);
  });

  it("trims trailing whitespace lines", () => {
    const text = "first\nsecond\n\n\n";
    const result = renderSnapshotToText(Buffer.from(text, "utf8"), {
      maxLines: 100,
      maxChars: 1000,
    });

    expect(result).toBe("first\nsecond");
  });
});
