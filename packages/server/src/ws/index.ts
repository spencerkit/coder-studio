/**
 * WebSocket module exports
 */

export {
  clearHostCommandsForTest,
  getHostCommandDefinition,
  getRegisteredHostCommands,
  registerHostCommand,
} from "../host/command-registry.js";
export {
  clearRuntimeCommandsForTest,
  getRegisteredRuntimeCommands,
  getRuntimeCommandDefinition,
  registerRuntimeCommand,
} from "../runtime/command-registry.js";
export { type ClientId, type CloseHandler, type MessageHandler, WsClient } from "./client.js";
export {
  type CommandContext,
  type CommandHandler,
  dispatch,
  executeHostCommand,
  executeRuntimeCommand,
  getRegisteredCommands,
  getRequestAuthContext,
  getSessionTokenRequestAuthContext,
  registerCommand,
} from "./dispatch.js";
export { type Broadcaster, WsHub } from "./hub.js";
