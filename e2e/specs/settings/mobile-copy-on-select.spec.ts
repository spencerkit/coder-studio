import { expect, type Locator, type Page, test } from "@playwright/test";
import { translateForE2E, translatePatternForE2E } from "../../fixtures/i18n";
import { openSettingsSection } from "../../fixtures/phase2-i18n";

const MOBILE_VIEWPORT = { width: 430, height: 932 };
const LONG_LINE_TEXT = "MOBILE_COPY_MODE_LONG_LINE_0123456789_".repeat(12);
const SHORT_LINE_TEXT = "MOBILE_COPY_MODE_SHORT";

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

async function seedShortTerminalLine(page: Page): Promise<void> {
  const terminalInput = page.locator(".mobile-sheet--terminal .xterm textarea").first();
  await expect(terminalInput).toBeVisible({ timeout: 10000 });
  await terminalInput.click();
  await page.keyboard.type(`printf '${SHORT_LINE_TEXT}\\n'`);
  await page.keyboard.press("Enter");
  await expect(page.locator(".mobile-sheet--terminal .xterm-rows").first()).toContainText(
    SHORT_LINE_TEXT,
    {
      timeout: 10000,
    }
  );
}

async function longPressTerminalRows(page: Page, rowIndex = 1): Promise<void> {
  const rows = page.locator(".mobile-sheet--terminal .xterm-rows").first();
  await expect(rows).toBeVisible({ timeout: 10000 });

  const targetRow = rows.locator(":scope > div").nth(rowIndex);
  await expect(targetRow).toBeVisible({ timeout: 10000 });

  const box = await targetRow.boundingBox();
  expect(box).toBeTruthy();
  if (!box) {
    throw new Error("xterm row bounding box missing");
  }

  const x = box.x + Math.min(48, Math.max(16, box.width / 4));
  const y = box.y + Math.min(16, Math.max(8, box.height / 2));

  await targetRow.evaluate(
    (node, { clientX, clientY }) => {
      if (!(node instanceof HTMLElement)) {
        throw new Error("xterm row missing");
      }

      const touches = [{ identifier: 1, clientX, clientY, target: node }];
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

async function findPrintedLineRowIndex(page: Page): Promise<number> {
  const rowTexts = await page
    .locator(".mobile-sheet--terminal .xterm-rows > div")
    .allTextContents();
  return rowTexts.findIndex((text) => text.startsWith("MOBILE_COPY_MODE_LONG_LINE"));
}

async function findShortPrintedLineRowIndex(page: Page): Promise<number> {
  const rowTexts = await page
    .locator(".mobile-sheet--terminal .xterm-rows > div")
    .allTextContents();
  return rowTexts.findIndex((text) => text.startsWith(SHORT_LINE_TEXT));
}

async function longPressTerminalRowBlankRightSide(page: Page, rowIndex: number): Promise<void> {
  const rows = page.locator(".mobile-sheet--terminal .xterm-rows").first();
  await expect(rows).toBeVisible({ timeout: 10000 });

  const targetRow = rows.locator(":scope > div").nth(rowIndex);
  await expect(targetRow).toBeVisible({ timeout: 10000 });

  const box = await targetRow.boundingBox();
  expect(box).toBeTruthy();
  if (!box) {
    throw new Error("xterm row bounding box missing");
  }

  const x = box.x + Math.max(box.width - 12, box.width * 0.85);
  const y = box.y + Math.min(16, Math.max(8, box.height / 2));

  await targetRow.evaluate(
    (node, { clientX, clientY }) => {
      if (!(node instanceof HTMLElement)) {
        throw new Error("xterm row missing");
      }

      const touches = [{ identifier: 1, clientX, clientY, target: node }];
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

      let copiedText = "";
      Object.defineProperty(window, "__mobileCopiedText", {
        configurable: true,
        get() {
          return copiedText;
        },
      });

      if (navigator.clipboard) {
        Object.defineProperty(navigator.clipboard, "writeText", {
          configurable: true,
          value: async (text: string) => {
            copiedText = text;
          },
        });
        return;
      }

      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            copiedText = text;
          },
        },
      });
    });
  });

  test("mobile long press copies the wrapped logical line without opening a copy overlay", async ({
    page,
  }) => {
    await setMobileCopyOnSelect(page, true);
    await openMobileWorkspace(page);
    await openMobileTerminalSheet(page);
    await ensureTerminalExists(page);
    await seedLongTerminalLine(page);

    await expect
      .poll(async () => {
        return page.locator(".mobile-sheet--terminal .xterm-rows > div").count();
      })
      .toBeGreaterThan(1);

    await expect
      .poll(async () => {
        return findPrintedLineRowIndex(page);
      })
      .not.toBe(-1);
    const printedLineRowIndex = await findPrintedLineRowIndex(page);
    await longPressTerminalRows(page, printedLineRowIndex);

    await expect(page.getByText(translateForE2E("terminal.copied_current_line", "en"))).toBeVisible(
      { timeout: 5000 }
    );
    await expect(page.locator(".mobile-terminal-copy-mode")).toHaveCount(0);

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return (window as Window & { __mobileCopiedText?: string }).__mobileCopiedText ?? "";
        });
      })
      .toBe(LONG_LINE_TEXT);
  });

  test("mobile long press does not copy when copy on select is disabled", async ({ page }) => {
    await setMobileCopyOnSelect(page, false);
    await openMobileWorkspace(page);
    await openMobileTerminalSheet(page);
    await ensureTerminalExists(page);
    await seedLongTerminalLine(page);

    await expect
      .poll(async () => {
        return findPrintedLineRowIndex(page);
      })
      .not.toBe(-1);
    const printedLineRowIndex = await findPrintedLineRowIndex(page);
    await longPressTerminalRows(page, printedLineRowIndex);

    await expect(page.locator(".mobile-terminal-copy-mode")).toHaveCount(0);
    await expect(page.getByText(translateForE2E("terminal.copied_current_line", "en"))).toHaveCount(
      0
    );
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return (window as Window & { __mobileCopiedText?: string }).__mobileCopiedText ?? "";
        });
      })
      .toBe("");
  });

  test("mobile long press does not copy when pressing the blank area to the right of a short row", async ({
    page,
  }) => {
    await setMobileCopyOnSelect(page, true);
    await openMobileWorkspace(page);
    await openMobileTerminalSheet(page);
    await ensureTerminalExists(page);
    await seedShortTerminalLine(page);

    await expect
      .poll(async () => {
        return findShortPrintedLineRowIndex(page);
      })
      .not.toBe(-1);
    const printedLineRowIndex = await findShortPrintedLineRowIndex(page);
    await longPressTerminalRowBlankRightSide(page, printedLineRowIndex);

    await expect(page.getByText(translateForE2E("terminal.copied_current_line", "en"))).toHaveCount(
      0
    );
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return (window as Window & { __mobileCopiedText?: string }).__mobileCopiedText ?? "";
        });
      })
      .toBe("");
  });
});
