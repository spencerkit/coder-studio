import type { ArtifactsDirtyEvent } from "../types/app";
import { subscribeWsEvent } from "../ws/client";

export const subscribeWorkspaceArtifactsDirty = (handler: (payload: ArtifactsDirtyEvent) => void) =>
  subscribeWsEvent<ArtifactsDirtyEvent>("workspace://artifacts_dirty", handler);
