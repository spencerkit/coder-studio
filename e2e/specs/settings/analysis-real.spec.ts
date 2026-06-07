import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { translatePatternForE2E } from "../../fixtures/i18n";

const SPEC_DIR = fileURLToPath(new URL(".", import.meta.url));

test.describe("settings analysis real logs capture", () => {
  test("captures real basic analysis with discovered workspaces", async ({ page }) => {
    test.setTimeout(180000);

    await page.goto("/analytics");
    await expect(page.getByTestId("work-analytics-page")).toBeVisible({ timeout: 20000 });

    const runBasicButton = page.getByRole("button", {
      name: translatePatternForE2E("settings.analysis.run_basic"),
    });
    await runBasicButton.click();

    await expect(page.getByText(/^(?:基础分析: 已完成|Basic Analysis: Completed)$/)).toBeVisible({
      timeout: 120000,
    });

    await page.screenshot({
      path: join(SPEC_DIR, "../../test-results/settings-analysis-real-overview-full.png"),
      fullPage: true,
    });

    await page
      .getByRole("tab", { name: translatePatternForE2E("settings.analysis.tab_compare") })
      .click();
    await expect(page).toHaveURL(/tab=compare/);
    await page.screenshot({
      path: join(SPEC_DIR, "../../test-results/settings-analysis-real-compare-full.png"),
      fullPage: true,
    });

    await page
      .getByRole("tab", { name: translatePatternForE2E("settings.analysis.tab_yield") })
      .click();
    await expect(page).toHaveURL(/tab=yield/);
    await page.screenshot({
      path: join(SPEC_DIR, "../../test-results/settings-analysis-real-yield-full.png"),
      fullPage: true,
    });
  });
});
