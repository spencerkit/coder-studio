import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { waitForStableScene } from "../fixtures/capture";
import { openPreviewScene } from "../fixtures/prefs";

const outputDir = path.resolve(process.cwd(), "output/screenshots/custom-skills-review");

async function ensureOutputDir() {
  await fs.mkdir(outputDir, { recursive: true });
}

function shot(name: string) {
  return path.join(outputDir, name);
}

async function captureSkillsSidebar(page: Page, filename: string) {
  const panel = page.locator(".left-panel .workspace-sidebar-panel").first();
  await panel.waitFor({ state: "visible" });
  await panel.screenshot({
    path: shot(filename),
    animations: "disabled",
    scale: "device",
  });
}

async function openSkillsPanel(page: Page) {
  await page.getByRole("button", { name: "Skills" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Custom Skills" })).toBeVisible();
}

async function openCustomSkillsScene(page: Page) {
  await ensureOutputDir();
  await openPreviewScene(page, {
    sceneId: "workspace-custom-skills-review",
    device: "desktop",
    theme: "mint-dark",
    locale: "en",
  });
  await waitForStableScene(page);
  await openSkillsPanel(page);
}

test.describe("custom skills review captures", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop review only");
    testInfo.setTimeout(120_000);
    await openCustomSkillsScene(page);
  });

  test("capture custom skills list", async ({ page }) => {
    await expect(page.getByText("Review Ops Skill")).toBeVisible();
    await expect(page.getByText("Session Audit Helper")).toBeVisible();
    await captureSkillsSidebar(page, "01-list.png");
  });

  test("capture custom skill detail", async ({ page }) => {
    await page.getByText("Review Ops Skill").click();
    await expect(page.getByRole("heading", { level: 2, name: "Review Ops Skill" })).toBeVisible();
    await expect(page.getByText("refs")).toBeVisible();
    await captureSkillsSidebar(page, "02-detail.png");
  });

  test("capture custom skill create state", async ({ page }) => {
    await page.getByRole("button", { name: "New Skill" }).click();
    await page.locator("#custom-skill-name").fill("Launch Check Runner");
    await page.getByRole("button", { name: "Create" }).last().click();
    await expect(
      page.getByRole("heading", { level: 2, name: "Launch Check Runner" })
    ).toBeVisible();
    await expect(
      page.locator(".skills-panel__card-slug").filter({ hasText: "launch-check-runner" })
    ).toBeVisible();
    await captureSkillsSidebar(page, "03-created.png");
  });

  test("capture custom skill edit state", async ({ page }) => {
    await page.getByText("Review Ops Skill").click();
    await expect(page.getByRole("heading", { level: 2, name: "Review Ops Skill" })).toBeVisible();

    const filesSection = page
      .locator(".workspace-sidebar-section")
      .filter({ has: page.getByRole("heading", { level: 3, name: "Files" }) });

    await filesSection.getByRole("button", { name: "New Folder", exact: true }).click();
    await page.locator("#custom-skill-path").fill("refs/checklists");
    await page.getByRole("button", { name: "Create" }).last().click();
    await page.getByRole("button", { name: "refs", exact: true }).click();
    await expect(page.getByText("checklists")).toBeVisible();

    await page.getByRole("button", { name: "action.edit refs" }).click();
    await page.locator("#custom-skill-rename").fill("reference");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("reference")).toBeVisible();
    await captureSkillsSidebar(page, "04-edited.png");
  });
});
