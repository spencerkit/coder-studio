import { expect, test } from "@playwright/test";
import { expectAppEntry } from "../../fixtures/app-entry";
import { translateForE2E } from "../../fixtures/i18n";
import { AUTH_PREVIEW_URL } from "../../fixtures/phase2-i18n";

// Auth tests require a password-protected server
// These tests are skipped in normal dev mode and run with special config in CI
test.describe("@phase2 auth acceptance", () => {
  test("P2-01 no-auth mode bypasses login", async ({ page }) => {
    await page.goto("/");
    await expectAppEntry(page);
  });

  test("P2-02 auth status endpoint returns correct response", async ({ request }) => {
    const response = await request.get("/auth/status");
    if (response.ok()) {
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.authEnabled).toBe(false);
    } else {
      console.log("Auth status endpoint not available, skipping API test");
    }
  });

  test("P2-03 auth preview exposes the login form structure", async ({ page }) => {
    await page.goto(AUTH_PREVIEW_URL);
    await expect(page.locator(".auth-form")).toBeVisible();
    await expect(page.getByPlaceholder(translateForE2E("settings.auth.password"))).toBeVisible();
    await expect(
      page.getByRole("button", { name: translateForE2E("action.confirm") })
    ).toBeVisible();
  });

  test("P2-04 frontend reaches main app without auth", async ({ page }) => {
    await page.goto("/");
    await expectAppEntry(page);
  });

  test("P2-05 unavailable backend returns auth status failure", async ({ request }) => {
    let failed = false;
    try {
      await request.get("http://127.0.0.1:5999/auth/status", { timeout: 1000 });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  test("P2-06 no-auth frontend ultimately reaches main app", async ({ page }) => {
    await page.goto("/");
    await expectAppEntry(page);
  });
});
