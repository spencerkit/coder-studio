import { describe, expect, it } from "vitest";
import { sanitizeDesktopSidebarView } from "./layout";

describe("workspace layout atoms", () => {
  it("normalizes the hidden extensions sidebar view to explorer", () => {
    expect(sanitizeDesktopSidebarView("extensions")).toBe("explorer");
  });
});
