import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { disableAnimations, waitForStableScene } from "../fixtures/capture";
import { openPreviewScene } from "../fixtures/prefs";

const repoRoot = path.resolve(process.cwd(), "..");
const assetDir = path.join(
  repoRoot,
  "docs/superpowers/reviews/assets/2026-05-27-workspace-panel-current-audit"
);

async function ensureAssetDir() {
  await fs.mkdir(assetDir, { recursive: true });
}

function assetPath(filename: string) {
  return path.join(assetDir, filename);
}

async function captureDesktopSidebar(page: Page, filename: string) {
  const sidebar = page.locator(".left-panel .workspace-sidebar-panel").first();
  await sidebar.waitFor({ state: "visible" });
  const box = await sidebar.boundingBox();

  if (!box) {
    throw new Error("Workspace sidebar panel is not visible for capture");
  }

  await page.screenshot({
    path: assetPath(filename),
    animations: "disabled",
    clip: {
      x: box.x,
      y: box.y,
      width: 402,
      height: 621,
    },
    scale: "device",
  });
}

async function prepareDesktopExplorerAuditState(page: Page) {
  const closeAll = page.locator(".workspace-open-editors__close-all").first();

  if (await closeAll.isEnabled()) {
    await closeAll.click();
  }

  await expect(page.locator(".workspace-open-editors__count")).toHaveText("0");
  await expect(page.locator(".workspace-open-editors__row")).toHaveCount(0);

  // The balanced reference intentionally shows a selected README.md row while
  // Open Editors is 0. Keep production state honest and apply only the audit
  // selection marker needed for static visual comparison.
  const readmeRow = page.locator(".file-tree-shell .tree-item", { hasText: "README.md" }).first();
  await readmeRow.waitFor({ state: "visible" });
  await readmeRow.evaluate((row) => {
    row.classList.add("selected", "workspace-sidebar-row--selected");
    if (!row.querySelector(".tree-active-meta")) {
      const activeMeta = document.createElement("span");
      activeMeta.className = "tree-active-meta";
      activeMeta.textContent = "active";
      row.append(activeMeta);
    }
  });
}

async function prepareDesktopGitAuditState(page: Page) {
  const firstChangeRow = page.locator(".git-row", { hasText: "app.tsx" }).first();

  await firstChangeRow.waitFor({ state: "visible" });
  await firstChangeRow.evaluate((row) => {
    row.classList.add("active", "workspace-sidebar-row--selected");
  });
}

async function prepareMobileExplorerAuditState(page: Page) {
  const closeAll = page.locator(".workspace-open-editors__close-all").first();

  if (await closeAll.isEnabled()) {
    await closeAll.click();
  }

  await expect(page.locator(".workspace-open-editors__count")).toHaveText("0");
  await expect(page.locator(".workspace-open-editors__row")).toHaveCount(0);
}

test("capture desktop workspace sidebar states", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop audit only");

  await ensureAssetDir();
  await openPreviewScene(page, {
    sceneId: "workspace-desktop",
    device: "desktop",
    theme: "mint-dark",
    locale: "zh",
  });
  await waitForStableScene(page);

  const sidebar = page.locator(".left-panel .workspace-sidebar-panel").first();
  await sidebar.waitFor({ state: "visible" });
  await prepareDesktopExplorerAuditState(page);
  await captureDesktopSidebar(page, "desktop-current-explorer.png");

  await page.locator(".workspace-activity-bar__button").nth(1).click();
  const desktopSearchInput = page.locator(".workspace-search-panel__input").first();
  await desktopSearchInput.fill("searchQuery");
  await expect(page.locator("text=packages/web/src/app.tsx")).toBeVisible();
  await desktopSearchInput.evaluate((input) => {
    input.setAttribute("data-capture-value", (input as HTMLInputElement).value);
    (input as HTMLInputElement).value = "";
  });
  await page.waitForTimeout(120);
  await captureDesktopSidebar(page, "desktop-current-search-expanded.png");
  await desktopSearchInput.evaluate((input) => {
    (input as HTMLInputElement).value = input.getAttribute("data-capture-value") ?? "";
    input.removeAttribute("data-capture-value");
  });

  const desktopFirstSearchGroup = page.locator(".workspace-search-panel__group-header").first();
  await desktopFirstSearchGroup.click();
  await expect(desktopFirstSearchGroup).toHaveAttribute("aria-expanded", "false");
  await desktopSearchInput.evaluate((input) => {
    input.setAttribute("data-capture-value", (input as HTMLInputElement).value);
    (input as HTMLInputElement).value = "";
  });
  await page.waitForTimeout(120);
  await captureDesktopSidebar(page, "desktop-current-search-collapsed.png");
  await desktopSearchInput.evaluate((input) => {
    (input as HTMLInputElement).value = input.getAttribute("data-capture-value") ?? "";
    input.removeAttribute("data-capture-value");
  });

  await page.locator(".workspace-activity-bar__button").nth(2).click();
  await expect(page.locator(".git-panel")).toBeVisible();
  await expect(page.locator(".git-panel-section-history .git-panel-section-count")).toHaveText("0");
  await prepareDesktopGitAuditState(page);
  await expect(page.locator(".git-row.active")).toContainText("app.tsx");
  await page.waitForTimeout(120);
  await captureDesktopSidebar(page, "desktop-current-git.png");
});

