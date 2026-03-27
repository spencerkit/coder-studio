import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller.ts";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller.ts";
import type { FilePreview } from "../../state/workbench";
import { invokeRpc } from "./client";

export const previewFile = (path: string) => invokeRpc<FilePreview>("file_preview", { path });
export const saveFile = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  path: string,
  content: string,
) => invokeRpc<FilePreview>(
  "file_save",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { path, content }),
);
