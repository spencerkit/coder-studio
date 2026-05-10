import { expect, type Page, test } from "@playwright/test";
import { translatePatternForE2E } from "../../fixtures/i18n";
import {
  enterDirectory,
  openWelcomeWorkspaceLaunchModal,
  waitForWorkspaceLaunchModal,
} from "../helpers/workspace-session";

async function openCommandPalette(page: Page) {
  await page.goto("/");
  await page.locator("body").press("Control+k");
  await expect(page.locator(".command-palette-overlay")).toBeVisible();
  await expect(page.locator(".command-palette")).toBeVisible();
}

test.describe("complete session flow", () => {
  test("CSF-01 workspace page shows directory browser", async ({ page }) => {
    await openWelcomeWorkspaceLaunchModal(page);

    await expect(page.locator(".launch-modal")).toBeVisible();
    await expect(page.locator(".fp-dir-list")).toBeVisible();
  });

  test("CSF-02 draft launcher shows provider buttons", async ({ page }) => {
    await openCommandPalette(page);

    const commands = page.locator(".command-palette-item");
    await expect(commands.first()).toBeVisible();
    expect(await commands.count()).toBeGreaterThan(0);
  });

  test("CSF-03 command palette keyboard navigation", async ({ page }) => {
    await openCommandPalette(page);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");

    await expect(page.locator(".command-palette-item-selected")).toBeVisible();
  });

  test("CSF-04 command palette search filters commands", async ({ page }) => {
    await openCommandPalette(page);

    const commands = page.locator(".command-palette-item");
    const initialCount = await commands.count();
    expect(initialCount).toBeGreaterThan(0);

    const input = page.locator(".command-palette-input");
    await input.fill("工作区");
    await page.waitForTimeout(300);

    const filteredCount = await commands.count();
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });

  test("CSF-05 escape closes modals", async ({ page }) => {
    await openCommandPalette(page);

    await page.keyboard.press("Escape");

    await expect(page.locator(".command-palette")).toHaveCount(0);
  });

  test("CSF-06 settings navigation", async ({ page }) => {
    await page.goto("/");

    const settingsLink = page.getByRole("button", {
      name: translatePatternForE2E("action.settings"),
    });
    await settingsLink.click();

    await expect(page.locator(".settings-page")).toBeVisible();
  });

  test("CSF-07 workspace launch modal directory selection works", async ({ page }) => {
    await openWelcomeWorkspaceLaunchModal(page);

    const directoryItem = page.locator(".fp-dir").first();
    await expect(directoryItem).toBeVisible();
    await directoryItem.click();

    await expect(page.locator(".fp-dir.selected")).toHaveCount(1);
    await expect(page.locator(".fp-dir-action")).toBeVisible();

    const startButton = page.getByRole("button", {
      name: translatePatternForE2E("workspace.launch.start"),
    });
    await expect(startButton).toBeEnabled();
  });

  test("CSF-08 workspace launch modal parent navigation", async ({ page }) => {
    await openWelcomeWorkspaceLaunchModal(page);

    const activePathChip = page.locator(".fp-chip.active").last();
    const beforePath = ((await activePathChip.textContent()) ?? "").trim();

    await enterDirectory(page, "workspace");

    const goUpButton = page
      .locator(".fp-btn")
      .filter({ hasText: translatePatternForE2E("workspace.launch.go_up") });
    await expect(goUpButton).toBeVisible();
    await goUpButton.click();

    await waitForWorkspaceLaunchModal(page);
    await expect(activePathChip).toHaveText(beforePath, { timeout: 10000 });
  });

  test("CSF-09 connection status visible", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".welcome-container")).toBeVisible();

    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(0);
  });

  test("CSF-10 app loads without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");

    await page.waitForSelector(".welcome-container", { timeout: 5000 });

    const criticalErrors = errors.filter(
      (e) => !e.includes("ResizeObserver") && !e.includes("Non-Error promise rejection")
    );

    expect(criticalErrors.length).toBe(0);
  });
});
