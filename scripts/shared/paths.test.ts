import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGES_DIR, ROOT_DIR } from "./paths.js";

describe("script paths", () => {
  it("resolves the repository root from scripts/shared", () => {
    expect(existsSync(`${ROOT_DIR}/package.json`)).toBe(true);
    expect(existsSync(PACKAGES_DIR)).toBe(true);
  });
});
