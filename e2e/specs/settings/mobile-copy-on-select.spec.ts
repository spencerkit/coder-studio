import { expect, type Locator, type Page, test } from "@playwright/test";
import { translateForE2E, translatePatternForE2E } from "../../fixtures/i18n";
import { openSettingsSection } from "../../fixtures/phase2-i18n";

const MOBILE_VIEWPORT = { width: 430, height: 932 };
const LONG_LINE_TEXT = "MOBILE_COPY_MODE_LONG_LINE_0123456789_".repeat(12);

function directoryRow(page: Page, name: string): Locator {
  return page
    .locator(".fp-dir")
    .filter({
      has: page.locator(".fp-dir-name").filter({ hasText: new RegExp(`^${escapeRegExp(name)}$`) }),
    })
    .first();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openMobileWorkspace(page: Page): Promise<void> {
  await page.goto("/workspace");
  await page.waitForFunction(
    () => {
      const loading = document.querySelector(
        '.app-loading-shell, [data-testid="workspace-resolving-shell"]'
      );
      const shell = document.querySelector('[data-testid="mobile-shell"]');
      const workspaceEntry = Array.from(document.querySelectorAll("button")).some((button) => {
        const label = (button.getAttribute("aria-label") || button.textContent || "").trim();
        return /^(Open Workspace|打开工作区|New workspace|新建工作区)$/.test(label);
      });

      return !loading && (Boolean(shell) || workspaceEntry);
    },
    { timeout: 20000 }
  );

  if (
    await page
      .getByTestId("mobile-shell")
      .isVisible()
      .catch(() => false)
  ) {
    return;
  }

  const openWorkspace = page.getByRole("button", {
    name: translatePatternForE2E("action.open_workspace"),
  });
  const newWorkspace = page.getByRole("button", {
    name: translatePatternForE2E("tooltip.new_workspace"),
  });

  if (
    await openWorkspace
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    try {
      await openWorkspace.first().click();
    } catch (error) {
      if (
        await page
          .getByTestId("mobile-shell")
          .isVisible()
          .catch(() => false)
      ) {
        return;
      }

      if (
        await page
          .locator(".mobile-sheet--launch, .launch-modal")
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        // launch UI is already open
      } else {
        throw error;
      }
    }
  } else if (
    await newWorkspace
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await newWorkspace.first().click();
  } else {
    await page
      .getByRole("button", {
        name: translatePatternForE2E("mobile.topbar.switch_workspace"),
      })
      .click();
    await page
      .getByRole("button", {
        name: translatePatternForE2E("tooltip.new_workspace"),
      })
      .click();
  }

  await expect(page.locator(".mobile-sheet--launch, .launch-modal").first()).toBeVisible({
    timeout: 10000,
  });

  const homeChip = page.locator(".fp-chip").filter({ hasText: "/home/spencer" }).first();
  if (await homeChip.isVisible().catch(() => false)) {
    await homeChip.click();
    await expect(page.locator(".fp-dir-list .directory-loading")).toHaveCount(0);
  }

  await directoryRow(page, "workspace").dblclick();
  await expect(page.locator(".fp-dir-list .directory-loading")).toHaveCount(0);
  await directoryRow(page, "coder-studio").click();

  const startButton = page.getByRole("button", {
    name: translatePatternForE2E("workspace.launch.start"),
  });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  await expect(page).toHaveURL(/\/workspace$/, { timeout: 15000 });
  await expect(page.getByTestId("mobile-shell")).toBeVisible({ timeout: 15000 });
}

async function openMobileTerminalSheet(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: translatePatternForE2E("mobile.dock.open_terminal") })
    .click();
  await expect(page.locator(".mobile-sheet--terminal")).toBeVisible({ timeout: 10000 });
}

async function ensureTerminalExists(page: Page): Promise<void> {
  const xterm = page.locator(".mobile-sheet--terminal .xterm").first();
  if (await xterm.isVisible().catch(() => false)) {
    return;
  }

  await page
    .locator(".mobile-sheet--terminal")
    .getByRole("button", { name: translatePatternForE2E("terminal.new_terminal") })
    .first()
    .click();
  await expect(page.locator(".mobile-sheet--terminal .xterm textarea").first()).toBeVisible({
    timeout: 15000,
  });
}

