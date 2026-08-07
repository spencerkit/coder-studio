import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAcceptanceRuntimeVersion,
  parsePrepareWslAcceptanceArgs,
  resolveAcceptanceDesktopOutput,
} from "./prepare-wsl-acceptance.js";

describe("prepare-wsl-acceptance", () => {
  it("uses the standard local acceptance defaults", () => {
    expect(parsePrepareWslAcceptanceArgs([])).toEqual({
      distro: undefined,
      installer: false,
      port: 8787,
      runtimeOnly: false,
      runtimeVersion: undefined,
    });
  });

  it("parses an explicit distro, port, and installer request", () => {
    expect(
      parsePrepareWslAcceptanceArgs([
        "--",
        "--distro",
        "Ubuntu-24.04",
        "--port",
        "9876",
        "--installer",
      ])
    ).toEqual({
      distro: "Ubuntu-24.04",
      installer: true,
      port: 9876,
      runtimeOnly: false,
      runtimeVersion: undefined,
    });
  });

  it("parses a Runtime-only update request", () => {
    expect(
      parsePrepareWslAcceptanceArgs([
        "--runtime-only",
        "--runtime-version",
        "0.5.7-acceptance.local",
      ])
    ).toEqual({
      distro: undefined,
      installer: false,
      port: 8787,
      runtimeOnly: true,
      runtimeVersion: "0.5.7-acceptance.local",
    });
  });

  it("requires an explicit version for Runtime-only updates", () => {
    expect(() => parsePrepareWslAcceptanceArgs(["--runtime-only"])).toThrow(
      "--runtime-only requires --runtime-version"
    );
  });

  it("rejects invalid ports", () => {
    expect(() => parsePrepareWslAcceptanceArgs(["--port", "0"])).toThrow(
      "--port must be an integer between 1 and 65535"
    );
  });

  it("creates a commit-specific Product Runtime version", () => {
    expect(
      createAcceptanceRuntimeVersion("0.5.6", "4e80e3cd92c2d7dd46a0b0763d070120db240efa")
    ).toBe("0.5.6-acceptance.4e80e3cd92c2");
  });

  it("keeps Desktop packaging outside a workspace that may be watched by the running App", () => {
    const temporaryRoot = resolve("acceptance-temp");
    expect(resolveAcceptanceDesktopOutput("abc123", temporaryRoot)).toBe(
      resolve(temporaryRoot, "coder-studio-wsl-acceptance", "desktop", "abc123")
    );
  });
});
