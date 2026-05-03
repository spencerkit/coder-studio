import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");

function getLastGroupedRuleBlock(pattern: RegExp) {
  const matches = Array.from(stylesheet.matchAll(pattern));
  const match = matches.at(-1);

  expect(match, `expected CSS rule matching ${pattern}`).toBeTruthy();
  return match?.[1] ?? "";
}

function getLastRuleBlock(selector: string) {
  let block = "";
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(stylesheet))) {
    const selectors = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((entry) => entry.trim());

    if (selectors.includes(selector)) {
      block = match[2];
    }
  }

  expect(block, `expected CSS rule for ${selector}`).not.toBe("");
  return block;
}

describe("components.css theme-sensitive surfaces", () => {
  it("keeps the workspace launch modal theme-aware", () => {
    const overlay = getLastRuleBlock(".launch-overlay");
    const modal = getLastRuleBlock(".launch-modal");

    expect(overlay).not.toContain("rgba(4, 8, 12, 0.58)");
    expect(modal).not.toContain("rgba(17, 24, 31, 0.98)");
    expect(modal).toContain("var(--bg-surface)");
  });

  it("keeps workspace chrome on tokens instead of hardcoded dark fills", () => {
    const topbar = getLastRuleBlock(".app-topbar");
    const activeTab = getLastRuleBlock(".topbar-tab.active");
    const emptyCard = getLastRuleBlock(".workspace-empty-inner");
    const resolvingCard = getLastRuleBlock(".workspace-resolving-card");

    expect(topbar).toContain("var(--bg-surface)");
    expect(activeTab).toContain("var(--bg-active)");
    expect(activeTab).not.toContain("rgba(45, 63, 79, 0.92)");
    expect(emptyCard).toContain("var(--bg-surface)");
    expect(resolvingCard).toContain("var(--bg-surface)");
  });

  it("keeps quick actions sized to its label instead of icon-button width", () => {
    const quickActions = getLastRuleBlock(".topbar-quick-actions");

    expect(quickActions).toContain("width: auto");
    expect(quickActions).toContain("min-width: max-content");
    expect(quickActions).toContain("flex-shrink: 0");
  });

  it("keeps terminal toolbar controls grouped at the far right", () => {
    const rightToolbar = getLastRuleBlock(".terminal-toolbar-right");

    expect(rightToolbar).toContain("justify-content: flex-end");
    expect(rightToolbar).not.toContain("justify-content: flex-start");
    expect(stylesheet).not.toContain(".terminal-toolbar-right > .terminal-toolbar-actions:first-of-type");
  });

  it("keeps workspace editor and diff surfaces theme-aware", () => {
    const editorShell = getLastRuleBlock(".workspace-git-editor");
    const editorHeader = getLastRuleBlock(".code-editor-header");
    const imageMeta = getLastRuleBlock(".image-preview-meta");
    const addedLine = getLastRuleBlock(".git-diff-line-added");
    const removedLine = getLastRuleBlock(".git-diff-line-removed");

    expect(editorShell).toContain("var(--bg-surface)");
    expect(editorShell).not.toContain("rgba(11, 18, 24, 0.92)");
    expect(editorHeader).toContain("var(--bg-surface)");
    expect(editorHeader).not.toContain("rgba(18, 26, 34, 0.96)");
    expect(imageMeta).toContain("var(--bg-surface)");
    expect(imageMeta).not.toContain("rgba(17, 24, 31, 0.92)");
    expect(addedLine).toContain("var(--color-success)");
    expect(addedLine).not.toContain("#9ce7c8");
    expect(removedLine).toContain("var(--color-error)");
    expect(removedLine).not.toContain("#ffb7c4");
  });

  it("keeps xterm and monaco scrollbars aligned with shared tokens", () => {
    const xtermViewport = getLastRuleBlock(".xterm-host .xterm-viewport");
    const xtermThumb = getLastRuleBlock(".xterm-host .xterm-viewport::-webkit-scrollbar-thumb");
    const xtermThumbHover = getLastRuleBlock(".xterm-host .xterm-viewport::-webkit-scrollbar-thumb:hover");
    const monacoTrack = getLastRuleBlock(
      ".monaco-host .monaco-editor .monaco-scrollable-element > .scrollbar"
    );
    const monacoSlider = getLastRuleBlock(
      ".monaco-host .monaco-editor .monaco-scrollable-element > .scrollbar > .slider"
    );
    const monacoSliderHover = getLastRuleBlock(
      ".monaco-host .monaco-editor .monaco-scrollable-element > .scrollbar:hover > .slider"
    );

    expect(xtermViewport).toContain("scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track)");
    expect(xtermThumb).toContain("var(--scrollbar-thumb)");
    expect(xtermThumb).toContain("var(--radius-full)");
    expect(xtermThumbHover).toContain("var(--border-focus)");
    expect(monacoTrack).toContain("var(--scrollbar-track)");
    expect(monacoSlider).toContain("var(--scrollbar-thumb)");
    expect(monacoSlider).toContain("var(--radius-full)");
    expect(monacoSliderHover).toContain("var(--border-focus)");
  });

  it("keeps xterm viewport touch-scrollable on mobile browsers", () => {
    const xtermViewport = getLastRuleBlock(".xterm-host .xterm-viewport");

    expect(xtermViewport).toContain("touch-action: pan-y");
    expect(xtermViewport).toContain("-webkit-overflow-scrolling: touch");
    expect(xtermViewport).not.toContain("touch-action: none");
  });

  it("scopes disabled provider card styling to the draft launcher", () => {
    expect(stylesheet).toContain(".agent-draft-launcher .agent-provider-card[disabled]");
    expect(stylesheet).not.toContain("\n.agent-provider-card[disabled] {\n");
  });

  it("keeps mobile sheet bodies as flex columns so sheet content can fill the viewport", () => {
    const sheetBody = getLastRuleBlock(".mobile-sheet__body");
    const sheetBodyChildren = getLastRuleBlock(".mobile-sheet__body > *");

    expect(sheetBody).toContain("display: flex");
    expect(sheetBody).toContain("flex-direction: column");
    expect(sheetBodyChildren).toContain("flex: 1");
    expect(sheetBodyChildren).toContain("min-height: 0");
  });

  it("keeps fullscreen mobile sheet headers aligned to a settings-style back and title row", () => {
    const fullscreenHeader = getLastRuleBlock(".mobile-sheet--fullscreen .mobile-sheet__header");
    const headerMain = getLastRuleBlock(".mobile-sheet--fullscreen .mobile-sheet__header-main");
    const backButton = getLastRuleBlock(".mobile-sheet--fullscreen .mobile-sheet__back");
    const headerActions = getLastRuleBlock(".mobile-sheet__header-actions");

    expect(fullscreenHeader).toContain("display: flex");
    expect(fullscreenHeader).toContain("align-items: center");
    expect(headerMain).toContain("align-items: flex-start");
    expect(backButton).toContain("background: transparent");
    expect(backButton).not.toContain("border-radius: 999px");
    expect(headerActions).toContain("margin-left: auto");
  });

  it("uses a unified inline sheet treatment for mobile selectors and keeps topbar controls height-aligned", () => {
    const inlineSheet = getLastRuleBlock(".mobile-inline-sheet");
    const inlineSelectSheet = getLastRuleBlock(".mobile-select-sheet--inline");
    const workspaceButton = getLastGroupedRuleBlock(/\.mobile-topbar__workspace-button\s*\{([^}]*)\}/g);
    const sessionButton = getLastGroupedRuleBlock(/\.mobile-topbar__session-button\s*\{([^}]*)\}/g);
    const iconButton = getLastRuleBlock(".mobile-topbar__icon-button");

    expect(inlineSheet).toContain("position: absolute");
    expect(inlineSheet).toContain("border-radius: 20px");
    expect(inlineSelectSheet).toContain("flex: 1");
    expect(inlineSelectSheet).toContain("flex-direction: column");
    expect(workspaceButton).toContain("height: 48px");
    expect(sessionButton).toContain("min-height: 48px");
    expect(iconButton).toContain("height: 48px");
  });

  it("keeps mobile select row-side actions lightweight and token-driven", () => {
    const row = getLastRuleBlock(".mobile-select-sheet__item-row");
    const rowSelected = getLastRuleBlock(".mobile-select-sheet__item-row[data-selected='true']");
    const sideAction = getLastRuleBlock(".mobile-select-sheet__item-side-action");
    const sideActionDanger = getLastRuleBlock(".mobile-select-sheet__item-side-action--danger");

    expect(row).toContain("display: flex");
    expect(row).toContain("padding: var(--sp-1) var(--sp-2)");
    expect(rowSelected).toContain("var(--accent-blue)");
    expect(sideAction).toContain("width: 40px");
    expect(sideAction).toContain("border-radius: 999px");
    expect(sideAction).toContain("background: transparent");
    expect(sideActionDanger).toContain("var(--accent-red)");
    expect(stylesheet).not.toContain(".mobile-select-sheet__item-check {");
  });

  it("keeps the mobile dock as a three-entry bottom rail for agent, files, and terminal", () => {
    const mobileDock = getLastRuleBlock(".mobile-dock");

    expect(mobileDock).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
  });
});
