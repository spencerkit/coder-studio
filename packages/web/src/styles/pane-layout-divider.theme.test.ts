// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");

function getRuleBlocks(selector: string) {
  const blocks: string[] = [];
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  const normalizedSelector = selector.replace(/\s+/g, " ").trim();
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(stylesheet)) !== null) {
    const selectors = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((entry) => entry.replace(/\s+/g, " ").trim());

    if (selectors.includes(normalizedSelector)) {
      blocks.push(match[2]);
    }
  }

  if (blocks.length === 0) {
    throw new Error(`expected CSS rule for ${selector}`);
  }

  return blocks;
}

describe("pane-layout vertical divider styles", () => {
  it("keeps stacked pane divider hit areas transparent and below editor overlays", () => {
    const baseDivider = getRuleBlocks(".pane-layout-divider").join("\n");
    const divider = getRuleBlocks(".pane-layout-vertical-divider").join("\n");
    const dividerLine = getRuleBlocks(".pane-layout-vertical-divider::after").join("\n");
    const hoverDividerLine = getRuleBlocks(".pane-layout-divider:hover::after").join("\n");

    expect(baseDivider).toContain("z-index: var(--z-inline)");
    expect(baseDivider).not.toContain("z-index: var(--z-inline-raised)");
    expect(baseDivider).not.toContain("z-index: var(--z-modal");
    expect(baseDivider).not.toContain("z-index: var(--z-popover");
    expect(baseDivider).not.toContain("z-index: var(--z-tooltip");
    expect(baseDivider).toContain("background: transparent");
    expect(divider).toContain("width: 100%");
    expect(divider).toContain("height: 10px");
    expect(divider).toContain("margin-top: -5px");
    expect(divider).toContain("margin-bottom: -5px");
    expect(divider).toContain("background: transparent");
    expect(dividerLine).toContain(
      "background: var(--component-mix-border-default-78pct-status-info-fg-22pct)"
    );
    expect(hoverDividerLine).toContain(
      "background: var(--component-mix-border-focus-58pct-transparent)"
    );
  });
});
