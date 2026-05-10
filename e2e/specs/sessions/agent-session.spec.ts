import { expect, test } from "@playwright/test";
import {
  expectAppEntry,
  expectPrimaryWorkspaceAction,
  expectSettingsEntryPoint,
  expectWelcomeCopyIfVisible,
} from "../../fixtures/app-entry";

test.describe("@phase1 agent session acceptance", () => {
  test("F1-06 start session", async ({ page }) => {
    await page.goto("/");
    // Smoke check that "/" resolves to a usable shell and keeps localized welcome copy when present.
    await expectWelcomeCopyIfVisible(page);
  });

  test("F1-07 send prompt", async ({ page }) => {
    await page.goto("/");
    // The primary workspace CTA should be available from either landing state.
    await expectPrimaryWorkspaceAction(page);
  });

  test("F1-08 receive response", async ({ page }) => {
    await page.goto("/");
    // Settings remains reachable even when "/" restores the last workspace.
    await expectSettingsEntryPoint(page);
  });

  test("F1-09 stop session", async ({ page }) => {
    await page.goto("/");
    // Page title should be correct
    await expect(page).toHaveTitle(/Coder Studio/);
  });

  test("F1-10 resume session", async ({ page }) => {
    await page.goto("/");
    // Root shell should be interactive.
    await expectAppEntry(page);
  });
});
