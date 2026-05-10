import fs from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { translatePatternForE2E } from "../../fixtures/i18n.js";
import { openWorkspace } from "../helpers/workspace-session";

type MockProviderId = "claude" | "codex";

interface ProviderMockState {
  commands: Record<string, boolean>;
  installBehavior: Partial<
    Record<
      MockProviderId,
      {
        result: "success" | "permission_denied" | "command_not_found";
        message?: string;
      }
    >
  >;
}

const sandboxDir = process.env.CODER_STUDIO_PHASE1_SANDBOX_DIR;

if (!sandboxDir) {
  throw new Error("CODER_STUDIO_PHASE1_SANDBOX_DIR must be set for provider install e2e");
}

const providerMockDir =
  process.env.CODER_STUDIO_E2E_PROVIDER_MOCK_DIR ?? join(sandboxDir, "provider-mock");
const providerMockBinDir = join(providerMockDir, "bin");
const providerMockStatePath = join(providerMockDir, "state.json");

function resetMockProviderEnvironment(): void {
  fs.rmSync(providerMockDir, { recursive: true, force: true });
  fs.mkdirSync(providerMockBinDir, { recursive: true });
}

function setMockProviderState(state: ProviderMockState): void {
  fs.mkdirSync(providerMockDir, { recursive: true });
  fs.writeFileSync(providerMockStatePath, JSON.stringify(state, null, 2));
}

async function ensureWorkspaceOpen(page: Page): Promise<void> {
  await openWorkspace(page);
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 15000 });
}

async function ensureDraftLauncher(page: Page): Promise<Locator> {
  await ensureWorkspaceOpen(page);

  const draftLauncher = page.locator(".agent-draft-launcher").first();
  if (await draftLauncher.isVisible().catch(() => false)) {
    return draftLauncher;
  }

  const closeButtons = page.locator(".session-card.agent-pane .session-action-btn-close");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await draftLauncher.isVisible().catch(() => false)) {
      return draftLauncher;
    }

    if ((await closeButtons.count()) === 0) {
      break;
    }

    await closeButtons.first().click();
    await page.waitForTimeout(300);
  }

  await expect(draftLauncher).toBeVisible({ timeout: 15000 });
  return draftLauncher;
}

async function waitForProviderCta(
  card: Locator,
  key: "provider.install.cta.start" | "provider.install.cta.install_and_start"
): Promise<void> {
  await expect(card.locator(".agent-provider-card-cta")).toHaveText(translatePatternForE2E(key), {
    timeout: 15000,
  });
}

test.describe("provider install launcher flow", () => {
  test.beforeEach(() => {
    resetMockProviderEnvironment();
  });

  test("PIF-01 Claude shows install action, installs, and creates a session", async ({ page }) => {
    setMockProviderState({
      commands: {
        npm: true,
        claude: false,
        codex: true,
      },
      installBehavior: {
        claude: { result: "success" },
      },
    });

    const draftLauncher = await ensureDraftLauncher(page);
    const claudeCard = draftLauncher.locator(".agent-provider-card-claude").first();
    const codexCard = draftLauncher.locator(".agent-provider-card-codex").first();

    await waitForProviderCta(claudeCard, "provider.install.cta.install_and_start");
    await waitForProviderCta(codexCard, "provider.install.cta.start");

    await claudeCard.click();

    await expect(claudeCard).toBeDisabled({ timeout: 15000 });
    await expect(claudeCard.locator(".agent-provider-card-status")).toBeVisible({ timeout: 15000 });

    const sessionCard = page.locator(".session-card.agent-pane[data-session-id]").first();
    await expect(sessionCard).toBeVisible({ timeout: 20000 });
  });

  test("PIF-02 Codex install failure shows error guidance and docs link", async ({ page }) => {
    setMockProviderState({
      commands: {
        npm: true,
        claude: true,
        codex: false,
      },
      installBehavior: {
        codex: {
          result: "permission_denied",
          message: "permission denied",
        },
      },
    });

    const draftLauncher = await ensureDraftLauncher(page);
    const codexCard = draftLauncher.locator(".agent-provider-card-codex").first();
    const claudeCard = draftLauncher.locator(".agent-provider-card-claude").first();

    await waitForProviderCta(claudeCard, "provider.install.cta.start");
    await waitForProviderCta(codexCard, "provider.install.cta.install_and_start");

    await codexCard.click();

    await expect(codexCard).toContainText("permission denied", { timeout: 20000 });
    await expect(codexCard.locator(".agent-provider-card-guide a")).toHaveAttribute(
      "href",
      /openai\.com|github\.com|platform\.openai\.com/i,
      { timeout: 10000 }
    );
  });
});
