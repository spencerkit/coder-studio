// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(`${process.cwd()}/src/styles/tokens.css`, "utf8");

function getRuleBlock(selector: string): string {
  let block = "";
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(stylesheet)) !== null) {
    const currentSelector = match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();

    if (currentSelector === selector) {
      block = match[2];
    }
  }

  return block;
}

function getCustomProperty(block: string, name: string): string | null {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
  return match?.[1]?.trim() ?? null;
}

describe("tokens.css touch tokens", () => {
  it("defines named theme blocks for all built-in themes", () => {
    expect(stylesheet).toContain(':root,\n[data-theme="mint-dark"]');
    expect(stylesheet).toContain('[data-theme="mint-light"]');
    expect(stylesheet).toContain('[data-theme="graphite-dark"]');
    expect(stylesheet).toContain('[data-theme="graphite-light"]');
    expect(stylesheet).toContain('[data-theme="nord-dark"]');
    expect(stylesheet).toContain('[data-theme="nord-light"]');
    expect(stylesheet).toContain('[data-theme="hc-dark"]');
    expect(stylesheet).toContain('[data-theme="hc-light"]');
  });

  it("defines desktop-default touch target tokens on :root", () => {
    const root = getRuleBlock(":root");

    expect(root).toContain("--touch-target-min: 32px");
    expect(root).toContain("--touch-target-comfortable: 40px");
    expect(root).toContain("--touch-target-large: 44px");
    expect(root).toContain("--touch-spacing-min: 8px");
    expect(root).toContain("--touch-hit-slop: 0px");
  });

  it("overrides touch tokens on narrow viewport only", () => {
    const mediaMatch = /@media\s*\(max-width:\s*899px\)\s*\{([\s\S]*?)\}\s*\}/m.exec(stylesheet);

    expect(mediaMatch, "expected @media (max-width: 899px) block").not.toBeNull();

    const body = mediaMatch![1];

    expect(body).toContain("--touch-target-min: 44px");
    expect(body).toContain("--touch-target-comfortable: 48px");
    expect(body).toContain("--touch-target-large: 56px");
    expect(body).toContain("--touch-spacing-min: 12px");
    expect(body).toContain("--touch-hit-slop: 8px");
  });

  it("keeps the light theme families visually separated through structure tokens", () => {
    const mintLight = getRuleBlock('[data-theme="mint-light"]');
    const graphiteLight = getRuleBlock('[data-theme="graphite-light"]');
    const nordLight = getRuleBlock('[data-theme="nord-light"]');

    expect(getCustomProperty(mintLight, "--bg-page")).toBe("#f3fbf7");
    expect(getCustomProperty(mintLight, "--bg-sidebar")).toBe("#edf7f2");
    expect(getCustomProperty(mintLight, "--border-focus")).toBe("#158f77");

    expect(getCustomProperty(graphiteLight, "--bg-page")).toBe("#e7edf3");
    expect(getCustomProperty(graphiteLight, "--bg-sidebar")).toBe("#dfe6ee");
    expect(getCustomProperty(graphiteLight, "--border-focus")).toBe("#315fdd");

    expect(getCustomProperty(nordLight, "--bg-page")).toBe("#e3ebf4");
    expect(getCustomProperty(nordLight, "--bg-sidebar")).toBe("#dbe4ef");
    expect(getCustomProperty(nordLight, "--border-focus")).toBe("#5b7fa8");
  });

  it("separates the light theme interaction palette across families", () => {
    const mintLight = getRuleBlock('[data-theme="mint-light"]');
    const graphiteLight = getRuleBlock('[data-theme="graphite-light"]');
    const nordLight = getRuleBlock('[data-theme="nord-light"]');

    expect(getCustomProperty(mintLight, "--text-secondary")).toBe("#557067");
    expect(getCustomProperty(mintLight, "--accent-blue")).toBe("#148a7a");
    expect(getCustomProperty(mintLight, "--shadow-glow")).toBe("0 0 12px rgba(21, 143, 119, 0.18)");

    expect(getCustomProperty(graphiteLight, "--text-secondary")).toBe("#4d5b6a");
    expect(getCustomProperty(graphiteLight, "--accent-blue")).toBe("#315fdd");
    expect(getCustomProperty(graphiteLight, "--shadow-glow")).toBe(
      "0 0 12px rgba(49, 95, 221, 0.16)"
    );

    expect(getCustomProperty(nordLight, "--text-secondary")).toBe("#4d5a6f");
    expect(getCustomProperty(nordLight, "--accent-blue")).toBe("#5b7fa8");
    expect(getCustomProperty(nordLight, "--shadow-glow")).toBe("0 0 12px rgba(91, 127, 168, 0.18)");
  });
});