async function seedLongTerminalLine(page: Page): Promise<void> {
  const terminalInput = page.locator(".mobile-sheet--terminal .xterm textarea").first();
  await expect(terminalInput).toBeVisible({ timeout: 10000 });
  await terminalInput.click();
  await page.keyboard.type(`printf '${LONG_LINE_TEXT}\\n'`);
  await page.keyboard.press("Enter");
  await expect(page.locator(".mobile-sheet--terminal .xterm-rows").first()).toContainText(
    "MOBILE_COPY_MODE_LONG_LINE",
    {
      timeout: 10000,
    }
  );
}

async function longPressTerminalRows(page: Page): Promise<void> {
  const rows = page.locator(".mobile-sheet--terminal .xterm-rows").first();
  const host = page.locator(".mobile-sheet--terminal .xterm-host").first();
  await expect(rows).toBeVisible({ timeout: 10000 });
  await expect(host).toBeVisible({ timeout: 10000 });
  const box = await rows.boundingBox();
  expect(box).toBeTruthy();
  if (!box) {
    throw new Error("xterm rows bounding box missing");
  }

  const x = box.x + Math.min(48, Math.max(16, box.width / 4));
  const y = box.y + Math.min(32, Math.max(12, box.height / 3));

  await host.evaluate(
    (node, { clientX, clientY }) => {
      if (!(node instanceof HTMLElement)) {
        throw new Error("xterm host missing");
      }

      const touches = [{ identifier: 1, clientX, clientY }];
      const buildEvent = (
        type: string,
        activeTouches: typeof touches,
        changedTouches = activeTouches
      ) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", { value: activeTouches });
        Object.defineProperty(event, "targetTouches", { value: activeTouches });
        Object.defineProperty(event, "changedTouches", { value: changedTouches });
        return event;
      };

      node.dispatchEvent(buildEvent("touchstart", touches));
      window.setTimeout(() => {
        node.dispatchEvent(buildEvent("touchend", [], touches));
      }, 650);
    },
    { clientX: x, clientY: y }
  );
}

async function setMobileCopyOnSelect(page: Page, enabled: boolean): Promise<void> {
  await page.goto("/settings");
  await expect(page.locator(".settings-page")).toBeVisible({ timeout: 15000 });
  await openSettingsSection(page, "general");

  const toggle = page.getByRole("switch", {
    name: translatePatternForE2E("settings.copy_on_select"),
  });
  await expect(toggle).toBeVisible({ timeout: 10000 });

  const checked = (await toggle.getAttribute("aria-checked")) === "true";
  if (checked !== enabled) {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", enabled ? "true" : "false");
  }
}

