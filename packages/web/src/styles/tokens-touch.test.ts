// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(`${process.cwd()}/src/styles/tokens.css`, "utf8");

function getRuleBlock(selector: string): string {
  const blocks: string[] = [];
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(stylesheet)) !== null) {
    const selectors = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((part) => part.trim());

    if (selectors.length === 1 && selectors[0] === selector) {
      blocks.push(match[2]);
      continue;
    }

    if (selectors.includes(selector)) {
      blocks.push(match[2]);
    }
  }

  return blocks.join("\n");
}

function getCustomProperty(block: string, name: string): string | null {
  const matcher = new RegExp(`${name}:\\s*([^;]+);`, "g");
  let value: string | null = null;
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(block)) !== null) {
    value = match[1]?.trim() ?? null;
  }

  return value;
}

describe("tokens.css touch tokens", () => {
  const builtInThemes = [
    "mint-dark",
    "mint-light",
    "graphite-dark",
    "graphite-light",
    "nord-dark",
    "nord-light",
    "hc-dark",
    "hc-light",
  ] as const;

  const requiredIconTokens = [
    "--icon-primary",
    "--icon-secondary",
    "--icon-muted",
    "--icon-accent",
    "--icon-success",
    "--icon-warning",
    "--icon-error",
    "--icon-info",
    "--icon-file-folder",
    "--icon-git-deleted",
    "--icon-surface-subtle",
    "--icon-surface-error",
  ] as const;

  const domainLayerTokens = [
    "--git-status-added-fg",
    "--git-status-added-bg",
    "--git-status-added-border",
    "--git-status-modified-fg",
    "--git-status-modified-bg",
    "--git-status-modified-border",
    "--git-status-deleted-fg",
    "--git-status-deleted-bg",
    "--git-status-deleted-border",
    "--git-status-untracked-fg",
    "--git-status-untracked-bg",
    "--git-status-untracked-border",
    "--git-status-renamed-fg",
    "--git-status-renamed-bg",
    "--git-status-renamed-border",
    "--diff-added-bg",
    "--diff-added-border",
    "--diff-modified-bg",
    "--diff-modified-border",
    "--diff-deleted-bg",
    "--diff-deleted-border",
    "--control-primary-bg",
    "--control-primary-bg-hover",
    "--control-primary-fg",
    "--control-secondary-bg",
    "--control-secondary-bg-hover",
    "--control-secondary-border",
    "--control-secondary-border-hover",
    "--control-ghost-bg-hover",
    "--control-ghost-fg",
    "--control-danger-bg",
    "--control-danger-fg",
    "--control-spinner-track",
    "--field-bg",
    "--field-border",
    "--field-border-hover",
    "--field-ring",
    "--field-invalid-ring",
    "--kbd-surface",
    "--menu-danger-hover-bg",
    "--tag-info-bg",
    "--tag-info-fg",
    "--tag-success-bg",
    "--tag-success-fg",
    "--tag-warning-bg",
    "--tag-warning-fg",
    "--tag-danger-bg",
    "--tag-danger-fg",
    "--tag-accent-bg",
    "--tag-accent-fg",
    "--status-dot-idle",
    "--status-dot-starting",
    "--status-dot-running",
    "--status-dot-complete",
    "--status-dot-error",
    "--status-dot-running-ring-1",
    "--status-dot-running-ring-2",
    "--status-dot-running-ring-3",
  ] as const;

  const legacyMigrationAliases = [
    "--bg-page",
    "--bg-panel",
    "--bg-elevated",
    "--accent-blue",
    "--accent-green",
    "--accent-amber",
    "--color-success",
    "--color-warning",
    "--color-error",
    "--color-info",
    "--ws-sidebar-bg",
    "--ws-editor-toolbar-bg",
  ] as const;

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

  it("defines the semantic color system layers on :root", () => {
    const root = getRuleBlock(":root");

    expect(root).toContain("--ref-fg-0:");
    expect(root).toContain("--ref-bg-0:");
    expect(root).toContain("--ref-border-0:");
    expect(root).toContain("--ref-status-success:");
    expect(root).toContain("--text-primary: var(--ref-fg-0)");
    expect(root).toContain("--surface-page: var(--ref-bg-0)");
    expect(root).toContain("--border-default: var(--ref-border-0)");
    expect(root).toContain("--status-success-fg: var(--ref-status-success)");
    expect(root).toContain("--material-panel:");
    expect(root).toContain("--material-overlay:");
    expect(root).toContain("--material-backdrop-filter:");
    expect(root).toContain("--workspace-sidebar-surface:");
    expect(root).toContain("--workspace-editor-toolbar-surface:");
    expect(root).toContain("--git-status-added-bg:");
    expect(root).toContain("--diff-added-bg:");
    expect(root).toContain("--icon-primary:");
    expect(root).toContain("--control-primary-bg:");
    expect(root).toContain("--field-ring:");
    expect(root).toContain("--tag-info-bg:");
    expect(root).toContain("--status-dot-running-ring-2:");

    for (const token of domainLayerTokens) {
      expect(getCustomProperty(root, token), `:root should define ${token}`).not.toBeNull();
    }
  });

  it("keeps temporary legacy aliases inside tokens.css only during migration", () => {
    const root = getRuleBlock(":root");

    expect(root).toContain("--bg-page: var(--surface-page)");
    expect(root).toContain("--accent-blue: var(--status-info-fg)");
    expect(root).toContain("--color-error: var(--status-danger-fg)");
    expect(root).toContain("--ws-sidebar-bg: var(--workspace-sidebar-surface)");

    for (const token of legacyMigrationAliases) {
      expect(
        getCustomProperty(root, token),
        `:root should keep migration alias ${token}`
      ).not.toBeNull();
    }
  });

  it("defines the shared foundation tokens on :root without changing code font-size plumbing", () => {
    const root = getRuleBlock(":root");

    expect(root).toContain("--control-height-sm: 28px");
    expect(root).toContain("--control-height-md: 32px");
    expect(root).toContain("--control-height-lg: 40px");
    expect(root).toContain("--icon-button-size-sm: 28px");
    expect(root).toContain("--icon-button-size-md: 32px");
    expect(root).toContain("--icon-button-size-lg: 40px");
    expect(root).toContain("--list-row-height-compact: 32px");
    expect(root).toContain("--list-row-height-regular: 40px");
    expect(root).toContain("--toolbar-height-compact: 32px");
    expect(root).toContain("--toolbar-height-regular: 40px");
    expect(root).toContain("--panel-header-height: 40px");

    expect(root).toContain("--state-focus-ring-color: var(--border-focus)");
    expect(root).toContain("--state-focus-ring-width: 2px");
    expect(root).toContain("--state-hover-bg-subtle: var(--bg-hover)");
    expect(root).toContain("--state-hover-bg-strong: var(--bg-active)");
    expect(root).toContain("--state-selected-bg:");
    expect(root).toContain("--state-disabled-bg:");
    expect(root).toContain("--state-success-bg:");
    expect(root).toContain("--state-warning-bg:");
    expect(root).toContain("--state-error-bg:");
    expect(root).toContain("--state-info-bg:");

    expect(root).toContain("--gap-hairline:");
    expect(root).toContain("--gap-micro:");
    expect(root).toContain("--gap-compact:");
    expect(root).toContain("--gap-tight:");
    expect(root).toContain("--gap-control:");
    expect(root).toContain("--gap-default:");
    expect(root).toContain("--gap-content:");
    expect(root).toContain("--gap-panel:");
    expect(root).toContain("--gap-section:");
    expect(root).toContain("--space-micro:");
    expect(root).toContain("--space-inline:");
    expect(root).toContain("--space-default:");
    expect(root).toContain("--space-content:");
    expect(root).toContain("--space-block:");
    expect(root).toContain("--space-panel:");
    expect(root).toContain("--space-section:");
    expect(root).toContain("--inset-control-inline:");
    expect(root).toContain("--inset-control-block:");
    expect(root).toContain("--inset-row-inline:");
    expect(root).toContain("--inset-row-block:");
    expect(root).toContain("--inset-chip-block:");
    expect(root).toContain("--inset-chip-inline:");
    expect(root).toContain("--inset-panel:");
    expect(root).toContain("--inset-dialog:");
    expect(getCustomProperty(root, "--inset-control-inline")).toBe("var(--sp-3)");
    expect(getCustomProperty(root, "--inset-control-block")).toBe("var(--sp-2)");
    expect(getCustomProperty(root, "--inset-row-inline")).toBe("var(--sp-4)");
    expect(getCustomProperty(root, "--inset-row-block")).toBe("var(--sp-2)");
    expect(getCustomProperty(root, "--inset-chip-block")).toBe("var(--sp-1)");
    expect(getCustomProperty(root, "--inset-chip-inline")).toBe("var(--sp-2)");
    expect(getCustomProperty(root, "--inset-panel")).toBe("var(--sp-4)");
    expect(getCustomProperty(root, "--inset-dialog")).toBe("var(--sp-6)");

    expect(root).toContain("--surface-page-bg:");
    expect(root).toContain("--surface-panel-bg:");
    expect(root).toContain("--surface-elevated-bg:");
    expect(root).toContain("--surface-overlay-bg:");
    expect(root).toContain("--surface-overlay-border:");
    expect(root).toContain("--surface-overlay-shadow:");
    expect(root).toContain("--surface-overlay-backdrop:");
    expect(root).toContain("--surface-sticky-bg:");
    expect(root).toContain("--overlay-width-sm:");
    expect(root).toContain("--overlay-width-md:");
    expect(root).toContain("--overlay-width-lg:");
    expect(root).toContain("--overlay-backdrop-opacity:");
    expect(root).toContain("--z-inline:");
    expect(root).toContain("--z-inline-raised:");

    expect(root).toContain("--radius-control:");
    expect(root).toContain("--radius-control-sm:");
    expect(root).toContain("--radius-control-lg:");
    expect(root).toContain("--radius-chip:");
    expect(root).toContain("--radius-tag:");
    expect(root).toContain("--radius-pill:");
    expect(root).toContain("--radius-panel:");
    expect(root).toContain("--radius-overlay:");
    expect(root).toContain("--radius-local-overlay:");
    expect(root).toContain("--radius-flush:");
    expect(getCustomProperty(root, "--radius-sm")).toBe("2px");
    expect(getCustomProperty(root, "--radius-md")).toBe("4px");
    expect(getCustomProperty(root, "--radius-lg")).toBe("6px");
    expect(getCustomProperty(root, "--radius-xl")).toBe("8px");
    expect(getCustomProperty(root, "--radius-full")).toBe("9999px");

    expect(root).toContain("--terminal-panel-inset:");
    expect(getCustomProperty(root, "--terminal-panel-inset")).toBe("2px");
    expect(root).toContain("--terminal-toolbar-gap:");
    expect(root).toContain("--terminal-local-overlay-radius:");
    expect(getCustomProperty(root, "--terminal-local-overlay-radius")).toBe("2px");
    expect(root).toContain("--terminal-state-running-bg:");
    expect(root).toContain("--terminal-state-running-border:");
    expect(root).toContain("--terminal-state-running-text:");
    expect(root).toContain("--terminal-state-reconnecting-bg:");
    expect(root).toContain("--terminal-state-reconnecting-border:");
    expect(root).toContain("--terminal-state-failed-bg:");
    expect(root).toContain("--terminal-state-failed-border:");
    expect(root).toContain("--session-card-gap:");
    expect(root).toContain("--session-row-gap:");
    expect(root).toContain("--session-state-radius:");
    expect(root).toContain("--editor-pane-inset:");
    expect(root).toContain("--editor-toolbar-inset:");
    expect(root).toContain("--editor-peek-radius:");
    expect(root).toContain("--editor-selection-bg:");
    expect(root).toContain("--editor-selection-inactive-bg:");
    expect(root).toContain("--editor-diagnostic-warning-bg:");
    expect(root).toContain("--editor-diagnostic-error-bg:");
    expect(root).toContain("--diff-section-gap:");
    expect(root).toContain("--diff-thread-inset:");
    expect(root).toContain("--diff-thread-radius:");
    expect(root).toContain("--diff-add-bg:");
    expect(root).toContain("--diff-modify-bg:");
    expect(root).toContain("--diff-delete-bg:");

    expect(getCustomProperty(root, "--terminal-font-size")).toBe("11px");
    expect(getCustomProperty(root, "--terminal-line-height")).toBe("1.6");
  });

  it("defines workspace material tokens for solid and glass workspace surfaces", () => {
    const root = getRuleBlock(":root");

    expect(root).toContain("--material-backdrop-filter: none");
    expect(root).toContain("--material-panel: var(--surface-panel)");
    expect(root).toContain("--material-elevated: var(--surface-elevated)");
    expect(root).toContain("--material-overlay:");
    expect(root).toContain("--material-local-overlay:");
    expect(root).toContain("--workspace-sidebar-surface: var(--surface-panel)");
    expect(root).toContain("--workspace-terminal-shell-surface: var(--surface-panel)");
    expect(root).toContain("--workspace-editor-toolbar-surface: var(--surface-elevated)");

    expect(root).toContain("--ws-backdrop-filter: none");
    expect(root).toContain("--ws-content-bg: transparent");
    expect(root).toContain("--ws-sidebar-bg: var(--surface-panel-bg)");
    expect(root).toContain("--ws-terminal-shell-bg: var(--surface-panel-bg)");
    expect(root).toContain("--ws-editor-toolbar-bg: var(--surface-elevated-bg)");
    expect(root).toContain("--ws-level-0: transparent");
    expect(root).toContain("--ws-level-1: color-mix(");
    expect(root).toContain("--ws-level-4: color-mix(");
  });

  it("keeps the glass/high-contrast material outputs in the token layer", () => {
    const glassRoot = getRuleBlock(':root[data-appearance-glass="on"]');
    const highContrastDark = getRuleBlock(':root[data-theme="hc-dark"]');
    expect(glassRoot).toContain(
      "--material-backdrop-filter: var(--app-surface-backdrop-filter, none)"
    );
    expect(glassRoot).toContain("--material-panel: color-mix(");
    expect(glassRoot).toContain("--workspace-sidebar-surface: var(--material-elevated)");
    expect(glassRoot).toContain("--workspace-terminal-shell-surface: var(--material-elevated)");

    expect(highContrastDark).toContain("--material-backdrop-filter: none");
    expect(highContrastDark).toContain("--material-panel: var(--surface-panel)");
    expect(highContrastDark).toContain("--workspace-sidebar-surface: var(--surface-panel)");
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

  it("defines the 12-role typography contract on :root", () => {
    const root = getRuleBlock(":root");

    expect(root).toContain("--type-heading-1-size: 28px");
    expect(root).toContain("--type-heading-1-line-height: 1.1");
    expect(root).toContain("--type-heading-1-weight: var(--font-semibold)");
    expect(root).toContain("--type-heading-2-size: 24px");
    expect(root).toContain("--type-heading-2-line-height: 1.15");
    expect(root).toContain("--type-heading-2-weight: var(--font-semibold)");
    expect(root).toContain("--type-heading-3-size: 20px");
    expect(root).toContain("--type-heading-3-line-height: 1.2");
    expect(root).toContain("--type-heading-3-weight: var(--font-semibold)");
    expect(root).toContain("--type-heading-4-size: 18px");
    expect(root).toContain("--type-heading-4-line-height: 1.25");
    expect(root).toContain("--type-heading-4-weight: var(--font-normal)");
    expect(root).toContain("--type-heading-5-size: 16px");
    expect(root).toContain("--type-heading-5-line-height: 1.3");
    expect(root).toContain("--type-heading-5-weight: var(--font-normal)");
    expect(root).toContain("--type-heading-6-size: 14px");
    expect(root).toContain("--type-heading-6-line-height: 1.35");
    expect(root).toContain("--type-heading-6-weight: var(--font-normal)");

    expect(root).toContain("--type-body-1-size: 18px");
    expect(root).toContain("--type-body-1-line-height: 1.6");
    expect(root).toContain("--type-body-1-weight: var(--font-normal)");
    expect(root).toContain("--type-body-2-size: 16px");
    expect(root).toContain("--type-body-2-line-height: 1.6");
    expect(root).toContain("--type-body-2-weight: var(--font-normal)");
    expect(root).toContain("--type-body-3-size: 14px");
    expect(root).toContain("--type-body-3-line-height: 1.6");
    expect(root).toContain("--type-body-3-weight: var(--font-normal)");
    expect(root).toContain("--type-body-4-size: 13px");
    expect(root).toContain("--type-body-4-line-height: 1.5");
    expect(root).toContain("--type-body-4-weight: var(--font-normal)");
    expect(root).toContain("--type-body-5-size: 12px");
    expect(root).toContain("--type-body-5-line-height: 1.45");
    expect(root).toContain("--type-body-5-weight: var(--font-normal)");
    expect(root).toContain("--type-body-6-size: 11px");
    expect(root).toContain("--type-body-6-line-height: 1.4");
    expect(root).toContain("--type-body-6-weight: var(--font-normal)");
  });

  it("does not keep legacy typography alias definitions on :root", () => {
    const root = getRuleBlock(":root");

    expect(root).not.toContain("--type-kicker-size:");
    expect(root).not.toContain("--type-kicker-line-height:");
    expect(root).not.toContain("--type-kicker-weight:");
    expect(root).not.toContain("--type-kicker-letter-spacing:");
    expect(root).not.toContain("--type-label-size:");
    expect(root).not.toContain("--type-label-line-height:");
    expect(root).not.toContain("--type-label-weight:");
    expect(root).not.toContain("--type-meta-size:");
    expect(root).not.toContain("--type-meta-line-height:");
    expect(root).not.toContain("--type-meta-weight:");
    expect(root).not.toContain("--type-body-size:");
    expect(root).not.toContain("--type-body-line-height:");
    expect(root).not.toContain("--type-body-weight:");
    expect(root).not.toContain("--type-body-strong-size:");
    expect(root).not.toContain("--type-body-strong-line-height:");
    expect(root).not.toContain("--type-body-strong-weight:");
    expect(root).not.toContain("--type-code-inline-size:");
    expect(root).not.toContain("--type-code-inline-line-height:");
    expect(root).not.toContain("--type-code-inline-weight:");
    expect(root).not.toContain("--type-code-inline-family:");
    expect(root).not.toContain("--type-app-title-size:");
    expect(root).not.toContain("--type-app-title-line-height:");
    expect(root).not.toContain("--type-app-title-weight:");
    expect(root).not.toContain("--type-section-title-size:");
    expect(root).not.toContain("--type-section-title-line-height:");
    expect(root).not.toContain("--type-section-title-weight:");
    expect(root).not.toContain("--type-page-title-size:");
    expect(root).not.toContain("--type-page-title-line-height:");
    expect(root).not.toContain("--type-page-title-weight:");
    expect(root).not.toContain("--type-display-size:");
    expect(root).not.toContain("--type-display-line-height:");
    expect(root).not.toContain("--type-display-weight:");
    expect(root).not.toContain("--type-display-letter-spacing:");
  });

  it("keeps typography roles unchanged in the mobile override block", () => {
    const mediaMatch = /@media\s*\(max-width:\s*899px\)\s*\{([\s\S]*?)\}\s*\}/m.exec(stylesheet);

    expect(mediaMatch, "expected @media (max-width: 899px) block").not.toBeNull();

    const body = mediaMatch![1];

    expect(body).not.toContain("--font-size-100:");
    expect(body).not.toContain("--font-size-200:");
    expect(body).not.toContain("--font-size-300:");
    expect(body).not.toContain("--font-size-400:");
    expect(body).not.toContain("--font-size-500:");
    expect(body).not.toContain("--font-size-600:");
    expect(body).not.toContain("--font-size-700:");
    expect(body).not.toContain("--type-heading-1-size:");
    expect(body).not.toContain("--type-heading-2-size:");
    expect(body).not.toContain("--type-heading-3-size:");
    expect(body).not.toContain("--type-heading-4-size:");
    expect(body).not.toContain("--type-heading-5-size:");
    expect(body).not.toContain("--type-heading-6-size:");
    expect(body).not.toContain("--type-body-1-size:");
    expect(body).not.toContain("--type-body-2-size:");
    expect(body).not.toContain("--type-body-3-size:");
    expect(body).not.toContain("--type-body-4-size:");
    expect(body).not.toContain("--type-body-5-size:");
    expect(body).not.toContain("--type-body-6-size:");
  });

  it("keeps the light theme families visually separated through structure tokens", () => {
    const mintLight = getRuleBlock('[data-theme="mint-light"]');
    const graphiteLight = getRuleBlock('[data-theme="graphite-light"]');
    const nordLight = getRuleBlock('[data-theme="nord-light"]');

    expect(getCustomProperty(mintLight, "--ref-bg-0")).toBe("#f3fbf7");
    expect(getCustomProperty(mintLight, "--ref-bg-2")).toBe("#edf7f2");
    expect(getCustomProperty(mintLight, "--ref-border-focus")).toBe("#158f77");

    expect(getCustomProperty(graphiteLight, "--ref-bg-0")).toBe("#e7edf3");
    expect(getCustomProperty(graphiteLight, "--ref-bg-2")).toBe("#dfe6ee");
    expect(getCustomProperty(graphiteLight, "--ref-border-focus")).toBe("#315fdd");

    expect(getCustomProperty(nordLight, "--ref-bg-0")).toBe("#e3ebf4");
    expect(getCustomProperty(nordLight, "--ref-bg-2")).toBe("#dbe4ef");
    expect(getCustomProperty(nordLight, "--ref-border-focus")).toBe("#5b7fa8");
  });

  it("separates the light theme interaction palette across families", () => {
    const mintLight = getRuleBlock('[data-theme="mint-light"]');
    const graphiteLight = getRuleBlock('[data-theme="graphite-light"]');
    const nordLight = getRuleBlock('[data-theme="nord-light"]');

    expect(getCustomProperty(mintLight, "--ref-fg-1")).toBe("#557067");
    expect(getCustomProperty(mintLight, "--ref-status-info")).toBe("#148a7a");
    expect(getCustomProperty(mintLight, "--shadow-glow")).toBe("0 0 12px rgba(21, 143, 119, 0.18)");

    expect(getCustomProperty(graphiteLight, "--ref-fg-1")).toBe("#4d5b6a");
    expect(getCustomProperty(graphiteLight, "--ref-status-info")).toBe("#315fdd");
    expect(getCustomProperty(graphiteLight, "--shadow-glow")).toBe(
      "0 0 12px rgba(49, 95, 221, 0.16)"
    );

    expect(getCustomProperty(nordLight, "--ref-fg-1")).toBe("#4d5a6f");
    expect(getCustomProperty(nordLight, "--ref-status-info")).toBe("#5b7fa8");
    expect(getCustomProperty(nordLight, "--shadow-glow")).toBe("0 0 12px rgba(91, 127, 168, 0.18)");
  });

  it("defines required icon tokens for every built-in theme", () => {
    for (const theme of builtInThemes) {
      const block = getRuleBlock(`[data-theme="${theme}"]`);

      for (const token of requiredIconTokens) {
        expect(getCustomProperty(block, token), `${theme} should define ${token}`).not.toBeNull();
      }
    }
  });

  it("mirrors the layered token schema in every theme selector", () => {
    for (const theme of builtInThemes) {
      const block = getRuleBlock(`[data-theme="${theme}"]`);

      expect(
        getCustomProperty(block, "--ref-fg-0"),
        `${theme} should define --ref-fg-0`
      ).not.toBeNull();
      expect(
        getCustomProperty(block, "--surface-page"),
        `${theme} should define --surface-page`
      ).not.toBeNull();
      expect(
        getCustomProperty(block, "--status-info-fg"),
        `${theme} should define --status-info-fg`
      ).not.toBeNull();
      expect(
        getCustomProperty(block, "--material-panel"),
        `${theme} should define --material-panel`
      ).not.toBeNull();
      expect(
        getCustomProperty(block, "--workspace-sidebar-surface"),
        `${theme} should define --workspace-sidebar-surface`
      ).not.toBeNull();
      expect(
        getCustomProperty(block, "--control-primary-bg"),
        `${theme} should define --control-primary-bg`
      ).not.toBeNull();
      expect(
        getCustomProperty(block, "--field-ring"),
        `${theme} should define --field-ring`
      ).not.toBeNull();
      expect(
        getCustomProperty(block, "--tag-info-bg"),
        `${theme} should define --tag-info-bg`
      ).not.toBeNull();
      expect(
        getCustomProperty(block, "--status-dot-running-ring-2"),
        `${theme} should define --status-dot-running-ring-2`
      ).not.toBeNull();
    }
  });

  it("keeps actively themed foundation roles and shared defaults visible in theme blocks", () => {
    const mintDark = getRuleBlock('[data-theme="mint-dark"]');
    const graphiteLight = getRuleBlock('[data-theme="graphite-light"]');

    expect(getCustomProperty(mintDark, "--state-focus-ring-color")).not.toBe(
      getCustomProperty(graphiteLight, "--state-focus-ring-color")
    );
    expect(getCustomProperty(mintDark, "--surface-overlay-bg")).not.toBe(
      getCustomProperty(graphiteLight, "--surface-overlay-bg")
    );
    expect(getCustomProperty(mintDark, "--radius-overlay")).toBe(
      getCustomProperty(graphiteLight, "--radius-overlay")
    );
    expect(getCustomProperty(mintDark, "--gap-content")).toBe(
      getCustomProperty(graphiteLight, "--gap-content")
    );
  });

  it("keeps light-theme icon tokens visually distinct across families", () => {
    const mintLight = getRuleBlock('[data-theme="mint-light"]');
    const graphiteLight = getRuleBlock('[data-theme="graphite-light"]');
    const nordLight = getRuleBlock('[data-theme="nord-light"]');

    expect(getCustomProperty(mintLight, "--icon-file-folder")).not.toBe(
      getCustomProperty(graphiteLight, "--icon-file-folder")
    );
    expect(getCustomProperty(graphiteLight, "--icon-accent")).not.toBe(
      getCustomProperty(nordLight, "--icon-accent")
    );
  });
});
