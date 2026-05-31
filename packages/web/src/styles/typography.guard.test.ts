// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseStyles = readFileSync(`${process.cwd()}/src/styles/base.css`, "utf8");
const componentsStyles = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");
const sharedUiSources = [
  "src/components/ui/button/index.module.css",
  "src/components/ui/input/index.module.css",
  "src/components/ui/textarea/index.module.css",
  "src/components/ui/tabs/index.module.css",
  "src/components/ui/tag/index.module.css",
  "src/components/ui/badge/index.module.css",
  "src/components/ui/pill/index.module.css",
  "src/components/ui/tooltip/index.module.css",
  "src/components/ui/notice/index.module.css",
  "src/components/ui/modal/index.module.css",
  "src/components/ui/empty-state/index.module.css",
  "src/components/ui/kbd/index.module.css",
  "src/components/ui/segmented-control/index.module.css",
  "src/components/ui/toast/index.module.css",
  "src/components/ui/confirm-dialog/index.module.css",
  "src/components/ui/datetime-picker/index.module.css",
].map((file) => [file, readFileSync(`${process.cwd()}/${file}`, "utf8")] as const);

const forbiddenLegacyTypographyPattern =
  /var\(--type-(?:kicker|label|meta|body(?!-[1-6])|body-strong|code-inline|app-title|section-title|page-title|display)(?:-[a-z-]+)?\)/;
const forbiddenSharedPattern = /font-size:\s*(?:\d+px|clamp\(|var\(--text-)/;
const fontSizePattern = /font-size:\s*(?:\d+px|clamp\(|var\(--text-)/;
const iconOnlySelectors = [
  /\.panel-toolbar-btn/,
  /\.tree-chevron/,
  /\.tree-icon/,
  /\.agent-action-btn/,
  /\.topbar-close/,
  /\.topbar-add/,
  /\.worktree-tree-icon/,
  /\.fp-dir-icon/,
  /\.config-empty-icon/,
  /\.page-header__back/,
];
const exemptBaseSelectors = [/^html$/];
const exemptComponentSelectors = [
  /\.session-terminal/,
  /\.bottom-terminal/,
  /\.terminal-/,
  /\.mobile-terminal-/,
  /\.xterm/,
  /\.code-editor/,
  /\.monaco/,
  /\.git-diff/,
  /\.git-/,
  /\.diff-/,
  /\.review-/,
  /\.diagnostics-/,
  /\.image-preview-/,
  /\.code-file-path/,
  /\.code-lines/,
  /\.workspace-activity-bar/,
  /\.workspace-sidebar-section/,
  /\.workspace-open-editors/,
  /\.workspace-search-panel/,
];

function getOffenderBlocks(
  source: string,
  selectorExemptions: RegExp[],
  extraExemptions: RegExp[] = []
) {
  return Array.from(
    source.matchAll(/([^{}]+)\{([^}]*font-size:\s*(?:\d+px|clamp\(|var\(--text-)[^}]*)\}/g)
  )
    .map((match) => ({
      selector: match[1]
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .trim(),
      block: `${match[1]}{${match[2]}}`,
    }))
    .filter(
      ({ selector, block }) =>
        !selectorExemptions.some((pattern) => pattern.test(selector)) &&
        !extraExemptions.some((pattern) => pattern.test(block))
    )
    .map(({ block }) => block);
}

describe("typography guardrails", () => {
  it("keeps base.css and shared UI modules on role typography tokens", () => {
    expect(getOffenderBlocks(baseStyles, exemptBaseSelectors)).toEqual([]);
    expect(baseStyles).not.toMatch(forbiddenLegacyTypographyPattern);

    for (const [file, source] of sharedUiSources) {
      expect(source, file).not.toMatch(forbiddenSharedPattern);
      expect(source, file).not.toMatch(forbiddenLegacyTypographyPattern);
    }
  });

  it("keeps components.css off legacy typography aliases and limits raw font-size escapes to exempt code and diagnostics surfaces", () => {
    expect(componentsStyles).not.toMatch(forbiddenLegacyTypographyPattern);
    expect(componentsStyles).toMatch(fontSizePattern);

    const offenderBlocks = getOffenderBlocks(
      componentsStyles,
      [...exemptComponentSelectors, ...iconOnlySelectors],
      exemptComponentSelectors
    );

    expect(offenderBlocks).toEqual([]);
  });
});