test.describe("mobile copy on select", () => {
  test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("ui.locale", JSON.stringify("en"));
    });
  });

  test("mobile copy mode respects the setting and does not expand page or sheet layout", async ({
    page,
  }) => {
    await setMobileCopyOnSelect(page, true);
    await openMobileWorkspace(page);
    await openMobileTerminalSheet(page);
    await ensureTerminalExists(page);
    await seedLongTerminalLine(page);

    const beforeMetrics = await page.evaluate(() => {
      const sheet = document.querySelector(".mobile-sheet--terminal");
      const terminalSheet = document.querySelector(".mobile-terminal-sheet");
      const body = document.body;
      const doc = document.documentElement;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      return {
        viewportWidth,
        viewportHeight,
        docScrollWidth: doc.scrollWidth,
        docScrollHeight: doc.scrollHeight,
        bodyScrollWidth: body.scrollWidth,
        bodyScrollHeight: body.scrollHeight,
        sheetRect: sheet?.getBoundingClientRect().toJSON() ?? null,
        terminalSheetRect: terminalSheet?.getBoundingClientRect().toJSON() ?? null,
      };
    });

    await longPressTerminalRows(page);

    const copyMode = page.locator(".mobile-terminal-copy-mode");
    await expect(copyMode).toBeVisible({ timeout: 5000 });
    await expect(
      copyMode.getByText(translateForE2E("terminal.copy_mode_title", "en"))
    ).toBeVisible();

    const afterMetrics = await page.evaluate(() => {
      const body = document.body;
      const doc = document.documentElement;
      const overlay = document.querySelector(".mobile-terminal-copy-mode");
      const toolbar = document.querySelector(".mobile-terminal-copy-mode__toolbar");
      const content = document.querySelector(".mobile-terminal-copy-mode__content");
      const text = document.querySelector(".mobile-terminal-copy-mode__text");
      const sheet = document.querySelector(".mobile-sheet--terminal");
      const terminalSheet = document.querySelector(".mobile-terminal-sheet");
      const xtermViewport = document.querySelector(".mobile-sheet--terminal .xterm-viewport");
      const xtermRows = document.querySelector(".mobile-sheet--terminal .xterm-rows");
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const rect = (node: Element | null) => node?.getBoundingClientRect().toJSON() ?? null;

      return {
        viewportWidth,
        viewportHeight,
        docScrollWidth: doc.scrollWidth,
        docScrollHeight: doc.scrollHeight,
        bodyScrollWidth: body.scrollWidth,
        bodyScrollHeight: body.scrollHeight,
        overlayRect: rect(overlay),
        toolbarRect: rect(toolbar),
        contentRect: rect(content),
        textRect: rect(text),
        sheetRect: rect(sheet),
        terminalSheetRect: rect(terminalSheet),
        xtermViewportRect: rect(xtermViewport),
        xtermRowsRect: rect(xtermRows),
        contentClientHeight: content instanceof HTMLElement ? content.clientHeight : null,
        contentScrollHeight: content instanceof HTMLElement ? content.scrollHeight : null,
        textClientHeight: text instanceof HTMLElement ? text.clientHeight : null,
        textScrollHeight: text instanceof HTMLElement ? text.scrollHeight : null,
      };
    });

    expect(afterMetrics.docScrollWidth).toBeLessThanOrEqual(afterMetrics.viewportWidth);
    expect(afterMetrics.bodyScrollWidth).toBeLessThanOrEqual(afterMetrics.viewportWidth);
    expect(afterMetrics.docScrollHeight).toBeLessThanOrEqual(afterMetrics.viewportHeight);
    expect(afterMetrics.bodyScrollHeight).toBeLessThanOrEqual(afterMetrics.viewportHeight);

    expect(afterMetrics.overlayRect?.width ?? 0).toBeLessThanOrEqual(afterMetrics.viewportWidth);
    expect(afterMetrics.overlayRect?.height ?? 0).toBeLessThanOrEqual(afterMetrics.viewportHeight);
    expect(afterMetrics.contentRect?.width ?? 0).toBeLessThanOrEqual(
      (afterMetrics.overlayRect?.width ?? afterMetrics.viewportWidth) + 1
    );
    expect(afterMetrics.sheetRect?.width ?? 0).toBeLessThanOrEqual(afterMetrics.viewportWidth);
    expect(afterMetrics.sheetRect?.height ?? 0).toBeLessThanOrEqual(afterMetrics.viewportHeight);

    expect(
      Math.abs((afterMetrics.sheetRect?.width ?? 0) - (beforeMetrics.sheetRect?.width ?? 0))
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((afterMetrics.sheetRect?.height ?? 0) - (beforeMetrics.sheetRect?.height ?? 0))
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        (afterMetrics.terminalSheetRect?.width ?? 0) - (beforeMetrics.terminalSheetRect?.width ?? 0)
      )
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        (afterMetrics.terminalSheetRect?.height ?? 0) -
          (beforeMetrics.terminalSheetRect?.height ?? 0)
      )
    ).toBeLessThanOrEqual(1);
    expect(
      afterMetrics.contentScrollHeight,
      `copy mode content should not overflow by default:\n${JSON.stringify(afterMetrics, null, 2)}`
    ).toBeLessThanOrEqual((afterMetrics.contentClientHeight ?? 0) + 1);
  });

  test("mobile long press does not enter copy mode when copy on select is disabled", async ({
    page,
  }) => {
    await setMobileCopyOnSelect(page, false);
    await openMobileWorkspace(page);
    await openMobileTerminalSheet(page);
    await ensureTerminalExists(page);
    await seedLongTerminalLine(page);

    await longPressTerminalRows(page);

    await expect(page.locator(".mobile-terminal-copy-mode")).toHaveCount(0);
  });
});
