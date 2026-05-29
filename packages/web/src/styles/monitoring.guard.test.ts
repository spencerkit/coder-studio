// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const componentsStyles = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");

const monitoringSelectorPattern =
  /(?:^|[\s>+~,])\.(?:settings-monitoring|monitoring-)[a-z0-9-_:.\s>+~,]*/;
const rawMonitoringFontSizePattern =
  /font-size:\s*(?:\d+px|clamp\(|\d+(?:\.\d+)?rem\b|var\(--text-)/;
const rawMonitoringRadiusPattern =
  /border-radius:\s*(?:\d+px|999px|9999px|\d+%|calc\([^)]*\d+px[^)]*\))/;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRuleBlock(selector: string) {
  const pattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`);
  return componentsStyles.match(pattern)?.[1] ?? "";
}

function getMonitoringOffenderBlocks(pattern: RegExp) {
  return Array.from(componentsStyles.matchAll(/([^{}]+)\{([^}]*)\}/g))
    .map((match) => ({
      selector: (match[1] ?? "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .trim(),
      block: `${match[1]}{${match[2]}}`,
    }))
    .filter(
      ({ selector, block }) => monitoringSelectorPattern.test(selector) && pattern.test(block)
    )
    .map(({ block }) => block);
}

describe("monitoring style guardrails", () => {
  it("keeps monitoring font sizes on semantic tokens", () => {
    expect(componentsStyles).toMatch(rawMonitoringFontSizePattern);
    expect(getMonitoringOffenderBlocks(rawMonitoringFontSizePattern)).toEqual([]);
  });

  it("keeps monitoring radii on semantic tokens", () => {
    expect(componentsStyles).toMatch(rawMonitoringRadiusPattern);
    expect(getMonitoringOffenderBlocks(rawMonitoringRadiusPattern)).toEqual([]);
  });

  it("lets the dense settings monitoring surface grow with dashboard content", () => {
    const denseFillHeightRule = getRuleBlock(
      ".settings-content--fill-height > .settings-content-surface--monitoring-dense"
    );

    expect(denseFillHeightRule).toContain("flex: 0 0 auto");
    expect(denseFillHeightRule).toContain("min-height: 100%");
  });

  it("keeps monitoring data panels padded away from their borders", () => {
    const panelRule = getRuleBlock(".monitoring-tree,\n.monitoring-detail");

    expect(panelRule).toContain("padding: var(--sp-3)");
  });
});
