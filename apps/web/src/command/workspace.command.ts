import type {
  ArtifactsDirtyEvent,
  WorkspaceInputErrorEvent,
  WorkspaceRuntimeControllerEvent,
  WorkspaceRuntimeStateEvent,
} from "../types/app";
import { subscribeWsEvent } from "../ws/client";

export const subscribeWorkspaceArtifactsDirty = (handler: (payload: ArtifactsDirtyEvent) => void) =>
  subscribeWsEvent<ArtifactsDirtyEvent>("workspace://artifacts_dirty", handler);

export const subscribeWorkspaceController = (handler: (payload: WorkspaceRuntimeControllerEvent) => void) =>
  subscribeWsEvent<WorkspaceRuntimeControllerEvent>("workspace://controller", handler);

export const subscribeWorkspaceRuntimeState = (handler: (payload: WorkspaceRuntimeStateEvent) => void) =>
  subscribeWsEvent<WorkspaceRuntimeStateEvent>("workspace://runtime_state", handler);

export const subscribeWorkspaceInputError = (handler: (payload: WorkspaceInputErrorEvent) => void) =>
  subscribeWsEvent<WorkspaceInputErrorEvent>("workspace://input_error", handler);
