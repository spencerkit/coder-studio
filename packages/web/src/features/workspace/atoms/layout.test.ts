import { describe, expect, it } from "vitest";
import { sanitizeDesktopSidebarView } from "./layout";

describe("workspace layout atoms", () => {
  it("normalizes an invalid sidebar view to explorer", () => {
    expect(sanitizeDesktopSidebarView("legacy")).toBe("explorer");
  });

  it("accepts the memory sidebar view", () => {
    expect(sanitizeDesktopSidebarView("memory")).toBe("memory");
  });
});
