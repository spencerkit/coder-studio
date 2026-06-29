import { describe, expect, it } from "vitest";
import { parseRuntimeManifest } from "./runtime-manifest.js";

describe("runtime-manifest", () => {
  it("accepts a valid runtime bundle manifest", () => {
    expect(
      parseRuntimeManifest({
        schemaVersion: 1,
        version: "0.5.4",
        entry: "dist/esm/runtime-launch-entry.mjs",
        webRoot: "dist/web",
      })
    ).toEqual({
      schemaVersion: 1,
      version: "0.5.4",
      entry: "dist/esm/runtime-launch-entry.mjs",
      webRoot: "dist/web",
    });
  });

  it("rejects unsafe bundle-relative paths", () => {
    expect(() =>
      parseRuntimeManifest({
        schemaVersion: 1,
        version: "0.5.4",
        entry: "../outside.mjs",
        webRoot: "dist/web",
      })
    ).toThrow(/entry/i);

    expect(() =>
      parseRuntimeManifest({
        schemaVersion: 1,
        version: "0.5.4",
        entry: "dist/esm/runtime-launch-entry.mjs",
        webRoot: "/absolute/web",
      })
    ).toThrow(/webRoot/i);
  });
});
