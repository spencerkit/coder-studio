import { describe, expect, it } from "vitest";
import {
  createDefaultDesktopUpdateSettings,
  createDefaultProductUpdateState,
} from "./product-update";

describe("product update contracts", () => {
  it("creates a read-only state from an explicit runtime context", () => {
    const context = {
      environment: "desktop-managed" as const,
      authority: "desktop" as const,
      supported: true,
      unsupportedReason: null,
    };

    expect(createDefaultProductUpdateState(context, "0.5.0", null)).toMatchObject({
      schemaVersion: 1,
      runtimeContext: context,
      status: "idle",
      productVersion: "0.5.0",
      productPublishedAt: null,
      planId: null,
      components: [],
      restartRequired: false,
    });
  });

  it("uses a six-hour Desktop automatic-check default", () => {
    expect(createDefaultDesktopUpdateSettings()).toEqual({
      schemaVersion: 1,
      autoCheckEnabled: true,
      checkIntervalSec: 21600,
    });
  });
});
