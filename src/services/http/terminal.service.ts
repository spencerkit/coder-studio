import type { ExecTarget } from "../../state/workbench";
import { invokeRpc } from "./client";

export const createTerminal = (tabId: string, cwd: string, target: ExecTarget) =>
  invokeRpc<{ id: number; output: string }>("terminal_create", { tabId, cwd, target });

export const writeTerminal = (tabId: string, terminalId: number, input: string) =>
  invokeRpc<void>("terminal_write", { tabId, terminalId, input });

export const resizeTerminal = (tabId: string, terminalId: number, cols: number, rows: number) =>
  invokeRpc<void>("terminal_resize", { tabId, terminalId, cols, rows });

export const closeTerminal = (tabId: string, terminalId: number) =>
  invokeRpc<void>("terminal_close", { tabId, terminalId });
