import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { UiCaptureScene, UiCaptureVariant } from "../scenes";
import { resolveCaptureTarget, waitForStableScene } from "./capture";
import { openPreviewScene } from "./prefs";

const OUTPUT_ROOT = path.resolve(process.cwd(), "output");
const SCREENSHOT_ROOT = path.join(OUTPUT_ROOT, "screenshots");

export interface CaptureSceneVariantArgs {
  scene: UiCaptureScene;
  variant: UiCaptureVariant;
}

export function buildScreenshotPath(scene: UiCaptureScene, variant: UiCaptureVariant) {
  return path.join(
    SCREENSHOT_ROOT,
    scene.category,
    scene.id,
    `${variant.device}__${variant.theme}__${variant.locale}.png`
  );
}

export async function ensureParentDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function openSettingsSection(
  page: Page,
  section: NonNullable<UiCaptureScene["settingsSection"]>,
  device: UiCaptureVariant["device"]
) {
  const sectionOrder = {
    general: 0,
    providers: 1,
    appearance: 2,
    shortcuts: 3,
  } as const;

  const index = sectionOrder[section];

  if (device === "mobile") {
    await page.locator(".settings-mobile-item").nth(index).click();
    await page.locator(".settings-content--mobile, .settings-content").first().waitFor();
    return;
  }

  if (section !== "general") {
    await page.locator(".settings-nav-item").nth(index).click();
  }
}

export async function captureSceneVariant(page: Page, args: CaptureSceneVariantArgs) {
  await openPreviewScene(page, {
    sceneId: args.scene.id,
    device: args.variant.device,
    theme: args.variant.theme,
    locale: args.variant.locale,
  });

  await waitForStableScene(page);

  if (args.scene.settingsSection) {
    await openSettingsSection(page, args.scene.settingsSection, args.variant.device);
    await waitForStableScene(page);
  }

  const filePath = buildScreenshotPath(args.scene, args.variant);
  await ensureParentDir(filePath);

  if (args.scene.fullPage) {
    await page.screenshot({
      path: filePath,
      animations: "disabled",
      fullPage: true,
      scale: "device",
    });
    return;
  }

  const target = await resolveCaptureTarget(page, args.scene.targetSelector);
  await target.screenshot({
    path: filePath,
    animations: "disabled",
    scale: "device",
  });
}
