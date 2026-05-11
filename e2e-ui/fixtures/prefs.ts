import type { Page } from "@playwright/test";

export interface OpenPreviewSceneArgs {
  sceneId: string;
  device: "desktop" | "mobile";
  theme: "dark" | "light";
  locale: "zh" | "en";
}

async function seedPreviewPreferences(
  page: Page,
  args: Pick<OpenPreviewSceneArgs, "theme" | "locale">
) {
  await page.goto("/ui-preview.html", {
    waitUntil: "domcontentloaded",
  });

  await page.evaluate(({ theme, locale }) => {
    window.localStorage.setItem("ui.theme", JSON.stringify(theme));
    window.localStorage.setItem("ui.locale", JSON.stringify(locale));
  }, args);
}

export async function openPreviewScene(page: Page, args: OpenPreviewSceneArgs) {
  await seedPreviewPreferences(page, args);

  const params = new URLSearchParams({
    scene: args.sceneId,
    device: args.device,
    theme: args.theme,
    locale: args.locale,
  });

  await page.goto(`/ui-preview.html?${params.toString()}`, {
    waitUntil: "networkidle",
  });
}
