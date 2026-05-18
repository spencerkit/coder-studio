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
].map((file) => [file, readFileSync(`${process.cwd()}/${file}`, "utf8")] as const);

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
  /\.agent-terminal/,
  /\.bottom-terminal/,
  /\.terminal-/,
  /\.mobile-terminal-/,
  /\.xterm/,
  /\.code-editor/,
  /\.monaco/,
  /\.git-diff/,
  /\.diff-/,
  /\.review-/,
  /\.image-preview-/,
  /\.code-file-path/,
  /\.code-lines/,
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
  it("keeps base.css and shared UI modules off raw and legacy font sizes", () => {
    expect(getOffenderBlocks(baseStyles, exemptBaseSelectors)).toEqual([]);

    for (const [file, source] of sharedUiSources) {
      expect(source, file).not.toMatch(forbiddenSharedPattern);
    }
  });

  it("limits raw or legacy font-size values in components.css to exempt code surfaces", () => {
    expect(componentsStyles).toMatch(fontSizePattern);

    const offenderBlocks = getOffenderBlocks(
      componentsStyles,
      [...exemptComponentSelectors, ...iconOnlySelectors],
      exemptComponentSelectors
    );

    expect(offenderBlocks).toEqual([]);
  });
});
