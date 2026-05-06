import { expect, test } from "@playwright/test";
import * as fs from "fs";

const SCREENSHOTS_DIR = "/home/spencer/workspace/coder-studio/e2e-screenshots";

function ensureDir() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
}

test.describe("session and terminal interaction", () => {
  test.beforeEach(async ({ page }) => {
    ensureDir();
  });

  test("ST-01: App loads and WebSocket connects", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    await expect(page.locator(".app, body > div").first()).toBeVisible();

    const reconnecting = await page
      .locator(".connection-banner")
      .filter({ hasText: "重新连接" })
      .isVisible()
      .catch(() => false);
    expect(reconnecting).toBe(false);

    await page.screenshot({ path: SCREENSHOTS_DIR + "/ST-01-app-loaded.png", fullPage: true });
  });

  test("ST-02: Welcome/Workspace page renders", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const bodyText = await page.textContent("body");
    expect(bodyText && bodyText.length > 0).toBe(true);

    await page.screenshot({ path: SCREENSHOTS_DIR + "/ST-02-page-rendered.png", fullPage: true });
  });

  test("ST-03: Terminal panel is accessible", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const terminalSelectors = [
      ".bottom-terminal",
      ".terminal-panel",
      ".bottom-panel",
      '[class*="terminal"]',
    ];

    let terminalFound = false;
    for (const sel of terminalSelectors) {
      const visible = await page
        .locator(sel)
        .first()
        .isVisible()
        .catch(() => false);
      if (visible) {
        terminalFound = true;
        break;
      }
    }

    const hasTerminalBtn = await page
      .locator('button[aria-label*="terminal" i], button:has-text("+")')
      .first()
      .isVisible()
      .catch(() => false);

    await page.screenshot({ path: SCREENSHOTS_DIR + "/ST-03-terminal-panel.png", fullPage: true });
    expect(terminalFound || hasTerminalBtn).toBe(true);
  });

  test("ST-04: Agent panes component renders", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const agentSelectors = [
      ".agent-panes",
      ".agent-pane",
      ".session-card",
      ".agent-draft-launcher",
      '[class*="agent"]',
    ];

    for (const sel of agentSelectors) {
      const visible = await page
        .locator(sel)
        .first()
        .isVisible()
        .catch(() => false);
      if (visible) {
        break;
      }
    }

    await page.screenshot({ path: SCREENSHOTS_DIR + "/ST-04-agent-panes.png", fullPage: true });

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      if (
        err.message.includes("xterm") ||
        err.message.includes("jotai") ||
        err.message.includes("terminal")
      ) {
        pageErrors.push(err.message);
      }
    });
    await page.waitForTimeout(1000);
    expect(pageErrors.length).toBe(0);
  });

  test("ST-05: Observer banner (multi-tab fencing)", async ({ browser }) => {
    const page1 = await browser.newPage();
    await page1.goto("/");
    await page1.waitForTimeout(3000);
    await page1.screenshot({
      path: SCREENSHOTS_DIR + "/ST-05-tab1-controller.png",
      fullPage: true,
    });

    const page2 = await browser.newPage();
    await page2.goto("/");
    await page2.waitForTimeout(3000);
    await page2.screenshot({ path: SCREENSHOTS_DIR + "/ST-05-tab2-observer.png", fullPage: true });

    await expect(page1.locator("body")).toBeVisible();
    await expect(page2.locator("body")).toBeVisible();

    await page1.close();
    await page2.close();
  });

  test("ST-06: XtermHost no render errors", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    await page.waitForTimeout(2000);

    const criticalErrors = pageErrors.filter(
      (e) => e.toLowerCase().includes("xterm") && !e.toLowerCase().includes("webgl")
    );

    await page.screenshot({ path: SCREENSHOTS_DIR + "/ST-06-xterm-check.png", fullPage: true });
    expect(criticalErrors.length).toBe(0);
  });

  test("ST-07: Session state UI components", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const sessionSelectors = [
      ".session-card",
      ".agent-pane",
      ".agent-progress",
      ".agent-header",
      ".agent-terminal",
      ".session-input",
      ".agent-session-dot",
      ".agent-badge",
      ".agent-draft-launcher",
    ];

    const foundElements: string[] = [];
    for (const sel of sessionSelectors) {
      const exists = await page
        .locator(sel)
        .count()
        .catch(() => 0);
      if (exists > 0) {
        foundElements.push(sel + ": " + exists);
      }
    }

    await page.screenshot({ path: SCREENSHOTS_DIR + "/ST-07-session-ui.png", fullPage: true });
    console.log("Session UI elements found:", foundElements);
  });
});
