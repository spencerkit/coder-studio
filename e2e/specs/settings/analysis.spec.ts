import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { expectSettingsEntryPoint } from "../../fixtures/app-entry";
import { translatePatternForE2E } from "../../fixtures/i18n";

const SPEC_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

test.describe("@phase2 settings analysis acceptance", () => {
  let sandboxDir: string;
  let workspaceDir: string;

  test.beforeEach(() => {
    sandboxDir = mkdtempSync(join(tmpdir(), "coder-studio-analysis-settings-e2e-"));
    workspaceDir = join(sandboxDir, "workspace");
    mkdirSync(workspaceDir, { recursive: true });

    const stateDir = process.env.CODER_STUDIO_PHASE1_STATE_DIR;
    if (!stateDir) {
      throw new Error("CODER_STUDIO_PHASE1_STATE_DIR must be set for settings analysis e2e");
    }

    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", "e2e/fixtures/seed-work-analysis-settings-db.ts", stateDir, workspaceDir],
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
      }
    );

    if (result.status !== 0) {
      throw new Error(`Failed to seed work analysis settings state: ${result.status ?? "unknown"}`);
    }
  });

  test.afterEach(() => {
    rmSync(sandboxDir, { recursive: true, force: true });
  });

  test("P2S-09 analysis settings renders all discovered workspace paths", async ({ page }) => {
    await page.goto("/workspace");
    await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });

    const settingsEntry = await expectSettingsEntryPoint(page);
    await settingsEntry.click();
    await expect(page).toHaveURL(/\/settings$/);

    await page
      .getByRole("button", { name: translatePatternForE2E("settings.analysis.title") })
      .click();

    await expect(page.locator('[data-testid="session-analysis-settings"]')).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      "An error occurred in the <SessionAnalysisSettings> component."
    );
    await expect(
      page.getByText(translatePatternForE2E("settings.analysis.provider_sources"))
    ).toBeVisible();
    await expect(
      page.getByText(
        translatePatternForE2E("settings.analysis.log_coverage_summary", {
          workspaceCount: "3",
          sessionCount: "4",
          providerCount: "1",
        })
      )
    ).toBeVisible();
    await expect(page.getByText(/workspace$/)).toBeVisible();
    await expect(page.getByText(/workspace-b$/)).toBeVisible();
    await expect(page.getByText(/workspace-c$/)).toBeVisible();
    await expect(
      page.getByText(translatePatternForE2E("settings.analysis.empty_workspace"))
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: translatePatternForE2E("settings.analysis.open_analytics") })
      .click();
    await expect(page).toHaveURL(/\/analytics/);
    await expect(page.getByTestId("work-analytics-page")).toBeVisible();
    await expect(
      page.getByRole("tablist", {
        name: translatePatternForE2E("settings.analysis.analytics_sections"),
      })
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: translatePatternForE2E("settings.analysis.tab_overview") })
    ).toHaveAttribute("aria-selected", "true");

    await page.screenshot({
      path: join(SPEC_DIR, "../../test-results/settings-analysis-overview.png"),
      fullPage: true,
    });

    await page
      .getByRole("tab", { name: translatePatternForE2E("settings.analysis.tab_compare") })
      .click();
    await expect(page).toHaveURL(/tab=compare/);
    await expect(
      page.getByText(translatePatternForE2E("settings.analysis.workspace_breakdown"))
    ).toBeVisible();
    await page.screenshot({
      path: join(SPEC_DIR, "../../test-results/settings-analysis-compare.png"),
      fullPage: true,
    });

    await page
      .getByRole("tab", { name: translatePatternForE2E("settings.analysis.tab_yield") })
      .click();
    await expect(page).toHaveURL(/tab=yield/);
    await expect(
      page.getByText(translatePatternForE2E("settings.analysis.top_sessions"))
    ).toBeVisible();
    await page.screenshot({
      path: join(SPEC_DIR, "../../test-results/settings-analysis-yield.png"),
      fullPage: true,
    });
  });
});
