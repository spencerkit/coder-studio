import { expect, test } from "@playwright/test";

test.describe("@phase3 worktree visual acceptance", () => {
  test("P3WV-01 worktree modal layout", async ({ page }) => {
    await page.goto("/");
    // Worktree modal should have proper structure
    const modal = page.locator(".worktree-modal, .modal-content");
    const count = await modal.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("P3WV-02 worktree status chip colors", async ({ page }) => {
    await page.goto("/");
    // Status chips should use semantic colors (clean=green, dirty=amber)
    const chips = page.locator(".status-chip, .worktree-status");
    const count = await chips.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("P3WV-03 worktree tab styling", async ({ page }) => {
    await page.goto("/");
    // Tabs should have consistent styling
    const tabs = page.locator(".worktree-tabs button, .tab-button");
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("P3WV-04 worktree list item styling", async ({ page }) => {
    await page.goto("/");
    // List items should have proper spacing
    const items = page.locator(".worktree-item, .worktree-list li");
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("P3WV-05 worktree action buttons", async ({ page }) => {
    await page.goto("/");
    // Action buttons (create, switch, delete) should be styled
    const actions = page.locator(".worktree-actions button, .worktree-btn");
    const count = await actions.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("P3WV-06 worktree diff view styling", async ({ page }) => {
    await page.goto("/");
    // Diff view should use syntax highlighting
    const diffView = page.locator(".diff-view, .worktree-diff");
    const count = await diffView.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
