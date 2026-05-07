export { isDirectExecution } from "./direct-execution.js";
export { shouldUseShellForCommand } from "./windows-shim.js";
export type {
  ParsedCmdShim,
  ResolveSpawnArgvDeps,
} from "./windows-shim-resolver.js";
export { parseCmdShim, resolveSpawnArgv } from "./windows-shim-resolver.js";
