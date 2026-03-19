import type { ExecTarget } from "../../state/workbench";
import { invokeRpc } from "./client";

export const createTerminal = (workspaceId: string, cwd: string, target: ExecTarget) =>
  invokeRpc<{ id: number; output: string }>("terminal_create", { workspaceId, cwd, target });

export const writeTerminal = (workspaceId: string, terminalId: number, input: string) =>
  invokeRpc<void>("terminal_write", { workspaceId, terminalId, input });

export const resizeTerminal = (workspaceId: string, terminalId: number, cols: number, rows: number) =>
  invokeRpc<void>("terminal_resize", { workspaceId, terminalId, cols, rows });

export const closeTerminal = (workspaceId: string, terminalId: number) =>
  invokeRpc<void>("terminal_close", { workspaceId, terminalId });
