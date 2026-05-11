import type { ReactNode } from "react";
import type { UiPreviewSceneMetadata } from "./scene-metadata";

export type {
  UiPreviewCategory,
  UiPreviewSettingsSection,
  UiPreviewSource,
} from "./scene-metadata";

import type {
  UiPreviewDevice,
  UiPreviewLocale,
  UiPreviewSeed,
  UiPreviewTheme,
} from "./preview-store";
import { createPageScenes } from "./scenes/page-scenes";
import { createShowcaseScenes } from "./scenes/showcase-scenes";

export interface UiPreviewSceneContext {
  theme: UiPreviewTheme;
  locale: UiPreviewLocale;
  device: UiPreviewDevice;
}

export interface UiPreviewSceneDefinition extends UiPreviewSceneMetadata {
  seed: (context: UiPreviewSceneContext) => UiPreviewSeed;
  render: (context: UiPreviewSceneContext) => ReactNode;
  router: (context: UiPreviewSceneContext) => {
    initialEntries: string[];
    path: string;
  };
}

export const UI_PREVIEW_SCENES: UiPreviewSceneDefinition[] = [
  ...createPageScenes(),
  ...createShowcaseScenes(),
];

export function getUiPreviewScene(id: string): UiPreviewSceneDefinition | null {
  return UI_PREVIEW_SCENES.find((scene) => scene.id === id) ?? null;
}
