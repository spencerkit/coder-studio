import { expect, test } from "@playwright/test";
import {
  enableSupervisor,
  launchClaudeSession,
  waitForSessionReady,
} from "../helpers/workspace-session";

test.describe("@phase3 supervisor visual acceptance", () => {
  test("P3SV-01 supervisor card shows objective row, provider pill, and latest evaluation summary", async ({
    page,
  }) => {
    await launchClaudeSession(page);
    await waitForSessionReady(page);
    const supervisorCard = await enableSupervisor(
      page,
      "Render a visible supervisor card",
      "claude"
    );

    await expect(supervisorCard.locator(".supervisor-objective-row")).toBeVisible();
    await expect(supervisorCard.locator(".supervisor-provider-pill")).toBeVisible();

    await page.getByRole("button", { name: "触发评估" }).click();
    await expect(supervisorCard.locator(".supervisor-history-item")).toBeVisible({
      timeout: 20000,
    });
    await expect(supervisorCard.locator(".supervisor-progress-track")).toHaveCount(0);
    await expect(supervisorCard.locator(".supervisor-progress-fill")).toHaveCount(0);
  });
});
