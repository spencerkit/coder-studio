import { describe, expect, it } from "vitest";
import { DesktopUpdateCoordinator } from "./desktop-update-coordinator.js";

describe("DesktopUpdateCoordinator integration guards", () => {
  it("rejects a non-Desktop update authority at construction", () => {
    expect(
      () =>
        new DesktopUpdateCoordinator({
          runtimeContext: {
            environment: "cli-global-npm",
            authority: "cli",
            supported: true,
            unsupportedReason: null,
          },
        } as never)
    ).toThrow("Desktop update authority");
  });
});
