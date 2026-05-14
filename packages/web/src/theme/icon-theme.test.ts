import { describe, expect, it } from "vitest";
import { getIconPresentation, ICON_SEMANTICS } from "./index";

describe("theme icon resolver", () => {
  it("resolves the base semantic set for every built-in theme", () => {
    for (const themeId of [
      "mint-dark",
      "mint-light",
      "graphite-dark",
      "graphite-light",
      "nord-dark",
      "nord-light",
      "hc-dark",
      "hc-light",
    ]) {
      for (const semantic of ICON_SEMANTICS) {
        expect(getIconPresentation(themeId, semantic)).toEqual(
          expect.objectContaining({
            semantic,
            tone: expect.any(String),
            surface: expect.any(String),
            Icon: expect.anything(),
          })
        );
      }
    }
  });

  it("allows themes to vary icon presentation for the same semantic", () => {
    const mintFolder = getIconPresentation("mint-dark", "file.folder.closed");
    const hcFolder = getIconPresentation("hc-dark", "file.folder.closed");

    expect(hcFolder).toEqual(
      expect.objectContaining({
        tone: expect.any(String),
        surface: expect.any(String),
      })
    );
    expect(mintFolder.Icon).not.toBeUndefined();
    expect(hcFolder.Icon).not.toBeUndefined();
    expect(mintFolder.strokeWidth).not.toBe(hcFolder.strokeWidth);
  });
});
