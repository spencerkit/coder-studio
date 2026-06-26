import { join } from "node:path";

export function getRuntimeStateRoot(stateRoot: string, runtimeId: string): string {
  return join(stateRoot, "state", "runtimes", runtimeId);
}

export function getRuntimeStateFile(
  stateRoot: string,
  runtimeId: string,
  ...parts: string[]
): string {
  return join(getRuntimeStateRoot(stateRoot, runtimeId), ...parts);
}
