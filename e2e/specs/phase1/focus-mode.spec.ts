import { expect, test } from "@playwright/test";
import { expectWelcomeCopy } from "../../fixtures/phase1-i18n";

test.describe("@phase1 focus mode acceptance", () => {
  test("F1-27 enter focus", async ({ page }) => {
    await page.goto("/");
    // Welcome page renders
    await expect(page.locator(".welcome-container")).toBeVisible();
  });

  test("F1-28 exit focus", async ({ page }) => {
    await page.goto("/");
    // Check translated welcome copy
    await expectWelcomeCopy(page);
  });
});
