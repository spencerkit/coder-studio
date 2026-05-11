import { UI_PREVIEW_SCENE_METADATA } from "../../packages/web/src/ui-preview/scene-metadata";

export interface UiCaptureVariant {
  device: "desktop" | "mobile";
  theme: string;
  locale: "zh" | "en";
}

export interface UiCaptureScene {
  id: string;
  title: string;
  category: string;
  source: string;
  description: string;
  targetSelector?: string;
  fullPage: boolean;
  settingsSection?: "general" | "appearance" | "providers" | "shortcuts";
  variants: UiCaptureVariant[];
}

function expandVariants(scene: (typeof UI_PREVIEW_SCENE_METADATA)[number]): UiCaptureVariant[] {
  const variants: UiCaptureVariant[] = [];

  for (const device of scene.devices) {
    for (const theme of scene.themes) {
      for (const locale of scene.locales) {
        variants.push({ device, theme, locale });
      }
    }
  }

  return variants;
}

export const UI_CAPTURE_SCENES: UiCaptureScene[] = UI_PREVIEW_SCENE_METADATA.map((scene) => ({
  id: scene.id,
  title: scene.title,
  category: scene.category,
  source: scene.source,
  description: scene.description,
  targetSelector: scene.capture?.selector,
  fullPage: scene.capture?.fullPage ?? false,
  settingsSection: scene.capture?.settingsSection,
  variants: expandVariants(scene),
}));
