import { describe, expect, it } from "vitest";
import { getUpdateRuntimeInfo } from "./update-runtime.js";

describe("update-runtime", () => {
  it("exposes the package name and restart command contract", () => {
    const runtime = getUpdateRuntimeInfo(import.meta.url);

    expect(runtime.packageName).toBe("@spencer-kit/coder-studio");
    expect(runtime.cliCommand).toBe("coder-studio");
    expect(runtime.restartArgs).toEqual(["serve", "--restart"]);
    expect(runtime.installArgsPrefix).toEqual(["install", "-g"]);
    expect(runtime).toMatchObject({
      supported: true,
      installKind: "global_npm",
      runtimeContext: {
        environment: "cli-global-npm",
        authority: "cli",
        supported: true,
        unsupportedReason: null,
      },
      registryUrl: "https://registry.npmjs.org/",
      distTag: "latest",
    });
  });

  it("declares source layouts without a bundled worker as read-only", () => {
    const runtime = getUpdateRuntimeInfo(
      new URL("./fixtures/missing-update-entry.ts", import.meta.url).toString()
    );

    expect(runtime).toMatchObject({
      supported: false,
      installKind: "unsupported",
      runtimeContext: {
        environment: "cli-unsupported",
        authority: "none",
        supported: false,
        unsupportedReason: "In-app update worker bundle is not available",
      },
    });
  });
});
