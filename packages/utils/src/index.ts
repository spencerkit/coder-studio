export { isDirectExecution } from "./direct-execution.js";
export type { HeadlessSpawnCommand } from "./headless-prompt-delivery.js";
export {
  estimateCommandLineLength,
  prepareHeadlessSpawnCommand,
  shouldDeliverPromptViaStdin,
  WINDOWS_COMMAND_LINE_LIMIT,
} from "./headless-prompt-delivery.js";
export { formatTokenMetric } from "./token-metric.js";
export { shouldUseShellForCommand } from "./windows-shim.js";
export type {
  ParsedCmdShim,
  ResolveSpawnArgvDeps,
} from "./windows-shim-resolver.js";
export { parseCmdShim, resolveSpawnArgv } from "./windows-shim-resolver.js";
