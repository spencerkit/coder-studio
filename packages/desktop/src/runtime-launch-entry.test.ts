import { describe, expect, it } from "vitest";
import * as runtimeLaunchEntry from "../../runtime/src/runtime-launch-entry.js";
import * as desktopRuntimeLaunchEntry from "./runtime-launch-entry.js";

describe("runtime-launch-entry compatibility re-export", () => {
  it("re-exports the runtime launch entry helpers from the runtime package", () => {
    expect(desktopRuntimeLaunchEntry.buildDesktopRuntimeServerConfig).toBe(
      runtimeLaunchEntry.buildDesktopRuntimeServerConfig
    );
    expect(desktopRuntimeLaunchEntry.main).toBe(runtimeLaunchEntry.main);
    expect(desktopRuntimeLaunchEntry.parseDesktopRuntimeEnv).toBe(
      runtimeLaunchEntry.parseDesktopRuntimeEnv
    );
  });
});
