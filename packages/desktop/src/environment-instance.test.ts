import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createEnvironmentInstanceArgs,
  ENVIRONMENT_INSTANCE_DISTRO_SWITCH,
  ENVIRONMENT_INSTANCE_ROOT_SWITCH,
  ENVIRONMENT_INSTANCE_TARGET_SWITCH,
  ENVIRONMENT_LAUNCH_REQUEST_SWITCH,
  getEnvironmentInstanceRoot,
  getEnvironmentInstanceUserDataDir,
  readEnvironmentInstanceTarget,
  readEnvironmentLaunchRequestId,
  waitForEnvironmentInstanceReady,
} from "./environment-instance.js";
import { createWslEnvironmentTarget, NATIVE_ENVIRONMENT } from "./environment-state.js";

function commandLine(values: Record<string, string>) {
  return {
    getSwitchValue: (name: string) => values[name] ?? "",
  };
}

function createEnvironmentChild() {
  const unref = vi.fn(() => undefined);
  const child = new EventEmitter() as EventEmitter & { unref: typeof unref };
  child.unref = unref;
  return child;
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

  it("carries a valid launch request across the environment process boundary", () => {
    const root = resolve("C:/Users/test/AppData/Roaming/Coder Studio");
    const target = createWslEnvironmentTarget("Ubuntu");
    const requestId = "123e4567-e89b-42d3-a456-426614174000";

    expect(createEnvironmentInstanceArgs(root, target, requestId)).toContain(
      `--${ENVIRONMENT_LAUNCH_REQUEST_SWITCH}=${requestId}`
    );
    expect(
      readEnvironmentLaunchRequestId(
        commandLine({ [ENVIRONMENT_LAUNCH_REQUEST_SWITCH]: ` ${requestId} ` })
      )
    ).toBe(requestId);
    expect(
      readEnvironmentLaunchRequestId(commandLine({ [ENVIRONMENT_LAUNCH_REQUEST_SWITCH]: "../bad" }))
    ).toBeNull();
  });

  it("omits absent launch requests and rejects invalid supplied request ids", () => {
    const root = resolve("C:/Users/test/AppData/Roaming/Coder Studio");
    const target = createWslEnvironmentTarget("Ubuntu");

    expect(
      createEnvironmentInstanceArgs(root, target).some((arg) =>
        arg.startsWith(`--${ENVIRONMENT_LAUNCH_REQUEST_SWITCH}=`)
      )
    ).toBe(false);
    expect(() => createEnvironmentInstanceArgs(root, target, "../bad")).toThrow(
      "Invalid environment launch request id"
    );
  });

  it("fails when a spawned environment process exits unsuccessfully before readiness", async () => {
    const child = createEnvironmentChild();
    const readiness = new Promise<void>(() => undefined);
    const waiting = waitForEnvironmentInstanceReady(child, () => readiness);

    child.emit("spawn");
    child.emit("exit", 17, null);

    await expect(waiting).rejects.toThrow(
      "Desktop environment process exited before readiness (code 17)"
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("keeps waiting when a forwarding environment process exits normally", async () => {
    const child = createEnvironmentChild();
    let resolveReady!: () => void;
    const readiness = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    let settled = false;
    const waiting = waitForEnvironmentInstanceReady(child, () => readiness).finally(() => {
      settled = true;
    });

    child.emit("spawn");
    child.emit("exit", 0, null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(settled).toBe(false);
    resolveReady();
    await expect(waiting).resolves.toBeUndefined();
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
