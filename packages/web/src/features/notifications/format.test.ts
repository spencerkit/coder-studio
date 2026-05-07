import { describe, expect, it } from "vitest";
import { formatDuration, formatProviderLabel, formatWorkspaceLabel } from "./format";

describe("formatProviderLabel", () => {
  it("maps known providers to canonical names", () => {
    expect(formatProviderLabel("claude")).toBe("Claude");
    expect(formatProviderLabel("codex")).toBe("Codex");
  });

  it("title-cases unknown providers", () => {
    expect(formatProviderLabel("aider")).toBe("Aider");
  });

  it('falls back to "Agent" for empty input', () => {
    expect(formatProviderLabel("")).toBe("Agent");
  });
});

describe("formatWorkspaceLabel", () => {
  it("prefers the explicit name", () => {
    expect(formatWorkspaceLabel({ name: "My Project", path: "/tmp/foo" })).toBe("My Project");
  });

  it("extracts the basename when the explicit name is a full path", () => {
    expect(
      formatWorkspaceLabel({
        name: "/home/spencer/workspace/coder-studio",
        path: "/home/spencer/workspace/coder-studio",
      })
    ).toBe("coder-studio");
  });

  it("falls back to the basename of the path", () => {
    expect(formatWorkspaceLabel({ path: "/home/spencer/workspace/coder-studio" })).toBe(
      "coder-studio"
    );
  });

  it("handles trailing slashes and Windows-style separators", () => {
    expect(formatWorkspaceLabel({ path: "/tmp/foo/" })).toBe("foo");
    expect(formatWorkspaceLabel({ path: "C:\\Users\\me\\proj\\" })).toBe("proj");
  });

  it("returns empty string for missing workspace", () => {
    expect(formatWorkspaceLabel(null)).toBe("");
    expect(formatWorkspaceLabel(undefined)).toBe("");
    expect(formatWorkspaceLabel({})).toBe("");
  });
});

describe("formatDuration", () => {
  it("shows <1s for sub-second durations", () => {
    expect(formatDuration(0)).toBe("<1s");
    expect(formatDuration(400)).toBe("<1s");
    expect(formatDuration(999)).toBe("<1s");
  });

  it("shows seconds under one minute", () => {
    expect(formatDuration(1_000)).toBe("1s");
    expect(formatDuration(59_000)).toBe("59s");
  });

  it("shows minutes (with optional seconds) under one hour", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(59 * 60_000)).toBe("59m");
  });

  it("shows hours and minutes for longer durations", () => {
    expect(formatDuration(60 * 60_000)).toBe("1h 0m");
    expect(formatDuration(3_905_000)).toBe("1h 5m");
  });

  it("returns empty for invalid input", () => {
    expect(formatDuration(NaN)).toBe("");
    expect(formatDuration(-100)).toBe("");
  });
});
