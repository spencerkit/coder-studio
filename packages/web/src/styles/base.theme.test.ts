// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(`${process.cwd()}/src/styles/base.css`, "utf8");

function getRuleBlock(selector: string) {
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null = null;
  const normalizedSelector = selector.replace(/\s+/g, " ").trim();

  while ((match = matcher.exec(stylesheet)) !== null) {
    const selectors = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((entry) => entry.replace(/\s+/g, " ").trim());

    if (selectors.includes(normalizedSelector)) {
      return match[2];
    }
  }

  throw new Error(`expected CSS rule for ${selector}`);
}

describe("base.css theme-sensitive shells", () => {
  it("keeps the app loading shell on theme tokens instead of dark-only gradients", () => {
    const shell = getRuleBlock(".app-loading-shell");
    const card = getRuleBlock(".app-loading-card");

    expect(shell).toContain("var(--bg-page)");
    expect(shell).not.toContain("rgba(17, 24, 31, 0.92)");
    expect(card).toContain("var(--bg-surface)");
    expect(card).not.toContain("rgba(17, 24, 31, 0.96)");
  });

  it("defines shared icon tone and surface utilities", () => {
    const tone = getRuleBlock(".icon-tone-secondary");
    const surface = getRuleBlock(".icon-surface-warning");
    const chip = getRuleBlock(".icon-chip");
    const themedIcon = getRuleBlock(".themed-icon");
    const themedTone = getRuleBlock(".themed-icon--tone-warning");
    const themedSurface = getRuleBlock(".themed-icon--surface-info");

    expect(tone).toContain("color: var(--icon-secondary)");
    expect(surface).toContain("background: var(--icon-surface-warning)");
    expect(chip).toContain("display: inline-flex");
    expect(chip).toContain("align-items: center");
    expect(chip).toContain("justify-content: center");
    expect(chip).toContain("border-radius: var(--radius-md)");
    expect(themedIcon).toContain("display: inline-flex");
    expect(themedIcon).toContain("line-height: 0");
    expect(themedTone).toContain("color: var(--icon-warning)");
    expect(themedSurface).toContain("background: var(--icon-surface-info)");
  });
});
