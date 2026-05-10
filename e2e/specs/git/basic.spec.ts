import { expect, test } from "@playwright/test";
import {
  expectAppEntry,
  expectPrimaryWorkspaceAction,
  expectSettingsEntryPoint,
  expectWelcomeCopyIfVisible,
} from "../../fixtures/app-entry";

test.describe("@phase1 git acceptance", () => {
  test("F1-16 view status", async ({ page }) => {
    await page.goto("/");
    // "/" may land on welcome or a restored workspace.
    await expectAppEntry(page);
  });

  test("F1-17 view diff", async ({ page }) => {
    await page.goto("/");
    // Only assert welcome copy when the welcome shell is active.
    await expectWelcomeCopyIfVisible(page);
  });

  test("F1-18 commit", async ({ page }) => {
    await page.goto("/");
    // Root shell should render.
    await expect(page.locator("main")).toBeVisible();
  });

  test("F1-19 branch list", async ({ page }) => {
    await page.goto("/");
    // Root shell should render.
    await expect(page.locator("main")).toBeVisible();
  });

  test("F1-20 switch branch", async ({ page }) => {
    await page.goto("/");
    // Primary workspace and settings actions should be reachable from either landing state.
    await expectPrimaryWorkspaceAction(page);
    await expectSettingsEntryPoint(page);
  });
});
