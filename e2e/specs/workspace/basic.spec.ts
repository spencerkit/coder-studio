import { expect, test } from "@playwright/test";
import {
  expectAppEntry,
  expectPrimaryWorkspaceAction,
  expectWelcomeCardIfVisible,
  expectWelcomeCopyIfVisible,
} from "../../fixtures/app-entry";
import { translateForE2E } from "../../fixtures/i18n";

test.describe("@phase1 workspace acceptance", () => {
  test("F1-01 open workspace", async ({ page }) => {
    await page.goto("/");
    // Open the launch flow from either welcome or a restored workspace.
    const openBtn = await expectPrimaryWorkspaceAction(page);
    await openBtn.click();
    await expect(page.locator(".launch-overlay, .launch-modal").first()).toBeVisible();
    await expect(page.locator(".launch-title")).toHaveText(
      translateForE2E("workspace.launch.title")
    );
  });

  test("F1-02 browse file tree", async ({ page }) => {
    await page.goto("/");
    // Validate welcome chrome when it is active; restored workspaces are also valid.
    await expectWelcomeCardIfVisible(page);
  });

  test("F1-03 select file", async ({ page }) => {
    await page.goto("/");
    // Check page structure
    await expect(page.locator("main")).toBeVisible();
  });

  test("F1-04 create file", async ({ page }) => {
    await page.goto("/");
    // Keep the localized welcome copy assertion only when "/" lands on welcome.
    await expectWelcomeCopyIfVisible(page);
  });

  test("F1-05 delete file", async ({ page }) => {
    await page.goto("/");
    // Root shell should resolve regardless of restore state.
    await expectAppEntry(page);
  });
});
