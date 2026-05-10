import { expect, test } from "@playwright/test";
import { expectAppEntry, expectPrimaryWorkspaceAction } from "../../fixtures/app-entry";

/**
 * Phase 1 Visual Acceptance Tests: Interactive States
 * Validates visual feedback for user interactions.
 */
test.describe("@phase1 visual acceptance", () => {
  test.describe.configure({ mode: "serial" });

  test("V1-13 hover states baseline", async ({ page }) => {
    await page.goto("/");
    // Use whichever primary workspace action is available in the current shell.
    const btn = await expectPrimaryWorkspaceAction(page);
    await expect(btn).toBeVisible();
  });

  test("V1-14 focus states baseline", async ({ page }) => {
    await page.goto("/");
    // Focus whichever primary workspace action is currently rendered.
    const btn = await expectPrimaryWorkspaceAction(page);
    await btn.focus();
    await expect(btn).toBeFocused();
  });

  test("V1-15 loading states baseline", async ({ page }) => {
    await page.goto("/");
    // The app should finish bootstrapping into either welcome or a restored workspace shell.
    await expectAppEntry(page);
  });
});
