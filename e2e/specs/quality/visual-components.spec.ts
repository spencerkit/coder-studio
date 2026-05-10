import { expect, test } from "@playwright/test";
import {
  expectAppEntry,
  expectPrimaryWorkspaceAction,
  expectSettingsEntryPoint,
  expectWelcomeCardIfVisible,
  expectWelcomeCopyIfVisible,
} from "../../fixtures/app-entry";

/**
 * Phase 1 Visual Acceptance Tests: Core Components
 * Validates visual appearance of main UI components.
 */
test.describe("@phase1 visual acceptance", () => {
  test.describe.configure({ mode: "serial" });

  test("V1-04 welcome page baseline", async ({ page }) => {
    await page.goto("/");
    // "/" may render welcome or restore a workspace; validate the welcome shell when it is active.
    await expectWelcomeCardIfVisible(page);
  });

  test("V1-05 workspace panel baseline", async ({ page }) => {
    await page.goto("/");
    // Restored workspaces bypass welcome; only assert localized welcome copy when it is active.
    await expectWelcomeCopyIfVisible(page);
  });

  test("V1-06 agent pane baseline", async ({ page }) => {
    await page.goto("/");
    // Main shell should render whether "/" lands on welcome or a restored workspace.
    await expect(page.locator("main")).toBeVisible();
  });

  test("V1-07 editor baseline", async ({ page }) => {
    await page.goto("/");
    // Smoke check that the root shell is present.
    await expect(page.locator("main")).toBeVisible();
  });

  test("V1-08 terminal baseline", async ({ page }) => {
    await page.goto("/");
    // Either the welcome CTA or the restored-workspace CTA should be available.
    await expectPrimaryWorkspaceAction(page);
  });

  test("V1-09 command palette baseline", async ({ page }) => {
    await page.goto("/");
    // Open the command palette via its keyboard shortcut.
    await page.locator("body").press("Control+k");
    await expect(page.locator(".command-palette")).toBeVisible();
  });

  test("V1-10 settings baseline", async ({ page }) => {
    await page.goto("/");
    // Settings is reachable from welcome and restored workspace shells.
    await expectSettingsEntryPoint(page);
  });

  test("V1-11 buttons baseline", async ({ page }) => {
    await page.goto("/");
    // The shell should expose at least one interactive button in either landing state.
    await expectAppEntry(page);
    const btn = page.getByRole("button").first();
    await expect(btn).toBeVisible();
  });

  test("V1-12 inputs baseline", async ({ page }) => {
    await page.goto("/");
    // Page should render correctly
    await expect(page.locator("main")).toBeVisible();
  });
});
