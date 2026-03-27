import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller.ts";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller.ts";
import type { ExecTarget } from "../../state/workbench";
import type { TerminalGridSize } from "../../shared/utils/terminal";
import { invokeRpc } from "./client";

export const createTerminal = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  cwd: string,
  target: ExecTarget,
  initialSize?: TerminalGridSize | null,
) =>
  invokeRpc<{ id: number; output: string }>("terminal_create", {
    ...createWorkspaceControllerRpcPayload(workspaceId, controller),
    cwd,
    target,
    cols: initialSize?.cols,
    rows: initialSize?.rows,
  });

export const writeTerminal = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  terminalId: number,
  input: string,
) => invokeRpc<void>(
  "terminal_write",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { terminalId, input }),
);

export const resizeTerminal = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  terminalId: number,
  cols: number,
  rows: number,
) => invokeRpc<void>(
  "terminal_resize",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { terminalId, cols, rows }),
);

export const closeTerminal = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  terminalId: number,
) => invokeRpc<void>(
  "terminal_close",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { terminalId }),
);
