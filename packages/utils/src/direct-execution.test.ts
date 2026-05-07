import { describe, expect, it } from "vitest";
import { isDirectExecution } from "./direct-execution.js";

describe("isDirectExecution", () => {
  it("matches direct execution for POSIX script paths", () => {
    expect(isDirectExecution("file:///repo/scripts/dev.ts", "/repo/scripts/dev.ts")).toBe(true);
  });

  it("matches direct execution for Windows script paths", () => {
    expect(isDirectExecution("file:///C:/repo/scripts/dev.ts", "C:\\repo\\scripts\\dev.ts")).toBe(
      true
    );
  });

  it("returns false when the current module differs from argv[1]", () => {
    expect(isDirectExecution("file:///repo/scripts/build.ts", "/repo/scripts/dev.ts")).toBe(false);
  });

  it("returns false when argv[1] is undefined", () => {
    expect(isDirectExecution("file:///repo/scripts/dev.ts", undefined)).toBe(false);
  });

  it("returns false when moduleUrl is not a file: URL", () => {
    expect(isDirectExecution("https://example.com/dev.ts", "/repo/scripts/dev.ts")).toBe(false);
  });
});
