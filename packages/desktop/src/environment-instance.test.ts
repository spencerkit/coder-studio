import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEnvironmentInstanceArgs,
  ENVIRONMENT_INSTANCE_DISTRO_SWITCH,
  ENVIRONMENT_INSTANCE_ROOT_SWITCH,
  ENVIRONMENT_INSTANCE_TARGET_SWITCH,
  getEnvironmentInstanceRoot,
  getEnvironmentInstanceUserDataDir,
  readEnvironmentInstanceTarget,
} from "./environment-instance.js";
import { createWslEnvironmentTarget, NATIVE_ENVIRONMENT } from "./environment-state.js";

function commandLine(values: Record<string, string>) {
  return {
    getSwitchValue: (name: string) => values[name] ?? "",
  };
}

describe("Desktop environment instances", () => {
  it("keeps the native instance on the root user-data directory", () => {
    const root = resolve("C:/Users/test/AppData/Roaming/Coder Studio");

    expect(getEnvironmentInstanceUserDataDir(root, NATIVE_ENVIRONMENT)).toBe(root);
    expect(createEnvironmentInstanceArgs(root, NATIVE_ENVIRONMENT)).toEqual([
      `--user-data-dir=${root}`,
      `--${ENVIRONMENT_INSTANCE_ROOT_SWITCH}=${root}`,
      `--${ENVIRONMENT_INSTANCE_TARGET_SWITCH}=native`,
    ]);
  });

  it("assigns each WSL distribution a stable isolated user-data directory", () => {
    const root = resolve("C:/Users/test/AppData/Roaming/Coder Studio");
    const ubuntu = createWslEnvironmentTarget("Ubuntu-24.04");
    const debian = createWslEnvironmentTarget("Debian");
    const ubuntuDir = getEnvironmentInstanceUserDataDir(root, ubuntu);

    expect(ubuntuDir).toBe(getEnvironmentInstanceUserDataDir(root, ubuntu));
    expect(ubuntuDir).not.toBe(getEnvironmentInstanceUserDataDir(root, debian));
    expect(ubuntuDir.startsWith(resolve(root, "environment-instances"))).toBe(true);
    expect(createEnvironmentInstanceArgs(root, ubuntu)).toEqual([
      `--user-data-dir=${ubuntuDir}`,
      `--${ENVIRONMENT_INSTANCE_ROOT_SWITCH}=${root}`,
      `--${ENVIRONMENT_INSTANCE_TARGET_SWITCH}=wsl`,
      `--${ENVIRONMENT_INSTANCE_DISTRO_SWITCH}=Ubuntu-24.04`,
    ]);
  });

  it("restores the requested target and canonical root from command-line switches", () => {
    const root = resolve("D:/acceptance/user-data");
    const reader = commandLine({
      [ENVIRONMENT_INSTANCE_ROOT_SWITCH]: root,
      [ENVIRONMENT_INSTANCE_TARGET_SWITCH]: "wsl",
      [ENVIRONMENT_INSTANCE_DISTRO_SWITCH]: "Ubuntu-24.04",
    });

    expect(getEnvironmentInstanceRoot(reader, "ignored")).toBe(root);
    expect(readEnvironmentInstanceTarget(reader)).toEqual(
      createWslEnvironmentTarget("Ubuntu-24.04")
    );
  });

  it("rejects incomplete or unknown environment targets", () => {
    expect(() =>
      readEnvironmentInstanceTarget(commandLine({ [ENVIRONMENT_INSTANCE_TARGET_SWITCH]: "remote" }))
    ).toThrow("Invalid Desktop environment target");
    expect(() =>
      readEnvironmentInstanceTarget(commandLine({ [ENVIRONMENT_INSTANCE_TARGET_SWITCH]: "wsl" }))
    ).toThrow("requires a distribution name");
  });
});
