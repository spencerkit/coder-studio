// @vitest-environment node
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
    expect(stylesheet).not.toContain(
      ".terminal-toolbar-right > .terminal-toolbar-actions:first-of-type"
    );
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
    const xtermWebkitScrollbar = getLastRuleBlock(".xterm-host .xterm-viewport::-webkit-scrollbar");
    const xtermCustomTrack = getLastRuleBlock(
      ".xterm-host .xterm .xterm-scrollable-element > .scrollbar"
    );
    const xtermCustomVerticalSlider = getLastRuleBlock(
      ".xterm-host .xterm .xterm-scrollable-element > .scrollbar.vertical > .slider"
    );
    const xtermCustomSlider = getLastRuleBlock(
      ".xterm-host .xterm .xterm-scrollable-element > .scrollbar > .slider"
    );
    const xtermCustomSliderHover = getLastRuleBlock(
      ".xterm-host .xterm .xterm-scrollable-element > .scrollbar:hover > .slider"
    );
    const xtermCustomSliderActive = getLastRuleBlock(
      ".xterm-host .xterm .xterm-scrollable-element > .scrollbar.active > .slider"
    );
    const monacoTrack = getLastRuleBlock(
      ".monaco-host .monaco-editor .monaco-scrollable-element > .scrollbar"
    );
    const monacoSlider = getLastRuleBlock(
      ".monaco-host .monaco-editor .monaco-scrollable-element > .scrollbar > .slider"
    );
    const monacoSliderHover = getLastRuleBlock(
      ".monaco-host .monaco-editor .monaco-scrollable-element > .scrollbar:hover > .slider"
    );

    expect(xtermViewport).toContain("scrollbar-width: none");
    expect(xtermWebkitScrollbar).toContain("width: 0");
    expect(xtermWebkitScrollbar).toContain("height: 0");
    expect(xtermCustomTrack).toContain("var(--scrollbar-track)");
    expect(xtermCustomVerticalSlider).toContain("width: var(--scrollbar-width)");
    expect(xtermCustomSlider).toContain("var(--scrollbar-thumb)");
    expect(xtermCustomSlider).toContain("var(--radius-full)");
    expect(xtermCustomSliderHover).toContain("var(--border-focus)");
    expect(xtermCustomSliderActive).toContain("var(--border-focus)");
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

  it("keeps code editor header actions docked to the right edge", () => {
    expect(stylesheet).toMatch(
      /\.code-mode-toggle\s*\{[^}]*display:\s*inline-flex;[^}]*margin-left:\s*auto;[^}]*flex-shrink:\s*0;[^}]*\}/
    );
  });

  it("scopes disabled provider card styling to the draft launcher", () => {
    expect(stylesheet).toContain(".agent-draft-launcher .agent-provider-card[disabled]");
    expect(stylesheet).not.toContain("\n.agent-provider-card[disabled] {\n");
  });

  it("keeps draft launcher provider cards adaptive inside narrow panes", () => {
    const launcher = getLastRuleBlock(".agent-draft-launcher");
    const content = getLastRuleBlock(".agent-draft-content");
    const providerCard = getLastRuleBlock(".agent-provider-card");
    const providerBody = getLastRuleBlock(".agent-provider-card-body");
    const providerArrow = getLastRuleBlock(".agent-provider-card-arrow");

    expect(launcher).toContain("container-type: inline-size");
    expect(content).toContain("max-width: 100%");
    expect(providerCard).toContain("min-width: 0");
    expect(providerBody).toContain("width: 100%");
    expect(providerArrow).toContain("flex-shrink: 0");
    expect(stylesheet).toMatch(
      /@container\s*\(max-width:\s*36rem\)\s*\{[\s\S]*?\.agent-draft-providers\s*\{[\s\S]*?grid-template-columns:\s*1fr;[\s\S]*?\}/
    );
  });

  it("keeps mobile sheet bodies as flex columns so sheet content can fill the viewport", () => {
    const sheetBody = getLastRuleBlock(".mobile-sheet__body");
    const sheetBodyChildren = getLastRuleBlock(".mobile-sheet__body > *");

    expect(sheetBody).toContain("display: flex");
    expect(sheetBody).toContain("flex-direction: column");
    expect(sheetBodyChildren).toContain("flex: 1");
    expect(sheetBodyChildren).toContain("min-height: 0");
  });

  it("keeps the shared mobile workspace viewport flush with the bottom footer", () => {
    const viewport = getLastRuleBlock(".mobile-shell__viewport");
    const compactViewport = getLastRuleBlock(
      ".mobile-shell--landscape-compact .mobile-shell__viewport"
    );

    expect(viewport).toContain(
      "padding: var(--sp-2) var(--mobile-safe-right) 0 var(--mobile-safe-left)"
    );
    expect(viewport).not.toContain("var(--sp-3) var(--mobile-safe-left)");
    expect(compactViewport).toContain("padding-bottom: 0");
  });

  it("pins the mobile workspace and fullscreen sheets to the viewport with a scrolling middle region", () => {
    const mobileShell = getLastGroupedRuleBlock(/\.mobile-shell\s*\{([^}]*)\}/g);
    const fullscreenSheet = getLastGroupedRuleBlock(
      /\.mobile-sheet\.mobile-sheet--fullscreen\s*\{([^}]*)\}/g
    );
    const fullscreenFooter = getLastGroupedRuleBlock(
      /\.mobile-sheet\.mobile-sheet--fullscreen\s+\.mobile-sheet__footer\s*\{([^}]*)\}/g
    );
    const sheetBody = getLastRuleBlock(".mobile-sheet__body");

    expect(mobileShell).toContain("height: 100dvh");
    expect(mobileShell).toContain("overflow: hidden");
    expect(fullscreenSheet).toContain("height: 100dvh");
    expect(fullscreenSheet).toContain("overflow: hidden");
    expect(fullscreenSheet).toContain(
      "padding: calc(var(--mobile-safe-top) + var(--sp-2)) var(--mobile-safe-right) 0"
    );
    expect(fullscreenFooter).toContain("padding-bottom: var(--mobile-safe-bottom)");
    expect(sheetBody).toContain("overflow-y: auto");
  });

  it("keeps fullscreen mobile sheet headers aligned to a settings-style back and title row", () => {
    const fullscreenHeader = getLastRuleBlock(".mobile-sheet--fullscreen .mobile-sheet__header");
    const pageHeader = getLastRuleBlock(".mobile-sheet--fullscreen .page-header");
    const headerLeading = getLastRuleBlock(".page-header__leading");
    const backButton = getLastRuleBlock(".mobile-sheet--fullscreen .page-header__back");
    const headerActions = getLastRuleBlock(".page-header__actions");

    expect(fullscreenHeader).toContain("padding:");
    expect(pageHeader).toContain("gap: var(--sp-3)");
    expect(headerLeading).toContain("flex: 1");
    expect(backButton).toContain("background: transparent");
    expect(backButton).not.toContain("border-radius: 999px");
    expect(headerActions).toContain("margin-left: auto");
  });

  it("uses a unified inline sheet treatment for mobile selectors and keeps topbar controls height-aligned", () => {
    const inlineSheet = getLastRuleBlock(".mobile-inline-sheet");
    const inlineSelectSheet = getLastRuleBlock(".mobile-select-sheet--inline");
    const workspaceButton = getLastGroupedRuleBlock(
      /\.mobile-topbar__workspace-button\s*\{([^}]*)\}/g
    );
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
    const rowSelected = getLastRuleBlock('.mobile-select-sheet__item-row[data-selected="true"]');
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

  it("keeps git panel sections stretched to the parent width with a full-width toggle hit area", () => {
    const section = getLastGroupedRuleBlock(
      /\.git-panel-section,\s*\.git-panel-section-header,\s*\.git-panel-section-body\s*\{([^}]*)\}/g
    );
    const toggle = getLastRuleBlock(".git-panel-section-toggle");
    const desktopPanel = getLastRuleBlock(".git-panel--desktop");

    expect(section).toContain("min-width: 0");
    expect(section).toContain("width: 100%");
    expect(toggle).toContain("display: flex");
    expect(toggle).toContain("flex: 1 1 auto");
    expect(toggle).toContain("width: 100%");
    expect(toggle).toContain("justify-content: flex-start");
    expect(desktopPanel).toContain("width: 100%");
  });

  it("keeps session header badges on a single line by truncating the title first", () => {
    const titleRow = getLastRuleBlock(".mobile-shell__agent-stage .session-title-row");
    const title = getLastRuleBlock(".mobile-shell__agent-stage .session-title");
    const badges = getLastGroupedRuleBlock(
      /\.mobile-shell__agent-stage \.session-provider-badge,\s*\.mobile-shell__agent-stage \.session-state-badge\s*\{([^}]*)\}/g
    );

    expect(titleRow).toContain("flex-wrap: nowrap");
    expect(title).toContain("overflow: hidden");
    expect(title).toContain("text-overflow: ellipsis");
    expect(title).toContain("white-space: nowrap");
    expect(badges).toContain("flex-shrink: 0");
    expect(badges).toContain("max-width: 100%");
  });

  it("keeps supervisor entry icons and labels vertically centered", () => {
    const desktopButton = getLastRuleBlock(".supervisor-enable-btn");
    const desktopButtonIcon = getLastRuleBlock(".supervisor-enable-btn > svg");
    const desktopButtonLabel = getLastRuleBlock(".supervisor-enable-btn > span");
    const mobileBadge = getLastGroupedRuleBlock(
      /\.mobile-supervisor-badge\s*\{([^}]*justify-content:[^}]*)\}/g
    );
    const mobileBadgeIcon = getLastRuleBlock(".mobile-supervisor-badge__icon");
    const mobileBadgeIconSvg = getLastRuleBlock(".mobile-supervisor-badge__icon svg");
    const mobileBadgeLabel = getLastRuleBlock(".mobile-supervisor-badge__label");

    expect(desktopButton).toContain("justify-content: center");
    expect(desktopButton).toContain("line-height: 1");
    expect(desktopButtonIcon).toContain("display: block");
    expect(desktopButtonLabel).toContain("display: inline-flex");
    expect(desktopButtonLabel).toContain("align-items: center");
    expect(mobileBadge).toContain("justify-content: center");
    expect(mobileBadge).toContain("line-height: 1");
    expect(mobileBadgeIcon).toContain("display: inline-flex");
    expect(mobileBadgeIcon).toContain("align-items: center");
    expect(mobileBadgeIconSvg).toContain("display: block");
    expect(mobileBadgeLabel).toContain("display: inline-flex");
    expect(mobileBadgeLabel).toContain("align-items: center");
    expect(mobileBadgeLabel).toContain("line-height: 1");
  });

  it("keeps the mobile terminal keybar flow-positioned and token-driven", () => {
    const shell = getLastRuleBlock(".xterm-host-shell");
    const shellWithMobileInput = getLastRuleBlock(".xterm-host-shell--mobile-input");
    const host = getLastRuleBlock(".xterm-host");
    const keybar = getLastRuleBlock(".mobile-terminal-input-bar");
    const keys = getLastRuleBlock(".mobile-terminal-input-bar__keys");
    const key = getLastRuleBlock(".mobile-terminal-input-bar__key");
    const ctrlLocked = getLastRuleBlock(
      '.mobile-terminal-input-bar__ctrl[data-ctrl-mode="locked"]'
    );
    const shiftArmed = getLastRuleBlock(
      '.mobile-terminal-input-bar__shift[data-shift-armed="true"]'
    );

    expect(shell).toContain("display: flex");
    expect(shell).toContain("flex-direction: column");
    expect(shell).toContain("min-height: 0");
    expect(shellWithMobileInput).toContain("gap: var(--sp-1)");
    expect(host).toContain("position: relative");
    expect(host).toContain("flex: 1 1 auto");
    expect(host).toContain("min-height: 0");
    expect(keybar).toContain("flex-shrink: 0");
    expect(keybar).not.toContain("position: absolute");
    expect(keybar).toContain("min-width: 0");
    expect(keybar).toContain("padding:");
    expect(keys).toContain("display: flex");
    expect(keys).toContain("overflow: hidden");
    expect(key).toContain("min-height: 28px");
    expect(key).toContain("flex: 1 1 0");
    expect(key).toContain("var(--bg-surface)");
    expect(ctrlLocked).toContain("var(--accent-blue)");
    expect(shiftArmed).toContain("var(--accent-blue)");
  });

  it("keeps the supervisor timeout setting aligned as a label-left control-right row", () => {
    const inlineField = getLastRuleBlock(".settings-config-field--inline");
    const inlineLabel = getLastRuleBlock(".settings-config-field--inline .settings-config-label");
    const control = getLastRuleBlock(".settings-config-control");
    const compactInput = getLastRuleBlock(".settings-input-compact");

    expect(inlineField).toContain("display: grid");
    expect(inlineField).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(inlineField).toContain("align-items: center");
    expect(inlineLabel).toContain("margin-bottom: 0");
    expect(control).toContain("justify-content: flex-end");
    expect(compactInput).toContain("text-align: right");
  });
});
