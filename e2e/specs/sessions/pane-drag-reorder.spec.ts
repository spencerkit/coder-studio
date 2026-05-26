import { expect, type Locator, type Page, test } from "@playwright/test";
import { translatePatternForE2E } from "../../fixtures/i18n.js";
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

async function resetWorkspaceIsolation(page: Page): Promise<void> {
  await page.goto("/workspace");
  await page.waitForFunction(
    () => {
      const loading = document.querySelector(
        '.app-loading-shell, [data-testid="workspace-resolving-shell"]'
      );
      if (loading) {
        return false;
      }

      return Boolean(
        document.querySelector(
          ".welcome-container, .workspace-page, .agent-draft-launcher, .session-card.agent-pane[data-session-id]"
        )
      );
    },
    { timeout: 20000 }
  );

  const closeWorkspaceButtons = page.getByRole("button", {
    name: translatePatternForE2E("action.close_workspace"),
  });

  while ((await closeWorkspaceButtons.count()) > 0) {
    const countBeforeClose = await closeWorkspaceButtons.count();
    await closeWorkspaceButtons.first().click();
    await expect
      .poll(async () => closeWorkspaceButtons.count(), {
        timeout: 15000,
      })
      .toBeLessThan(countBeforeClose);
  }
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

interface SessionPaneSnapshot {
  paneId: string;
  sessionId: string;
}

async function getSessionPaneSnapshots(page: Page): Promise<SessionPaneSnapshot[]> {
  return page.locator(".session-card.agent-pane[data-session-id]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const paneId = node.getAttribute("data-pane-id");
      const sessionId = node.getAttribute("data-session-id");

      if (!paneId || !sessionId) {
        throw new Error("Session pane is missing drag identity attributes");
      }

      return {
        paneId,
        sessionId,
      };
    })
  );
}

test.describe("session pane desktop drag reorder", () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspaceIsolation(page);
  });

  test("swaps two session panes when dragging onto another pane center", async ({ page }) => {
    await openWorkspace(page);
    await launchClaudeSession(page);
    await waitForSessionReady(page);

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

    const paneSnapshotsBeforeDrag = await getSessionPaneSnapshots(page);
    expect(paneSnapshotsBeforeDrag).toHaveLength(2);

    const sourcePane = getSessionPanes(page).nth(0);
    const targetPane = getSessionPanes(page).nth(1);
    await dragHandleToPaneCenter(
      page,
      sourcePane.getByRole("button", { name: "Drag pane" }),
      targetPane
    );

    await expect
      .poll(async () => getSessionPaneSnapshots(page), {
        timeout: 10000,
      })
      .toEqual([
        {
          paneId: paneSnapshotsBeforeDrag[0]?.paneId ?? "",
          sessionId: paneSnapshotsBeforeDrag[1]?.sessionId ?? "",
        },
        {
          paneId: paneSnapshotsBeforeDrag[1]?.paneId ?? "",
          sessionId: paneSnapshotsBeforeDrag[0]?.sessionId ?? "",
        },
      ]);
  });

  test("moves a session pane into a draft pane on center drop", async ({ page }) => {
    await openWorkspace(page);
    await launchClaudeSession(page);
    await waitForSessionReady(page);

    const sessionPane = getSessionPanes(page).first();
    const sourceSessionId = await sessionPane.getAttribute("data-session-id");
    expect(sourceSessionId).toBeTruthy();
    await splitPaneHorizontally(page, sessionPane);

    const draftPane = getDraftPanes(page).first();
    await expect(draftPane).toBeVisible({ timeout: 15000 });
    const targetDraftPaneId = await draftPane.getAttribute("data-pane-id");
    expect(targetDraftPaneId).toBeTruthy();

    await dragHandleToPaneCenter(
      page,
      sessionPane.getByRole("button", { name: "Drag pane" }),
      draftPane
    );

    await expect(page.locator(".agent-draft-launcher")).toHaveCount(0, { timeout: 10000 });
    await expect(getSessionPanes(page)).toHaveCount(1, { timeout: 10000 });
    await expect(getSessionPanes(page).first()).toHaveAttribute(
      "data-pane-id",
      targetDraftPaneId ?? ""
    );
    await expect(getSessionPanes(page).first()).toHaveAttribute(
      "data-session-id",
      sourceSessionId ?? ""
    );
  });
});
