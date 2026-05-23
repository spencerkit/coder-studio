import { describe, expect, it } from "vitest";
import { getUpdateRuntimeInfo } from "./update-runtime.js";

describe("update-runtime", () => {
  it("exposes the package name and restart command contract", () => {
    const runtime = getUpdateRuntimeInfo(import.meta.url);

    expect(runtime.packageName).toBe("@spencer-kit/coder-studio");
    expect(runtime.cliCommand).toBe("coder-studio");
    expect(runtime.restartArgs).toEqual(["serve", "--restart"]);
    expect(runtime.installArgsPrefix).toEqual(["install", "-g"]);
  });
});
