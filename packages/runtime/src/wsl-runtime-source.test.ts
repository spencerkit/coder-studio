import { describe, expect, it } from "vitest";

import { buildWslRuntimeSource } from "./wsl-runtime-source.js";

describe("buildWslRuntimeSource", () => {
  it("builds the default WSL runtime entry path", () => {
    expect(
      buildWslRuntimeSource({
        runtimeVersion: "0.5.4",
        packageRoot: "/opt/coder-studio/runtime",
      })
    ).toEqual({
      runtimeVersion: "0.5.4",
      packageRoot: "/opt/coder-studio/runtime",
      entryPath: "/opt/coder-studio/runtime/dist/wsl-runtime-entry.mjs",
    });
  });

  it("throws when the runtime version is empty", () => {
    expect(() =>
      buildWslRuntimeSource({
        runtimeVersion: "   ",
        packageRoot: "/opt/coder-studio/runtime",
      })
    ).toThrow("WSL runtime version is required");
  });

  it("throws when the package root is empty", () => {
    expect(() =>
      buildWslRuntimeSource({
        runtimeVersion: "0.5.4",
        packageRoot: "   ",
      })
    ).toThrow("WSL runtime package root is required");
  });
});
