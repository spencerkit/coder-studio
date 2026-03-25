import type { ExecTarget } from "../../state/workbench";
import type { TerminalGridSize } from "../../shared/utils/terminal";
import { invokeRpc } from "./client";

export const createTerminal = (
  workspaceId: string,
  cwd: string,
  target: ExecTarget,
  initialSize?: TerminalGridSize | null,
) =>
  invokeRpc<{ id: number; output: string }>("terminal_create", {
    workspaceId,
    cwd,
    target,
    cols: initialSize?.cols,
    rows: initialSize?.rows,
  });

export const writeTerminal = (workspaceId: string, terminalId: number, input: string) =>
  invokeRpc<void>("terminal_write", { workspaceId, terminalId, input });

export const resizeTerminal = (workspaceId: string, terminalId: number, cols: number, rows: number) =>
  invokeRpc<void>("terminal_resize", { workspaceId, terminalId, cols, rows });

export const closeTerminal = (workspaceId: string, terminalId: number) =>
  invokeRpc<void>("terminal_close", { workspaceId, terminalId });
