// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");

function getCombinedRuleBlock(selector: string): string {
  const blocks: string[] = [];
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  const normalizedSelector = selector.replace(/\s+/g, " ").trim();
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(stylesheet))) {
    const selectors = (match[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((entry) => entry.replace(/\s+/g, " ").trim());

    if (selectors.includes(normalizedSelector)) {
      blocks.push(match[2] ?? "");
    }
  }

  expect(blocks.length, `expected CSS rule for ${selector}`).toBeGreaterThan(0);
  return blocks.join("\n");
}

function getRuleBlockAfter(anchor: string, selector: string): string {
  const startIndex = stylesheet.indexOf(anchor);
  expect(startIndex, `expected CSS anchor ${anchor}`).toBeGreaterThanOrEqual(0);

  const scopedStylesheet = stylesheet.slice(startIndex);
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  const normalizedSelector = selector.replace(/\s+/g, " ").trim();
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(scopedStylesheet))) {
    const selectors = (match[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((entry) => entry.replace(/\s+/g, " ").trim());

    if (selectors.includes(normalizedSelector)) {
      return match[2] ?? "";
    }
  }

  throw new Error(`expected CSS rule for ${selector} after ${anchor}`);
}

describe("supervisor details layout styles", () => {
  it("stretches the plan column and mind map viewport to match the details rail", () => {
    expect(getCombinedRuleBlock(".supervisor-details-layout")).toContain("align-items: stretch");
    expect(getCombinedRuleBlock(".supervisor-details-main")).toContain("height: 100%");
    expect(getCombinedRuleBlock(".supervisor-details-section--plan")).toContain("height: 100%");
    expect(getCombinedRuleBlock(".supervisor-details-surface--plan")).toContain("height: 100%");
    expect(getCombinedRuleBlock(".supervisor-mind-map-flow")).toContain("display: flex");
    expect(getCombinedRuleBlock(".supervisor-mind-map-flow")).toContain("flex: 1 1 auto");
    expect(getCombinedRuleBlock(".supervisor-mind-map-flow__viewport")).toContain(
      "min-height: clamp(380px, 52vh, 560px)"
    );
    expect(getCombinedRuleBlock(".supervisor-mind-map-flow__viewport")).toContain("flex: 1 1 auto");
    expect(getCombinedRuleBlock(".supervisor-mind-map-flow__viewport")).toContain("height: auto");
  });

  it("keeps compact supervisor sheets from inheriting the taller desktop map height", () => {
    const containerViewport = getRuleBlockAfter(
      "@container (max-width: 30rem)",
      ".supervisor-mind-map-flow__viewport"
    );
    const mobileViewport = getRuleBlockAfter(
      "@media (max-width: 640px)",
      ".supervisor-mind-map-flow__viewport"
    );

    expect(containerViewport).toContain("flex: 0 0 auto");
    expect(containerViewport).toContain("height: 320px");
    expect(containerViewport).toContain("min-height: 320px");
    expect(mobileViewport).toContain("flex: 0 0 auto");
    expect(mobileViewport).toContain("height: 300px");
    expect(mobileViewport).toContain("min-height: 300px");
  });
});
