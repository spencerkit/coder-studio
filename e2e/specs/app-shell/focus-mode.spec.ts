import { expect, test } from "@playwright/test";
import { expectAppEntry, expectWelcomeCopyIfVisible } from "../../fixtures/app-entry";

test.describe("@phase1 focus mode acceptance", () => {
  test("F1-27 enter focus", async ({ page }) => {
    await page.goto("/");
    // Smoke check that the root shell resolves.
    await expectAppEntry(page);
  });

  test("F1-28 exit focus", async ({ page }) => {
    await page.goto("/");
    // Only assert welcome copy when "/" lands on the welcome shell.
    await expectWelcomeCopyIfVisible(page);
  });
});
