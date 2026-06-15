// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseStyles = readFileSync(`${process.cwd()}/src/styles/base.css`, "utf8");
const componentsStyles = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");
const sharedUiSources = [
  "src/components/ui/button/index.module.css",
  "src/components/ui/icon-button/index.module.css",
  "src/components/ui/input/index.module.css",
  "src/components/ui/textarea/index.module.css",
  "src/components/ui/switch/index.module.css",
  "src/components/ui/tabs/index.module.css",
  "src/components/ui/segmented-control/index.module.css",
  "src/components/ui/kbd/index.module.css",
  "src/components/ui/popover/index.module.css",
  "src/components/ui/action-menu/index.module.css",
  "src/components/ui/tag/index.module.css",
  "src/components/ui/badge/index.module.css",
  "src/components/ui/pill/index.module.css",
  "src/components/ui/select/index.module.css",
  "src/components/ui/tooltip/index.module.css",
  "src/components/ui/notice/index.module.css",
  "src/components/ui/modal/index.module.css",
  "src/components/ui/drawer/index.module.css",
  "src/components/ui/toast/index.module.css",
  "src/components/ui/local-overlay/index.module.css",
  "src/components/ui/progress-bar/index.module.css",
  "src/components/ui/status-dot/index.module.css",
  "src/components/ui/empty-state/index.module.css",
  "src/components/ui/confirm-dialog/index.module.css",
  "src/components/ui/datetime-picker/index.module.css",
  "src/components/ui/spinner/index.module.css",
].map((file) => [file, readFileSync(`${process.cwd()}/${file}`, "utf8")] as const);

const rawFoundationPattern =
  /(?:background(?:-color)?:\s*rgba\(|box-shadow:\s*[^;]*rgba\(|outline:\s*[^;]*rgba\(|border-radius:\s*(?:999px|9999px)|z-index:\s*\d+|gap:\s*\d+px|padding(?:-(?:top|right|bottom|left|inline|block))?:\s*\d+px)/;

const exemptBaseSelectors: RegExp[] = [];
const exemptComponentSelectors = [
  /\.settings-monitoring-/,
  /\.workspace-activity-bar/,
  /\.workspace-sidebar-panel__body--stacked/,
  /\.workspace-sidebar-section/,
  /\.workspace-open-editors/,
  /\.workspace-search-panel/,
  /\.code-file-path \.dirty-indicator/,
  /\.editor-pane-card__dirty-indicator/,
  /(?:^|[\s>+~,])\.file-tree(?=[\s>+~,:]|$)/,
  /(?:^|[\s>+~,])\.file-tree-shell(?=[\s>+~,:]|$)/,
  /(?:^|[\s>+~,])\.tree-(?:item|empty-hint|loading)(?=[\s>+~,:]|$)/,
  /\.git-/,
  /\.terminal-/,
  /\.bottom-terminal/,
  /\.mobile-/,
  /\.memory-panel__/,
  /\.dev-browser-/,
];

function getOffenderBlocks(source: string, selectorExemptions: RegExp[]) {
  return Array.from(
    source.matchAll(
      /([^{}]+)\{([^}]*(?:background(?:-color)?:\s*rgba\(|box-shadow:\s*[^;]*rgba\(|outline:\s*[^;]*rgba\(|border-radius:\s*(?:999px|9999px)|z-index:\s*\d+|gap:\s*\d+px|padding(?:-(?:top|right|bottom|left|inline|block))?:\s*\d+px)[^}]*)\}/g
    )
  )
    .map((match) => ({
      selector: match[1]
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .trim(),
      block: `${match[1]}{${match[2]}}`,
    }))
    .filter(({ selector }) => !selectorExemptions.some((pattern) => pattern.test(selector)))
    .map(({ block }) => block);
}

describe("foundation guardrails", () => {
  it("keeps base.css and shared UI modules on semantic foundation tokens", () => {
    expect(getOffenderBlocks(baseStyles, exemptBaseSelectors)).toEqual([]);

    for (const [file, source] of sharedUiSources) {
      expect(source, file).not.toMatch(rawFoundationPattern);
    }
  });

  it("limits raw foundation recipes in components.css to the remaining exempt legacy selectors", () => {
    expect(getOffenderBlocks(componentsStyles, exemptComponentSelectors)).toEqual([]);
  });
});
