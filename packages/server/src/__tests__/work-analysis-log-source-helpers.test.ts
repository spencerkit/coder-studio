import { describe, expect, it } from "vitest";

import {
  buildCursorWorkspaceHash,
  decodeProviderWorkspacePathFromProjectDir,
  encodeProviderWorkspacePath,
  isWithinRange,
  parseOptionalTimestamp,
  resolveHomePath,
  safeJsonParse,
} from "../work-analysis/log-sources/path-encoding.js";

describe("work analysis log source helpers", () => {
  it("encodes absolute workspace paths for provider project directories", () => {
    expect(encodeProviderWorkspacePath("/home/spencer/workspace/coder-studio")).toBe(
      "-home-spencer-workspace-coder-studio"
    );
  });

  it("decodes Cursor project directories back to workspace paths", () => {
    const projectDir = "c-Users-yeshaopeng-workspace-coder-studio";
    expect(decodeProviderWorkspacePathFromProjectDir("-repo-app")).toBe("/repo/app");
    expect(decodeProviderWorkspacePathFromProjectDir("home-w-workspace-lark-docs")).toBe(
      "/home/w/workspace/lark/docs"
    );
    expect(
      decodeProviderWorkspacePathFromProjectDir("home-w-workspace-lark-docs", [
        "/home/w/workspace/lark-docs",
      ])
    ).toBe("/home/w/workspace/lark-docs");
    expect(
      decodeProviderWorkspacePathFromProjectDir(projectDir, [
        "c:\\Users\\yeshaopeng\\workspace\\coder-studio",
      ])
    ).toBe("c:\\Users\\yeshaopeng\\workspace\\coder-studio");
    expect(
      decodeProviderWorkspacePathFromProjectDir(projectDir, [
        "c:/Users/yeshaopeng/workspace/coder-studio",
      ])
    ).toBe("c:/Users/yeshaopeng/workspace/coder-studio");
    expect(decodeProviderWorkspacePathFromProjectDir("empty-window")).toBeUndefined();
    expect(decodeProviderWorkspacePathFromProjectDir("not-a-real-workspace")).toBeUndefined();
  });

  it("builds the Cursor md5 workspace hash from the absolute workspace path", () => {
    expect(buildCursorWorkspaceHash("/home/spencer/workspace/coder-studio")).toBe(
      "cf4c2089ed329fb5e3bba38e6a05f0bc"
    );
  });

  it("parses ISO and numeric timestamps and rejects invalid input", () => {
    expect(parseOptionalTimestamp("2026-06-03T00:00:00.000Z")).toBe(
      Date.parse("2026-06-03T00:00:00.000Z")
    );
    expect(parseOptionalTimestamp(1_770_000_000_000)).toBe(1_770_000_000_000);
    expect(parseOptionalTimestamp("1770000000000")).toBe(1_770_000_000_000);
    expect(parseOptionalTimestamp("   ")).toBeUndefined();
    expect(parseOptionalTimestamp("not-a-date")).toBeUndefined();
  });

  it("parses JSON safely without throwing", () => {
    expect(safeJsonParse<{ ok: boolean }>('{"ok":true}')?.ok).toBe(true);
    expect(safeJsonParse("{bad json")).toBeUndefined();
  });

  it("expands tilde-prefixed home paths", () => {
    expect(resolveHomePath("~/workspace", "/tmp/home")).toBe("/tmp/home/workspace");
    expect(resolveHomePath("~", "/tmp/home")).toBe("/tmp/home");
    expect(resolveHomePath("/tmp/home/workspace", "/ignored")).toBe("/tmp/home/workspace");
  });

  it("treats overlapping sessions as within range", () => {
    expect(
      isWithinRange(100, 200, {
        startAt: 150,
        endAt: 250,
      })
    ).toBe(true);
    expect(
      isWithinRange(100, 120, {
        startAt: 121,
        endAt: 250,
      })
    ).toBe(false);
  });
});
