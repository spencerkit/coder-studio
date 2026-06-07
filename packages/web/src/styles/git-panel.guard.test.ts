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
    const selectors = (match[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((entry) => entry.replace(/\s+/g, " ").trim());

    if (selectors.includes(normalizedSelector)) {
      blocks.push(match[2] ?? "");
    }
  }

  if (blocks.length === 0) {
    throw new Error(`expected CSS rule for ${selector}`);
  }

  return blocks;
}

describe("git panel styles", () => {
  it("uses the git panel as the history scroll root", () => {
    const panelScroll = getRuleBlocks(".git-panel-scroll").join("\n");
    const historyBody = getRuleBlocks(".git-panel-section-body--history").join("\n");

    expect(panelScroll).toContain("overflow-y: auto");
    expect(historyBody).toContain("overflow: visible");
    expect(historyBody).not.toMatch(/overflow-y\s*:\s*auto/);
    expect(stylesheet).not.toMatch(/\.git-panel-section-history--expanded\s*\{/);
  });
});