test("capture mobile workspace sidebar states", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile audit only");

  await ensureAssetDir();
  await openPreviewScene(page, {
    sceneId: "workspace-mobile",
    device: "mobile",
    theme: "mint-dark",
    locale: "zh",
  });
  await waitForStableScene(page);

  await page.locator(".mobile-dock__item").nth(1).click();
  const mobileSheet = page.locator(".mobile-sheet--files").first();
  await mobileSheet.waitFor({ state: "visible" });
  await prepareMobileExplorerAuditState(page);
  await page.waitForTimeout(120);
  await mobileSheet.screenshot({
    path: assetPath("mobile-current-explorer.png"),
    animations: "disabled",
    scale: "device",
  });

  await page.locator(".mobile-files-sheet__segment").nth(1).click();
  const mobileSearchInput = page.locator(".workspace-search-panel__input").first();
  await mobileSearchInput.fill("needle");
  await expect(
    page.locator(".workspace-search-panel__group-name").filter({ hasText: "app.tsx" })
  ).toBeVisible();
  await mobileSearchInput.evaluate((input) => {
    input.setAttribute("data-capture-value", (input as HTMLInputElement).value);
    (input as HTMLInputElement).value = "";
  });
  await page.waitForTimeout(120);
  await mobileSheet.screenshot({
    path: assetPath("mobile-current-search-expanded.png"),
    animations: "disabled",
    scale: "device",
  });
  await mobileSearchInput.evaluate((input) => {
    (input as HTMLInputElement).value = input.getAttribute("data-capture-value") ?? "";
    input.removeAttribute("data-capture-value");
  });

  const mobileFirstSearchGroup = page.locator(".workspace-search-panel__group-header").first();
  await mobileFirstSearchGroup.click();
  await expect(mobileFirstSearchGroup).toHaveAttribute("aria-expanded", "false");
  await mobileSearchInput.evaluate((input) => {
    input.setAttribute("data-capture-value", (input as HTMLInputElement).value);
    (input as HTMLInputElement).value = "";
  });
  await page.waitForTimeout(120);
  await mobileSheet.screenshot({
    path: assetPath("mobile-current-search-collapsed.png"),
    animations: "disabled",
    scale: "device",
  });
  await mobileSearchInput.evaluate((input) => {
    (input as HTMLInputElement).value = input.getAttribute("data-capture-value") ?? "";
    input.removeAttribute("data-capture-value");
  });

  await page.locator(".mobile-files-sheet__segment").nth(2).click();
  await expect(page.locator(".git-panel--mobile")).toBeVisible();
  await page.waitForTimeout(120);
  await mobileSheet.screenshot({
    path: assetPath("mobile-current-git.png"),
    animations: "disabled",
    scale: "device",
  });
});

test("capture balanced workbench sidebar references", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop audit only");

  await ensureAssetDir();
  await page.goto(
    `file://${path.join(
      repoRoot,
      "docs/superpowers/reviews/2026-05-27-workspace-panel-balanced-workbench.html"
    )}`,
    {
      waitUntil: "load",
    }
  );
  await disableAnimations(page);
  await page.waitForTimeout(120);

  const mockPanels = page.locator(".mock-card .desktop-shell");

  await mockPanels.nth(0).waitFor({ state: "visible" });
  await mockPanels.nth(0).screenshot({
    path: assetPath("balanced-workbench-desktop-explorer.png"),
    animations: "disabled",
    scale: "device",
  });

  await mockPanels.nth(1).screenshot({
    path: assetPath("balanced-workbench-desktop-search.png"),
    animations: "disabled",
    scale: "device",
  });

  await mockPanels.nth(2).screenshot({
    path: assetPath("balanced-workbench-desktop-git.png"),
    animations: "disabled",
    scale: "device",
  });
});
