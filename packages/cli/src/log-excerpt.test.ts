import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFileSize, readLogExcerpt } from "./log-excerpt";

describe("log-excerpt", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "cs-log-excerpt-"));
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("returns only the newly appended log lines after the provided offset", () => {
    const logPath = join(testDir, "server.err.log");
    writeFileSync(logPath, "stale line 1\nstale line 2\n");

    const startOffset = getFileSize(logPath);
    writeFileSync(logPath, "fresh line 1\nfresh line 2\n", { flag: "a" });

    expect(readLogExcerpt(logPath, { startOffset })).toBe("fresh line 1\nfresh line 2");
  });

  it("returns the recent tail when the new content exceeds configured limits", () => {
    const logPath = join(testDir, "server.err.log");
    writeFileSync(logPath, "line 1\nline 2\nline 3\nline 4\n");

    expect(
      readLogExcerpt(logPath, {
        startOffset: 0,
        maxBytes: 64,
        maxLines: 2,
        maxChars: 8,
      })
    ).toBe("…\nline 4");
  });

  it("reads the replacement file when the previous offset is beyond the new size", () => {
    const logPath = join(testDir, "server.err.log");
    writeFileSync(logPath, "stale line 1\nstale line 2\n");

    const startOffset = getFileSize(logPath);
    writeFileSync(logPath, "fresh replacement line\n", "utf-8");

    expect(readLogExcerpt(logPath, { startOffset })).toBe("fresh replacement line");
  });

  it("drops a partial leading line when bounded tail reads start mid-line", () => {
    const logPath = join(testDir, "server.err.log");
    writeFileSync(logPath, "very long first line\nsecond line\nthird line\n", "utf-8");

    expect(readLogExcerpt(logPath, { maxBytes: 30, maxChars: null })).toBe(
      "second line\nthird line"
    );
  });
});
