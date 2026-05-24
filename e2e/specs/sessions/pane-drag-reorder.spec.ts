import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  launchClaudeSession,
  openWorkspace,
  waitForSessionReady,
} from "../helpers/workspace-session";

function getSessionPanes(page: Page): Locator {
  return page.locator(".session-card.agent-pane[data-session-id]");
}

function getDraftPanes(page: Page): Locator {
  return page.locator("[data-pane-id]:has(.agent-draft-launcher)");
}

async function normalizeToSingleSession(page: Page): Promise<void> {
  await openWorkspace(page);

  while ((await getSessionPanes(page).count()) > 1) {
    const sessionPanes = getSessionPanes(page);
    const sessionCountBeforeClose = await sessionPanes.count();
    await sessionPanes
      .nth(sessionCountBeforeClose - 1)
      .getByRole("button", { name: "Close" })
      .click();
    await expect(getSessionPanes(page)).toHaveCount(sessionCountBeforeClose - 1, {
      timeout: 15000,
    });
  }

  while ((await getDraftPanes(page).count()) > 0 && (await getSessionPanes(page).count()) > 0) {
    const draftPanes = getDraftPanes(page);
    const draftCountBeforeClose = await draftPanes.count();
    await draftPanes
      .nth(draftCountBeforeClose - 1)
      .getByRole("button", { name: "Close" })
      .click();
    await expect
      .poll(async () => getDraftPanes(page).count(), {
        timeout: 15000,
      })
      .toBeLessThan(draftCountBeforeClose);
  }

  if ((await getSessionPanes(page).count()) === 0) {
    await launchClaudeSession(page);
  }

  await expect(getSessionPanes(page)).toHaveCount(1, { timeout: 20000 });
  await expect(getDraftPanes(page)).toHaveCount(0, { timeout: 15000 });
  await waitForSessionReady(page);
}

async function splitPaneHorizontally(page: Page, pane: Locator): Promise<void> {
  await pane.getByRole("button", { name: "Split horizontal" }).click();
}

async function launchClaudeSessionInDraft(page: Page, draftPane: Locator): Promise<void> {
  await draftPane.locator(".agent-provider-card-claude").first().click();
}

async function dragHandleToPaneCenter(
  page: Page,
  dragButton: Locator,
  targetPane: Locator
): Promise<void> {
  const handleBox = await dragButton.boundingBox();
  const targetBox = await targetPane.boundingBox();

  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const startX = handleBox!.x + handleBox!.width / 2;
  const startY = handleBox!.y + handleBox!.height / 2;
  const targetX = targetBox!.x + targetBox!.width / 2;
  const targetY = targetBox!.y + targetBox!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 8, { steps: 4 });
  await page.mouse.move(targetX, targetY, { steps: 16 });
  await page.mouse.up();
}

async function getPaneSessionIds(page: Page): Promise<string[]> {
  return page
    .locator(".session-card.agent-pane[data-session-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-session-id") ?? ""));
}

test.describe("session pane desktop drag reorder", () => {
  test("swaps two session panes when dragging onto another pane center", async ({ page }) => {
    await normalizeToSingleSession(page);

    const firstPane = getSessionPanes(page).first();
    await splitPaneHorizontally(page, firstPane);

    const draftPane = getDraftPanes(page).first();
    await expect(draftPane).toBeVisible({ timeout: 15000 });
    await launchClaudeSessionInDraft(page, draftPane);

    await expect(getSessionPanes(page)).toHaveCount(2, { timeout: 20000 });
    await waitForSessionReady(page);
    await expect(getSessionPanes(page).nth(1).locator(".session-state-badge")).toHaveText(
      /^(Running|Idle)$/,
      { timeout: 20000 }
    );

    const sessionIdsBeforeDrag = await getPaneSessionIds(page);
    expect(sessionIdsBeforeDrag).toHaveLength(2);

    const sourcePane = getSessionPanes(page).nth(0);
    const targetPane = getSessionPanes(page).nth(1);
    await dragHandleToPaneCenter(
      page,
      sourcePane.getByRole("button", { name: "Drag pane" }),
      targetPane
    );

    await expect(page.getByText("Swap")).toHaveCount(0);
    await expect
      .poll(async () => getPaneSessionIds(page), {
        timeout: 10000,
      })
      .toEqual([sessionIdsBeforeDrag[1], sessionIdsBeforeDrag[0]]);
  });

  test("moves a session pane into a draft pane on center drop", async ({ page }) => {
    await normalizeToSingleSession(page);

    const sessionPane = getSessionPanes(page).first();
    await splitPaneHorizontally(page, sessionPane);

    const draftPane = getDraftPanes(page).first();
    await expect(draftPane).toBeVisible({ timeout: 15000 });

    await dragHandleToPaneCenter(
      page,
      sessionPane.getByRole("button", { name: "Drag pane" }),
      draftPane
    );

    await expect(page.getByText("Move here")).toHaveCount(0);
    await expect(page.locator(".agent-draft-launcher")).toHaveCount(0, { timeout: 10000 });
    await expect(getSessionPanes(page)).toHaveCount(1, { timeout: 10000 });
  });
});
