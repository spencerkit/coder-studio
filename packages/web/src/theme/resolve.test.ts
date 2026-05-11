import { describe, expect, it } from "vitest";
import {
  getThemeById,
  getThemeFamily,
  getThemeIdForFamilyVariant,
  getThemeVariant,
  resolveStoredThemeId,
} from "./index";

describe("resolveStoredThemeId", () => {
  it("maps legacy and invalid values to supported ids", () => {
    expect(resolveStoredThemeId("dark")).toBe("mint-dark");
    expect(resolveStoredThemeId("light")).toBe("mint-light");
    expect(resolveStoredThemeId("mint-dark")).toBe("mint-dark");
    expect(resolveStoredThemeId("missing-theme")).toBe("mint-dark");
  });
});

describe("theme resolvers", () => {
  it("returns the theme definition for known ids and falls back for unknown ids", () => {
    expect(getThemeById("mint-light").id).toBe("mint-light");
    expect(getThemeById("missing-theme").id).toBe("mint-dark");
  });

  it("reads the family and variant from a theme id", () => {
    expect(getThemeFamily("graphite-light")).toBe("graphite");
    expect(getThemeVariant("graphite-light")).toBe("light");
  });

  it("finds theme ids by family and variant", () => {
    expect(getThemeIdForFamilyVariant("nord", "dark")).toBe("nord-dark");
    expect(getThemeIdForFamilyVariant("hc", "light")).toBe("hc-light");
  });
});
