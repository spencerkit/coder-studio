import type { Locator, Page } from "@playwright/test";

export async function disableAnimations(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
}

export async function waitForFonts(page: Page) {
  await page.evaluate(async () => {
    if (!document.fonts?.ready) {
      return;
    }
    await document.fonts.ready;
  });
}

export async function waitForStableScene(page: Page) {
  await disableAnimations(page);
  await waitForFonts(page);
  await page.waitForTimeout(80);
}

export async function resolveCaptureTarget(page: Page, selector?: string): Promise<Locator | Page> {
  if (!selector) {
    return page;
  }

  const target = page.locator(selector).first();
  await target.waitFor({ state: "visible" });
  return target;
}
