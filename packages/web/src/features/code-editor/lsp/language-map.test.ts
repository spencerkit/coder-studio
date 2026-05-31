import { describe, expect, it } from "vitest";
import { resolveLspServerKind } from "./language-map";

describe("resolveLspServerKind", () => {
  it("prefers the vue server kind for vue files even when Monaco reports typescript", () => {
    expect(resolveLspServerKind("src/App.vue", "typescript")).toBe("vue");
  });
});
