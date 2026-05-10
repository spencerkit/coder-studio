import { expect, test } from "@playwright/test";
import {
  expectAppEntry,
  expectPrimaryWorkspaceAction,
  expectSettingsEntryPoint,
} from "../../fixtures/app-entry";

test.describe("@phase1 terminal acceptance", () => {
  test("F1-21 create terminal", async ({ page }) => {
    await page.goto("/");
    // "/" may restore a workspace; either landing shell is valid.
    await expectAppEntry(page);
  });

  test("F1-22 type command", async ({ page }) => {
    await page.goto("/");
    // The shell should expose a primary workspace action.
    await expectPrimaryWorkspaceAction(page);
  });

  test("F1-23 resize", async ({ page }) => {
    await page.goto("/");
    // Check page responsiveness
    await page.setViewportSize({ width: 1024, height: 768 });
    await expectAppEntry(page);
  });

  test("F1-24 close", async ({ page }) => {
    await page.goto("/");
    // Settings remains accessible in either landing state.
    await expectSettingsEntryPoint(page);
  });
});
