import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { isEnvironmentLaunchRequestId } from "./environment-launch.js";
import { createWslEnvironmentTarget, NATIVE_ENVIRONMENT } from "./environment-state.js";
import type { DesktopEnvironmentTarget } from "./protocol.js";

export const ENVIRONMENT_INSTANCE_ROOT_SWITCH = "coder-studio-environment-root";
export const ENVIRONMENT_INSTANCE_TARGET_SWITCH = "coder-studio-environment-target";
export const ENVIRONMENT_INSTANCE_DISTRO_SWITCH = "coder-studio-wsl-distro";
export const ENVIRONMENT_LAUNCH_REQUEST_SWITCH = "coder-studio-environment-launch-request";

export interface CommandLineSwitchReader {
  getSwitchValue(name: string): string;
}

export function getEnvironmentInstanceRoot(
  commandLine: CommandLineSwitchReader,
  fallbackUserDataDir: string
): string {
  const root = commandLine.getSwitchValue(ENVIRONMENT_INSTANCE_ROOT_SWITCH).trim();
  return resolve(root || fallbackUserDataDir);
}

export function readEnvironmentInstanceTarget(
  commandLine: CommandLineSwitchReader
): DesktopEnvironmentTarget {
  const kind = commandLine.getSwitchValue(ENVIRONMENT_INSTANCE_TARGET_SWITCH).trim();
  if (!kind || kind === "native") return NATIVE_ENVIRONMENT;
  if (kind !== "wsl") throw new Error(`Invalid Desktop environment target: ${kind}`);

  const distro = commandLine.getSwitchValue(ENVIRONMENT_INSTANCE_DISTRO_SWITCH).trim();
  if (!distro) throw new Error("A WSL Desktop instance requires a distribution name");
  return createWslEnvironmentTarget(distro);
}

export function readEnvironmentLaunchRequestId(
  commandLine: CommandLineSwitchReader
): string | null {
  const requestId = commandLine.getSwitchValue(ENVIRONMENT_LAUNCH_REQUEST_SWITCH).trim();
  return isEnvironmentLaunchRequestId(requestId) ? requestId : null;
}

export function getEnvironmentInstanceUserDataDir(
  rootUserDataDir: string,
  target: DesktopEnvironmentTarget
): string {
  const root = resolve(rootUserDataDir);
  if (target.kind === "native") return root;
  const id = createHash("sha256").update(target.id).digest("hex").slice(0, 16);
  return resolve(root, "environment-instances", id);
}

export function createEnvironmentInstanceArgs(
  rootUserDataDir: string,
  target: DesktopEnvironmentTarget,
  launchRequestId?: string
): string[] {
  const root = resolve(rootUserDataDir);
  const args = [
    `--user-data-dir=${getEnvironmentInstanceUserDataDir(root, target)}`,
    `--${ENVIRONMENT_INSTANCE_ROOT_SWITCH}=${root}`,
    `--${ENVIRONMENT_INSTANCE_TARGET_SWITCH}=${target.kind}`,
  ];
  if (target.kind === "wsl") {
    if (!target.distro) throw new Error("A WSL Desktop instance requires a distribution name");
    args.push(`--${ENVIRONMENT_INSTANCE_DISTRO_SWITCH}=${target.distro}`);
  }
  if (launchRequestId !== undefined) {
    if (!isEnvironmentLaunchRequestId(launchRequestId)) {
      throw new Error("Invalid environment launch request id");
    }
    args.push(`--${ENVIRONMENT_LAUNCH_REQUEST_SWITCH}=${launchRequestId}`);
  }
  return args;
}
