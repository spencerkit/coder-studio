import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPathInsideRoot } from "./path-safety.js";

describe("isPathInsideRoot", () => {
  it("accepts targets that remain inside the root", () => {
    expect(isPathInsideRoot("/workspace", "/workspace/src/app.ts")).toBe(true);
  });

  it("rejects win32-style parent traversal outside the root", () => {
    expect(isPathInsideRoot("C:\\workspace", "C:\\outside\\secret.txt", path.win32)).toBe(false);
  });

  it("accepts paths when the root itself is the filesystem root", () => {
    expect(isPathInsideRoot("/", "/tmp/file.txt")).toBe(true);
  });
});
