import { expect, test } from "@playwright/test";

test.describe("Session Title Extraction", () => {
  test("TITLE-01: Extract and truncate title from first input", async ({ page }) => {
    // Navigate to app
    await page.goto("/");
    await page.waitForTimeout(3000);

    // Check if on welcome page and open workspace if needed
    const welcomeHeading = page.getByRole("heading", { name: "Welcome to Coder Studio" });
    if (await welcomeHeading.isVisible()) {
      console.log("✓ On welcome page, opening workspace...");
      const openWorkspaceButton = page.getByRole("button", { name: "Open Workspace" });
      await openWorkspaceButton.click();
      await page.waitForTimeout(1000);

      // Select workspace directory
      const workspaceDir = page.locator("text=coder-studio-workspaces").first();
      await workspaceDir.click();
      await page.waitForTimeout(500);

      // Click Start Workspace button
      const startWorkspaceButton = page.getByRole("button", { name: "Start Workspace" });
      await expect(startWorkspaceButton).toBeEnabled({ timeout: 5000 });
      await startWorkspaceButton.click();
      await page.waitForTimeout(3000);
    }

    // Close all existing sessions to ensure we get a fresh draft launcher
    const existingCloseButtons = await page.locator('.session-card [class*="close"]').all();
    console.log(`Found ${existingCloseButtons.length} existing sessions to close`);

    for (const closeButton of existingCloseButtons) {
      try {
        await closeButton.click();
        await page.waitForTimeout(500);
      } catch {
        // Ignore errors if button is not clickable
      }
    }

    // Wait for sessions to be closed
    await page.waitForTimeout(2000);

    // Now should see draft launcher
    const draftLauncher = page.locator(".draft-launcher").first();
    await expect(draftLauncher).toBeVisible({ timeout: 10000 });
    console.log("✓ Draft launcher visible, creating new session...");

    // Click Claude provider to create session
    const claudeButton = draftLauncher.locator(".agent-provider-card-claude");
    await expect(claudeButton).toBeVisible({ timeout: 5000 });
    await claudeButton.click();
    await page.waitForTimeout(5000);

    // Wait for session to transition from draft to active state
    const sessionCard = page.locator(".session-card").first();
    await expect(sessionCard).toBeVisible({ timeout: 10000 });

    const stateBadge = sessionCard.locator(".session-state-badge");
    await expect(stateBadge).not.toHaveText("DRAFT", { timeout: 10000 });
    console.log("✓ Session created, state:", await stateBadge.textContent());

    // Now we have a fresh session - test title extraction
    const titleElement = sessionCard.locator(".session-title");
    const beforeTitle = await titleElement.textContent();
    console.log("Title before input:", beforeTitle);

    // Take screenshot before input
    await page.screenshot({ path: "/tmp/title-test-before.png", fullPage: true });

    // Find terminal area and focus it
    const terminalArea = sessionCard.locator('[class*="terminal"], .xterm').first();
    await expect(terminalArea).toBeVisible({ timeout: 5000 });

    // Click to focus terminal
    await terminalArea.click();
    await page.waitForTimeout(1000);

    // Type test message (longer than 10 chars)
    const testMessage = "hello world this is a test";
    console.log("Typing message:", testMessage);

    await page.keyboard.type(testMessage);
    await page.waitForTimeout(500);

    // Submit by pressing Enter
    await page.keyboard.press("Enter");
    console.log("Message submitted");

    // Wait for processing (title extraction happens on submit)
    await page.waitForTimeout(3000);

    // Take screenshot after input
    await page.screenshot({ path: "/tmp/title-test-after.png", fullPage: true });

    // Check title was extracted and truncated
    const afterTitle = await titleElement.textContent();
    console.log("Title after input:", afterTitle);

    // According to SESSION_TITLE_MAX_LENGTH = 10:
    // "hello world this is a test" → normalized → "hello wor…"
    const expectedTitle = "hello wor…";

    console.log("Expected truncated title:", expectedTitle);
    console.log("Actual title:", afterTitle);

    // Title should be extracted and truncated
    expect(afterTitle).toBeTruthy();
    expect(afterTitle).not.toContain("SESSION-");
    expect(afterTitle).toBe(expectedTitle);
    console.log("✓ Title successfully extracted and truncated");

    // Verify in database via API (optional, if accessible)
    // This would require backend API endpoint to query session state
  });

  test("TITLE-02: Title idempotent - not overwritten on second input", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    // Check if on welcome page and open workspace if needed
    const welcomeHeading = page.getByRole("heading", { name: "Welcome to Coder Studio" });
    if (await welcomeHeading.isVisible()) {
      console.log("✓ On welcome page, opening workspace...");
      const openWorkspaceButton = page.getByRole("button", { name: "Open Workspace" });
      await openWorkspaceButton.click();
      await page.waitForTimeout(1000);

      // Select workspace directory
      const workspaceDir = page.locator("text=coder-studio-workspaces").first();
      await workspaceDir.click();
      await page.waitForTimeout(500);

      // Click Start Workspace button
      const startWorkspaceButton = page.getByRole("button", { name: "Start Workspace" });
      await expect(startWorkspaceButton).toBeEnabled({ timeout: 5000 });
      await startWorkspaceButton.click();
      await page.waitForTimeout(3000);
    }

    // Check for draft launcher and create session if needed
    const sessionCard = page.locator(".session-card").first();
    const stateBadge = sessionCard.locator(".session-state-badge");
    const stateText = await stateBadge.textContent();

    if (stateText === "DRAFT") {
      const claudeButton = sessionCard.locator(".agent-provider-card-claude");
      await claudeButton.click();
      await page.waitForTimeout(5000);

      // Wait for session to be active
      const newStateBadge = page.locator(".session-card .session-state-badge").first();
      await expect(newStateBadge).not.toHaveText("DRAFT", { timeout: 10000 });
    }

    const activeCard = page.locator(".session-card").first();
    await expect(activeCard).toBeVisible();

    const titleElement = activeCard.locator(".session-title");
    const terminalArea = activeCard.locator('[class*="terminal"]').first();
    await expect(terminalArea).toBeVisible({ timeout: 5000 });

    // First input
    await terminalArea.click();
    await page.keyboard.type("first message");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);

    const firstTitle = await titleElement.textContent();
    console.log("First title:", firstTitle);

    // Second input with different text
    await terminalArea.click();
    await page.keyboard.type("second different message");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);

    const secondTitle = await titleElement.textContent();
    console.log("Second title:", secondTitle);

    // Title should NOT change (idempotent)
    expect(secondTitle).toBe(firstTitle);
    console.log("✓ Title idempotent - preserved after second input");
  });
});
