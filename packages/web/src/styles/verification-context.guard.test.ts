// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const componentsStyles = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");

function getRuleBlock(selector: string) {
  const normalizedSelector = selector.replace(/\s+/g, " ").trim();
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(componentsStyles))) {
    const selectors = (match[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((entry) => entry.replace(/\s+/g, " ").trim());

    if (selectors.includes(normalizedSelector)) {
      return match[2] ?? "";
    }
  }

  throw new Error(`expected CSS rule for ${selector}`);
}

describe("verification context styles", () => {
  it("styles latest verification context in agent and git surfaces", () => {
    const sessionVerify = getRuleBlock(".session-card-verify");
    const sessionVerifyCommand = getRuleBlock(".session-card-verify-command");
    const sessionVerifyActions = getRuleBlock(".session-card-verify-actions");
    const sessionVerifyPassed = getRuleBlock(".session-card-verify--passed");
    const sessionVerifyFailed = getRuleBlock(".session-card-verify--failed");
    const sessionVerifyRunning = getRuleBlock(".session-card-verify--running");
    const gitBanner = getRuleBlock(".git-verification-banner");
    const gitBannerActions = getRuleBlock(".git-verification-banner button");
    const gitBannerFailed = getRuleBlock(".git-verification-banner--failed");

    expect(sessionVerify).toContain("display: grid");
    expect(sessionVerify).toContain("grid-template-columns:");
    expect(sessionVerify).toContain("padding: var(--sp-2) var(--sp-3)");
    expect(sessionVerify).toContain(
      "border: 1px solid var(--component-mix-current-color-22pct-transparent)"
    );
    expect(sessionVerify).toContain(
      "background: var(--component-mix-current-color-8pct-transparent)"
    );
    expect(sessionVerifyCommand).toContain("overflow: hidden");
    expect(sessionVerifyCommand).toContain("text-overflow: ellipsis");
    expect(sessionVerifyActions).toContain("display: inline-flex");
    expect(sessionVerifyPassed).toContain("color: var(--status-success-fg)");
    expect(sessionVerifyFailed).toContain("color: var(--status-danger-fg)");
    expect(sessionVerifyRunning).toContain("color: var(--status-info-fg)");

    expect(gitBanner).toContain("display: flex");
    expect(gitBanner).toContain("padding: var(--sp-2) var(--sp-3)");
    expect(gitBanner).toContain(
      "border: 1px solid var(--component-mix-current-color-22pct-transparent)"
    );
    expect(gitBanner).toContain("background: var(--component-mix-current-color-8pct-transparent)");
    expect(gitBannerActions).toContain("min-height: var(--control-height-sm)");
    expect(gitBannerFailed).toContain("color: var(--status-danger-fg)");
  });
});
