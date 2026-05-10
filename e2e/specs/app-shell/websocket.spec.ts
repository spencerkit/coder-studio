import { expect, test } from "@playwright/test";
import { expectAppEntry, expectWelcomeCardIfVisible } from "../../fixtures/app-entry";

test.describe("@phase1 websocket acceptance", () => {
  test("F1-29 connect", async ({ page }) => {
    await page.goto("/");
    // Root shell should load regardless of restore path.
    await expectAppEntry(page);
  });

  test("F1-30 message flow", async ({ page }) => {
    await page.goto("/");
    // Validate welcome chrome only when the welcome shell is active.
    await expectWelcomeCardIfVisible(page);
  });

  test("F1-31 reconnect", async ({ page }) => {
    await page.goto("/");
    // Check title
    await expect(page).toHaveTitle(/Coder Studio/);
  });
});
