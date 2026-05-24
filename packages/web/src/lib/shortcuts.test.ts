// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS, formatShortcut, matchesShortcut, parseShortcut } from "./shortcuts";

describe("shortcuts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
  });

  it("parses Ctrl+Shift+ArrowLeft", () => {
    expect(parseShortcut("Ctrl+Shift+ArrowLeft")).toEqual({
      modifiers: ["Ctrl", "Shift"],
      key: "ArrowLeft",
    });
  });

  it("matches Ctrl+ArrowLeft while rejecting bare arrows", () => {
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", { key: "ArrowLeft", ctrlKey: true }),
        "Ctrl+ArrowLeft"
      )
    ).toBe(true);

    expect(
      matchesShortcut(new KeyboardEvent("keydown", { key: "ArrowLeft" }), "Ctrl+ArrowLeft")
    ).toBe(false);
  });

  it("rejects extra modifiers for narrower bindings while matching exact Ctrl+Shift+ArrowRight", () => {
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, shiftKey: true }),
        "Ctrl+ArrowRight"
      )
    ).toBe(false);

    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true, shiftKey: true }),
        "Ctrl+Shift+ArrowRight"
      )
    ).toBe(true);
  });

  it("formats arrow bindings as Ctrl+⇧+→", () => {
    expect(formatShortcut("Ctrl+Shift+ArrowRight")).toBe("Ctrl+⇧+→");
  });

  it("includes directional defaults for session navigation and workspace switching", () => {
    expect(DEFAULT_SHORTCUTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "session.navigate.left",
          defaultBinding: "Ctrl+ArrowLeft",
        }),
        expect.objectContaining({
          id: "workspace.next",
          defaultBinding: "Ctrl+Shift+ArrowRight",
        }),
      ])
    );
  });
});
