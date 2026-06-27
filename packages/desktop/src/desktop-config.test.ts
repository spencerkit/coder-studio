import { describe, expect, it } from "vitest";
import { resolveDesktopLaunchConfig } from "./desktop-config.js";

describe("desktop-config", () => {
  it("prefers persisted CLI settings when they exist", () => {
    expect(
      resolveDesktopLaunchConfig({
        readCliConfig: () => ({
          host: "0.0.0.0",
          port: 43123,
          stateDir: "/tmp/shared-state",
          password: "sekrit",
        }),
        userDataDir: "/Users/test/Library/Application Support/Coder Studio",
      })
    ).toEqual({
      hostOverride: "0.0.0.0",
      portOverride: 43123,
      stateDir: "/tmp/shared-state",
      password: "sekrit",
    });
  });

  it("uses a desktop-owned state directory by default", () => {
    expect(
      resolveDesktopLaunchConfig({
        readCliConfig: () => null,
        userDataDir: "/Users/test/Library/Application Support/Coder Studio",
      })
    ).toEqual({
      stateDir: "/Users/test/Library/Application Support/Coder Studio/state",
    });
  });
});
