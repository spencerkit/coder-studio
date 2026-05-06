import { expect, test } from "@playwright/test";

/**
 * Phase 1 Visual Acceptance Tests: Global Design System
 * Validates fundamental design tokens and visual foundations.
 */
test.describe("@phase1 visual acceptance", () => {
  test.describe.configure({ mode: "serial" });

  test("V1-01 color system baseline", async ({ page }) => {
    await page.goto("/");
    // Check CSS variables are loaded
    const bgColor = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg-page").trim()
    );
    expect(bgColor).toBe("#0a1014");
  });

  test("V1-02 spacing grid baseline", async ({ page }) => {
    await page.goto("/");
    // Check spacing tokens
    const sp4 = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--sp-4").trim()
    );
    expect(sp4).toBe("16px");
  });

  test("V1-03 typography baseline", async ({ page }) => {
    await page.goto("/");
    // Check font tokens
    const fontSize = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--text-base").trim()
    );
    expect(fontSize).toBe("13px");
  });
});
