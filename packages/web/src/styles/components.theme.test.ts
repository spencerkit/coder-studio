// @vitest-environment node
import { readFileSync } from "node:fs";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const baseStylesheet = readFileSync(`${process.cwd()}/src/styles/base.css`, "utf8");
const stylesheet = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");
const tokensStylesheet = readFileSync(`${process.cwd()}/src/styles/tokens.css`, "utf8");
const segmentedControlStylesheet = readFileSync(
  `${process.cwd()}/src/components/ui/segmented-control/index.module.css`,
  "utf8"
);
const kbdStylesheet = readFileSync(
  `${process.cwd()}/src/components/ui/kbd/index.module.css`,
  "utf8"
);
const pillStylesheet = readFileSync(
  `${process.cwd()}/src/components/ui/pill/index.module.css`,
  "utf8"
);
const tagStyles = readFileSync(`${process.cwd()}/src/components/ui/tag/index.module.css`, "utf8");
const badgeStyles = readFileSync(
  `${process.cwd()}/src/components/ui/badge/index.module.css`,
  "utf8"
);
const tooltipStyles = readFileSync(
  `${process.cwd()}/src/components/ui/tooltip/index.module.css`,
  "utf8"
);
const noticeStylesheet = readFileSync(
  `${process.cwd()}/src/components/ui/notice/index.module.css`,
  "utf8"
);
const modalStyles = readFileSync(
  `${process.cwd()}/src/components/ui/modal/index.module.css`,
  "utf8"
);
const emptyStateStyles = readFileSync(
  `${process.cwd()}/src/components/ui/empty-state/index.module.css`,
  "utf8"
);
const toastStyles = readFileSync(
  `${process.cwd()}/src/components/ui/toast/index.module.css`,
  "utf8"
);
const confirmDialogStyles = readFileSync(
  `${process.cwd()}/src/components/ui/confirm-dialog/index.module.css`,
  "utf8"
);
const buttonStyles = readFileSync(
  `${process.cwd()}/src/components/ui/button/index.module.css`,
  "utf8"
);
const inputStyles = readFileSync(
  `${process.cwd()}/src/components/ui/input/index.module.css`,
  "utf8"
);
const textareaStyles = readFileSync(
  `${process.cwd()}/src/components/ui/textarea/index.module.css`,
  "utf8"
);
const tabsStyles = readFileSync(`${process.cwd()}/src/components/ui/tabs/index.module.css`, "utf8");

function getLastGroupedRuleBlockFrom(source: string, pattern: RegExp) {
  const matches = Array.from(source.matchAll(pattern));
  const match = matches.at(-1);

  expect(match, `expected CSS rule matching ${pattern}`).toBeTruthy();
  return match?.[1] ?? "";
}

function getLastGroupedRuleBlock(pattern: RegExp) {
  return getLastGroupedRuleBlockFrom(stylesheet, pattern);
}

function getLastRuleBlockFrom(source: string, selector: string) {
  return getRuleBlocksFrom(source, selector).at(-1) ?? "";
}

function getRuleBlocksFrom(source: string, selector: string) {
  const blocks: string[] = [];
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null = null;
  const normalizedSelector = selector.replace(/\s+/g, " ").trim();

  while ((match = matcher.exec(source))) {
    const selectors = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((entry) => entry.replace(/\s+/g, " ").trim());

    if (selectors.includes(normalizedSelector)) {
      blocks.push(match[2]);
    }
  }

  expect(blocks.length, `expected CSS rule for ${selector}`).toBeGreaterThan(0);
  return blocks;
}

function getLastRuleBlock(selector: string) {
  return getLastRuleBlockFrom(stylesheet, selector);
}

async function buildRuntimeStylesheet() {
  const output = await build({
    configFile: false,
    root: process.cwd(),
    plugins: [],
    build: {
      write: false,
      outDir: "dist-test",
      cssCodeSplit: true,
      rollupOptions: {
        input: `${process.cwd()}/src/main.tsx`,
      },
    },
    resolve: {
      alias: {
        "@": `${process.cwd()}/src`,
      },
    },
  });

  const bundle = Array.isArray(output) ? output[0] : output;
  const chunks = "output" in bundle ? bundle.output : [];
  const cssAssets = chunks.filter(
    (chunk): chunk is { type: "asset"; fileName: string; source: string | Uint8Array } =>
      chunk.type === "asset" && chunk.fileName.endsWith(".css")
  );

  expect(cssAssets.length, "expected built CSS asset").toBeGreaterThan(0);
  return cssAssets
    .map((asset) =>
      typeof asset.source === "string" ? asset.source : Buffer.from(asset.source).toString("utf8")
    )
    .join("\n");
}

describe("components.css theme-sensitive surfaces", () => {
  it("routes file tree and git status icons through icon theme tokens", () => {
    expect(getLastRuleBlock(".tree-icon")).toContain("width: 14px");
    expect(getLastRuleBlock(".tree-icon")).toContain("height: 14px");
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-file-folder")).toContain(
      "var(--icon-file-folder)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-file-code")).toContain(
      "var(--icon-file-code)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-file-data")).toContain(
      "var(--icon-file-data)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-file-doc")).toContain(
      "var(--icon-file-doc)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-file-media")).toContain(
      "var(--icon-file-media)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-file-default")).toContain(
      "var(--icon-file-default)"
    );
    expect(getLastRuleBlock(".git-row-icon")).toContain("display: inline-flex");
    expect(getLastRuleBlock(".git-row-icon")).toContain("align-items: center");
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-git-staged")).toContain(
      "var(--icon-git-staged)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-git-modified")).toContain(
      "var(--icon-git-modified)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-git-deleted")).toContain(
      "var(--icon-git-deleted)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-git-untracked")).toContain(
      "var(--icon-git-untracked)"
    );
  });

  it("routes semantic icon classes through icon tokens", () => {
    expect(getLastRuleBlock(".settings-mobile-item__icon")).toContain("var(--icon-secondary)");
    expect(getLastRuleBlock(".settings-nav-icon")).toContain("var(--icon-secondary)");
    expect(getLastRuleBlock(".terminal-panel-empty-icon")).toContain("var(--icon-muted)");
    expect(getLastRuleBlock(".bottom-terminal-empty-icon")).toContain("width: 32px");
    expect(getLastRuleBlock(".bottom-terminal-empty-icon")).toContain("opacity: 0.45");
    expect(getLastRuleBlock(".config-empty-icon")).toContain("width: 24px");
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-muted")).toContain(
      "var(--icon-muted)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-warning")).toContain(
      "var(--icon-warning)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-success")).toContain(
      "var(--icon-success)"
    );
  });

  it("keeps icon surfaces on dedicated icon surface tokens", () => {
    const accentSurfaceBlocks = getRuleBlocksFrom(baseStylesheet, ".themed-icon--surface-accent");
    const subtleSurfaceBlocks = getRuleBlocksFrom(baseStylesheet, ".themed-icon--surface-subtle");
    const warningSurfaceBlocks = getRuleBlocksFrom(baseStylesheet, ".themed-icon--surface-warning");
    const successSurfaceBlocks = getRuleBlocksFrom(baseStylesheet, ".themed-icon--surface-success");

    expect(getLastRuleBlock(".welcome-feature-icon")).toContain("width: 32px");
    expect(getLastRuleBlock(".welcome-feature-icon")).toContain("height: 32px");
    expect(getLastRuleBlock(".config-empty-icon")).toContain("margin-bottom: var(--sp-2)");
    expect(getLastRuleBlock(".tree-icon")).toContain("color: var(--text-tertiary)");
    expect(getLastRuleBlock(".supervisor-danger-callout")).toContain("var(--icon-surface-error)");
    expect(
      accentSurfaceBlocks.some((block) => block.includes("background: var(--icon-surface-accent)"))
    ).toBe(true);
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-accent")).toContain(
      "var(--icon-accent)"
    );
    expect(
      subtleSurfaceBlocks.some((block) => block.includes("background: var(--icon-surface-subtle)"))
    ).toBe(true);
    expect(
      warningSurfaceBlocks.some((block) =>
        block.includes("background: var(--icon-surface-warning)")
      )
    ).toBe(true);
    expect(
      successSurfaceBlocks.some((block) =>
        block.includes("background: var(--icon-surface-success)")
      )
    ).toBe(true);
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-error")).toContain(
      "var(--icon-error)"
    );
  });

  it("keeps mobile icon intent scoped correctly", () => {
    expect(getLastRuleBlock(".mobile-dock__icon")).toContain("color: currentColor");
  });

  it("keeps toast icons on icon semantic tokens instead of raw status colors", () => {
    expect(getLastRuleBlock(".toast__icon")).toContain("display: inline-flex");
    expect(getLastRuleBlock(".toast__icon-symbol")).toContain("width: 20px");
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-success")).toContain(
      "var(--icon-success)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-error")).toContain(
      "var(--icon-error)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-warning")).toContain(
      "var(--icon-warning)"
    );
    expect(getLastRuleBlockFrom(baseStylesheet, ".themed-icon--tone-info")).toContain(
      "var(--icon-info)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".success .icon")).toContain(
      "background: var(--icon-surface-success)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".error .icon")).toContain(
      "background: var(--icon-surface-error)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".warning .icon")).toContain(
      "background: var(--icon-surface-warning)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".info .icon")).toContain(
      "background: var(--icon-surface-info)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".success .icon")).toContain("var(--icon-success)");
  });

  it("keeps confirm dialog danger icons on icon tokens", () => {
    expect(getLastRuleBlockFrom(confirmDialogStyles, ".titleDanger")).toContain(
      "var(--icon-warning)"
    );
    expect(getLastRuleBlockFrom(confirmDialogStyles, ".iconDanger")).toContain(
      "color: var(--icon-warning)"
    );
  });

  it("maps text-entry and navigation primitives onto semantic typography tokens", async () => {
    expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain(
      "font-size: var(--type-body-strong-size)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain("font-weight: var(--font-medium)");
    expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain(
      "line-height: var(--type-body-strong-line-height)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".sm")).toContain(
      "font-size: var(--type-label-size)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".sm")).toContain("font-weight: var(--font-medium)");
    expect(getLastRuleBlockFrom(buttonStyles, ".lg")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(inputStyles, ".input")).toContain(
      "font-size: var(--type-body-strong-size)"
    );
    expect(getLastRuleBlockFrom(inputStyles, ".input")).toContain(
      "font-weight: var(--type-body-strong-weight)"
    );
    expect(getLastRuleBlockFrom(inputStyles, ".sm")).toContain("font-size: var(--type-label-size)");
    expect(getLastRuleBlockFrom(inputStyles, ".sm")).toContain(
      "font-weight: var(--type-label-weight)"
    );
    expect(getLastRuleBlockFrom(inputStyles, ".lg")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(textareaStyles, ".input")).toContain(
      "font-size: var(--type-body-strong-size)"
    );
    expect(getLastRuleBlockFrom(textareaStyles, ".input")).toContain(
      "font-weight: var(--type-body-strong-weight)"
    );
    expect(getLastRuleBlockFrom(textareaStyles, ".lg")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain(
      "font-size: var(--type-label-size)"
    );
    expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain(
      "font-weight: var(--type-label-weight)"
    );
    expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain(
      "line-height: var(--type-label-line-height)"
    );
    expect(getLastRuleBlockFrom(tabsStyles, ":global(.worktree-tab)")).toContain(
      "font-size: var(--type-label-size)"
    );
    expect(getLastRuleBlockFrom(tabsStyles, ":global(.worktree-tab)")).toContain(
      "font-weight: var(--type-label-weight)"
    );

    const runtimeStylesheet = await buildRuntimeStylesheet();

    expect(getLastRuleBlockFrom(runtimeStylesheet, ".btn")).toContain(
      "font-size:var(--type-body-strong-size)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".btn")).toContain(
      "font-weight:var(--font-medium)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".btn-sm")).toContain(
      "font-size:var(--type-label-size)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".panel-tab")).toContain(
      "font-size:var(--type-label-size)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".panel-tab")).toContain(
      "font-weight:var(--type-label-weight)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".worktree-tab")).toContain(
      "font-size:var(--type-label-size)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".worktree-tab")).toContain(
      "font-weight:var(--type-label-weight)"
    );
  });

  it("maps display and status primitives onto semantic typography roles", () => {
    expect(getLastRuleBlockFrom(tagStyles, ":where(.tag)")).toContain(
      "font-size: var(--type-kicker-size)"
    );
    expect(getLastRuleBlockFrom(tagStyles, ":where(.tag)")).toContain(
      "letter-spacing: var(--type-kicker-letter-spacing)"
    );
    expect(getLastRuleBlockFrom(tagStyles, ".sm")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(badgeStyles, ":where(.badge)")).toContain(
      "font-size: var(--type-kicker-size)"
    );
    expect(getLastRuleBlockFrom(badgeStyles, ":where(.badge)")).toContain(
      "font-weight: var(--type-kicker-weight)"
    );
    expect(getLastRuleBlockFrom(pillStylesheet, ".pill")).toContain(
      "font-size: var(--type-label-size)"
    );
    expect(getLastRuleBlockFrom(pillStylesheet, ".pill")).toContain(
      "font-weight: var(--type-label-weight)"
    );
    expect(getLastRuleBlockFrom(tooltipStyles, ".tooltip")).toContain(
      "font-size: var(--type-meta-size)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".title")).toContain(
      "font-size: var(--type-kicker-size)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".message")).toContain(
      "font-size: var(--type-meta-size)"
    );
    expect(getLastRuleBlockFrom(modalStyles, ".title")).toContain(
      "font-size: var(--type-section-title-size)"
    );
    expect(getLastRuleBlockFrom(emptyStateStyles, ".title")).toContain(
      "font-size: var(--type-app-title-size)"
    );
    expect(getLastRuleBlockFrom(emptyStateStyles, ".description")).toContain(
      "font-size: var(--type-body-size)"
    );
  });

  it("keeps config status colors on icon tokens", () => {
    expect(getLastRuleBlock(".config-status--success")).toContain("var(--icon-success)");
    expect(getLastRuleBlock(".config-status--warning")).toContain("var(--icon-warning)");
    expect(getLastRuleBlock(".config-status--info")).toContain("var(--icon-info)");
    expect(getLastRuleBlock(".config-status--error")).toContain("var(--icon-error)");
  });

  it("exposes global mobile safe-area tokens so standalone mobile views keep their padding", () => {
    expect(tokensStylesheet).toContain("--mobile-safe-top: env(safe-area-inset-top, 0px);");
    expect(tokensStylesheet).toContain("--mobile-safe-right: env(safe-area-inset-right, 0px);");
    expect(tokensStylesheet).toContain("--mobile-safe-bottom: env(safe-area-inset-bottom, 0px);");
    expect(tokensStylesheet).toContain("--mobile-safe-left: env(safe-area-inset-left, 0px);");
  });

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
    const mainStage = getLastRuleBlock(".workspace-main-stage");
    const sessionTerminal = getLastRuleBlock(".session-terminal");
    const sessionCard = getLastRuleBlock(".session-card");
    const activeSessionCard = getLastRuleBlock(".session-card.session-card--active");
    const activeSessionHeader = getLastRuleBlock(
      ".session-card.session-card--active .session-header"
    );
    const activeSessionTitle = getLastRuleBlock(
      ".session-card.session-card--active .session-title"
    );
    const statusBar = getLastRuleBlock(".workspace-status-bar");
    const agentPanes = getLastRuleBlock(".workspace-main-stage > .agent-panes");
    const bottomPanel = getLastRuleBlock(".workspace-bottom-panel");
    const verticalDividerRules = getRuleBlocksFrom(stylesheet, ".split-divider-v").join("\n");
    const horizontalDividerRules = getRuleBlocksFrom(stylesheet, ".split-divider-h").join("\n");
    const verticalDividerLineRules = getRuleBlocksFrom(stylesheet, ".split-divider-v::before").join(
      "\n"
    );
    const horizontalDividerLineRules = getRuleBlocksFrom(
      stylesheet,
      ".split-divider-h::before"
    ).join("\n");
    const paneDividerBaseRules = getRuleBlocksFrom(stylesheet, ".pane-layout-divider").join("\n");
    const paneDividerLineRules = getRuleBlocksFrom(stylesheet, ".pane-layout-divider::after").join(
      "\n"
    );
    const paneDividerHorizontalRules = getRuleBlocksFrom(
      stylesheet,
      ".pane-layout-horizontal .pane-layout-divider"
    ).join("\n");
    const paneDividerVerticalRules = getRuleBlocksFrom(
      stylesheet,
      ".pane-layout-vertical .pane-layout-divider"
    ).join("\n");
    const bottomTerminalShellRules = getRuleBlocksFrom(
      stylesheet,
      ".workspace-bottom-panel > .bottom-terminal"
    ).join("\n");
    const bottomTerminalShell = getLastRuleBlock(".workspace-bottom-panel > .bottom-terminal");

    expect(topbar).toContain("var(--bg-surface)");
    expect(activeTab).toContain("var(--bg-active)");
    expect(activeTab).not.toContain("rgba(45, 63, 79, 0.92)");
    expect(emptyCard).toContain("var(--bg-surface)");
    expect(resolvingCard).toContain("var(--bg-surface)");
    expect(mainStage).toContain("flex: 1");
    expect(mainStage).toContain("min-height: 0");
    expect(mainStage).toContain("min-width: 0");
    expect(mainStage).toContain("display: flex");
    expect(mainStage).toContain("flex-direction: column");
    expect(agentPanes).toContain("flex: 1");
    expect(agentPanes).toContain("min-height: 0");
    expect(agentPanes).toContain("padding: 0");
    expect(sessionTerminal).toContain("var(--bg-terminal)");
    expect(sessionTerminal).not.toContain("rgba(11, 18, 24, 0.98)");
    expect(sessionCard).toContain("border: none");
    expect(sessionCard).not.toContain("border: 1px solid var(--border)");
    expect(activeSessionCard).toContain("background: var(--bg-active)");
    expect(activeSessionCard).toContain("box-shadow: inset 0 0 0 1px var(--border-focus)");
    expect(activeSessionHeader).toContain(
      "background: color-mix(in srgb, var(--bg-active) 88%, var(--bg-page) 12%)"
    );
    expect(activeSessionTitle).toContain("color: var(--text-primary)");
    expect(verticalDividerRules).toContain("width: 10px");
    expect(verticalDividerRules).not.toContain("width: 8px");
    expect(verticalDividerRules).toContain("margin-left: -5px");
    expect(verticalDividerRules).toContain("margin-right: -5px");
    expect(verticalDividerLineRules).toContain(
      "background: color-mix(in srgb, var(--border) 62%, transparent)"
    );
    expect(horizontalDividerRules).toContain("height: 10px");
    expect(horizontalDividerRules).not.toContain("height: 8px");
    expect(horizontalDividerRules).toContain("margin-top: -5px");
    expect(horizontalDividerRules).toContain("margin-bottom: -5px");
    expect(horizontalDividerLineRules).toContain(
      "background: color-mix(in srgb, var(--border) 62%, transparent)"
    );
    expect(paneDividerBaseRules).toContain("position: relative");
    expect(paneDividerLineRules).toContain(
      "background: color-mix(in srgb, var(--border) 62%, transparent)"
    );
    expect(paneDividerHorizontalRules).toContain("width: 10px");
    expect(paneDividerHorizontalRules).toContain("margin-left: -5px");
    expect(paneDividerHorizontalRules).toContain("margin-right: -5px");
    expect(paneDividerVerticalRules).toContain("height: 10px");
    expect(paneDividerVerticalRules).toContain("margin-top: -5px");
    expect(paneDividerVerticalRules).toContain("margin-bottom: -5px");
    expect(bottomPanel).toContain("padding: 0");
    expect(bottomPanel).not.toContain("padding: 0 0 14px");
    expect(bottomPanel).not.toContain("padding: 0 14px 14px");
    expect(bottomTerminalShellRules).toContain("var(--bg-terminal)");
    expect(bottomTerminalShellRules).not.toContain("rgba(17, 24, 31, 0.96)");
    expect(bottomTerminalShell).toContain("border: none");
    expect(bottomTerminalShellRules).toContain("border-radius: 0");
    expect(bottomTerminalShellRules).not.toContain("border-radius: 14px");
    expect(statusBar).toContain(
      "border-top: 1px solid color-mix(in srgb, var(--border) 62%, transparent)"
    );
  });

  it("maps desktop chrome blocks to the dedicated desktop layout tokens", () => {
    const topbar = getLastRuleBlock(".app-topbar");
    const statusBar = getLastRuleBlock(".workspace-status-bar");
    const sidebarHeader = getLastRuleBlock(".workspace-sidebar-panel__header");
    const commandPalette = getLastRuleBlock(".command-palette");
    const launchModal = getLastRuleBlock(".launch-modal");

    expect(topbar).toContain("min-height: var(--desktop-topbar-height)");
    expect(statusBar).toContain("min-height: var(--desktop-statusbar-height)");
    expect(sidebarHeader).toContain("min-height: var(--desktop-sidebar-header-height)");
    expect(sidebarHeader).toContain("padding: 10px var(--desktop-panel-padding) 8px");
    expect(commandPalette).toContain("max-width: var(--desktop-modal-max-width-md)");
    expect(launchModal).toContain("max-width: min(var(--desktop-modal-max-width-lg), 90vw)");
  });

  it("keeps auth shells theme-aware instead of forcing dark gradients", () => {
    const authScreen = getLastRuleBlock(".auth-screen");
    const authCard = getLastRuleBlock(".auth-card-shell");

    expect(authScreen).toContain("var(--bg-page)");
    expect(authScreen).toContain("var(--accent-green)");
    expect(authScreen).toContain("var(--accent-blue)");
    expect(authScreen).not.toContain("rgba(17, 24, 31, 0.96)");
    expect(authCard).toContain("var(--bg-surface)");
    expect(authCard).toContain("var(--accent-blue)");
    expect(authCard).toContain("var(--shadow-xl)");
    expect(authCard).not.toContain("rgba(13, 20, 26, 0.94)");
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

  it("does not ship removed mobile terminal copy mode overlay CSS", () => {
    expect(stylesheet).not.toContain(".mobile-terminal-copy-mode");
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

    expect(viewport).toContain("padding: 0");
    expect(viewport).toContain("border-top:");
    expect(viewport).not.toContain("padding: 4px");
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
      "padding: calc(var(--mobile-safe-top) + var(--sp-1)) var(--mobile-safe-right) 0"
    );
    expect(fullscreenFooter).toContain("padding-bottom: var(--mobile-safe-bottom)");
    expect(sheetBody).toContain("overflow-y: auto");
  });

  it("keeps fullscreen mobile sheet headers aligned to a settings-style back and title row", () => {
    const fullscreenHeader = getLastRuleBlock(".mobile-sheet--fullscreen .mobile-sheet__header");
    const pageHeader = getLastRuleBlock(".mobile-sheet--fullscreen .page-header");
    const mobilePageHeader = getLastRuleBlock(".mobile-page-header");
    const mobilePageHeaderLeading = getLastRuleBlock(".mobile-page-header .page-header__leading");
    const mobilePageHeaderBack = getLastRuleBlock(".mobile-page-header .page-header__back");
    const headerLeading = getLastRuleBlock(".page-header__leading");
    const backButton = getLastRuleBlock(".mobile-sheet--fullscreen .page-header__back");
    const headerActions = getLastRuleBlock(".page-header__actions");

    expect(fullscreenHeader).toContain("padding: 0 var(--sp-3)");
    expect(pageHeader).toContain("width: 100%");
    expect(mobilePageHeader).toContain("min-height: 38px");
    expect(mobilePageHeaderLeading).toContain("gap: 8px");
    expect(mobilePageHeaderBack).toContain("min-height: 26px");
    expect(mobilePageHeaderBack).toContain("font-family: var(--font-mono)");
    expect(headerLeading).toContain("flex: 1");
    expect(backButton).toContain("background: transparent");
    expect(backButton).not.toContain("border-radius: 999px");
    expect(headerActions).toContain("margin-left: auto");
  });

  it("uses a unified inline sheet treatment for mobile selectors and keeps topbar controls height-aligned", () => {
    const inlineSheet = getLastRuleBlock(".mobile-inline-sheet");
    const inlineSheetAction = getLastRuleBlock(".mobile-inline-sheet__action");
    const inlineSelectSheet = getLastRuleBlock(".mobile-select-sheet--inline");
    const workspaceButton = getLastGroupedRuleBlock(
      /\.mobile-topbar__workspace-button\s*\{([^}]*)\}/g
    );
    const sessionButton = getLastGroupedRuleBlock(/\.mobile-topbar__session-button\s*\{([^}]*)\}/g);
    const iconButton = getLastRuleBlock(".mobile-topbar__icon-button");

    expect(inlineSheet).toContain("position: absolute");
    expect(inlineSheet).toContain("border-radius: var(--radius-xl)");
    expect(inlineSheetAction).toContain("border-radius: var(--radius-md)");
    expect(inlineSelectSheet).toContain("flex: 1");
    expect(inlineSelectSheet).toContain("flex-direction: column");
    expect(workspaceButton).toContain("height: 36px");
    expect(workspaceButton).not.toContain("box-shadow:");
    expect(sessionButton).toContain("min-height: 40px");
    expect(sessionButton).not.toContain("box-shadow:");
    expect(iconButton).toContain("height: 36px");
    expect(iconButton).not.toContain("box-shadow:");
  });

  it("keeps mobile select row-side actions lightweight and token-driven", () => {
    const row = getLastRuleBlock(".mobile-select-sheet__item-row");
    const rowSelected = getLastRuleBlock('.mobile-select-sheet__item-row[data-selected="true"]');
    const plainSelected = getLastRuleBlock(
      '.mobile-select-sheet__list > [data-selected="true"] > .mobile-select-sheet__item'
    );
    const commandSelected = getLastRuleBlock(
      '.mobile-select-sheet--command .mobile-select-sheet__list > [data-selected="true"] > .mobile-select-sheet__item'
    );
    const sideAction = getLastRuleBlock(".mobile-select-sheet__item-side-action");
    const sideActionDanger = getLastRuleBlock(".mobile-select-sheet__item-side-action--danger");

    expect(row).toContain("display: flex");
    expect(row).toContain("padding: var(--sp-1) var(--sp-2)");
    expect(rowSelected).toContain("var(--accent-blue)");
    expect(plainSelected).toContain("var(--accent-blue)");
    expect(commandSelected).toContain("var(--accent-blue) 12%");
    expect(commandSelected).toContain("inset 2px 0 0");
    expect(sideAction).toContain("width: 40px");
    expect(sideAction).toContain("border-radius: 999px");
    expect(sideAction).toContain("background: transparent");
    expect(sideActionDanger).toContain("var(--accent-red)");
    expect(stylesheet).not.toContain(".mobile-select-sheet__item-check {");
  });

  it("keeps the mobile dock as a three-entry bottom rail for agent, files, and terminal", () => {
    const mobileDock = getLastRuleBlock(".mobile-dock");
    const mobileDockItem = getRuleBlocksFrom(stylesheet, ".mobile-dock__item").find((block) =>
      block.includes("display: flex")
    );
    const activeDockItem = getRuleBlocksFrom(stylesheet, ".mobile-dock__item--active").find(
      (block) => block.includes("border-top-color:")
    );

    expect(mobileDock).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(mobileDock).toContain("gap: var(--sp-2)");
    expect(mobileDock).toContain("min-height: 36px");
    expect(mobileDockItem).toBeTruthy();
    expect(mobileDockItem).toContain("border-top: 1px solid transparent");
    expect(mobileDockItem).toContain("background: transparent");
    expect(mobileDockItem).toContain("min-height: 36px");
    expect(mobileDockItem).toContain("height: 36px");
    expect(activeDockItem).toBeTruthy();
    expect(activeDockItem).toContain("border-top-color:");
  });

  it("keeps mobile sheets closer to IDE panes than floating cards", () => {
    const mobileSheet = getLastRuleBlock(".mobile-sheet");
    const mobileSheetHandle = getLastRuleBlock(".mobile-sheet__handle");
    const fullscreenBack = getLastRuleBlock(".mobile-sheet--fullscreen .page-header__back");

    expect(mobileSheet).toContain("border-top-left-radius: var(--radius-xl)");
    expect(mobileSheet).toContain("border-top-right-radius: var(--radius-xl)");
    expect(mobileSheet).toContain("border: 1px solid");
    expect(mobileSheet).not.toContain("box-shadow: var(--shadow-xl)");
    expect(mobileSheetHandle).toContain("width: 32px");
    expect(fullscreenBack).toContain("box-shadow: none");
  });

  it("keeps settings navigation aligned with desktop editor chrome on both desktop and mobile", () => {
    const settingsPage = getLastRuleBlock(".settings-page");
    const baseSettingsHeader = getRuleBlocksFrom(stylesheet, ".settings-header")[0];
    const desktopSettingsHeader = getLastRuleBlock(".settings-header__desktop");
    const desktopSettingsCopy = getLastRuleBlock(".settings-header__copy");
    const desktopSettingsTitle = getLastRuleBlock(".settings-header__title");
    const settingsBody = getLastRuleBlock(".settings-body");
    const settingsSidebar = getLastRuleBlock(".settings-sidebar");
    const settingsContent = getLastRuleBlock(".settings-content");
    const settingsContentFillHeight = getLastRuleBlock(".settings-content--fill-height");
    const settingsContentFillHeightSurface = getLastRuleBlock(
      ".settings-content--fill-height > .settings-content-surface"
    );
    const settingsNavItem = getLastRuleBlock(".settings-nav-item");
    const settingsNavItemHover = getLastRuleBlock(".settings-nav-item:hover");
    const settingsNavItemActive = getLastRuleBlock(".settings-nav-item-active");
    const mobileContent = getLastGroupedRuleBlock(
      /\.settings-content--mobile,\s*\.settings-content--mobile-root\s*\{([^}]*)\}/g
    );
    const mobileRootContent = getLastRuleBlock(
      ".settings-page--mobile .settings-content--mobile-root"
    );
    const mobileRoot = getLastRuleBlock(".settings-mobile-root");
    const mobileGroup = getLastRuleBlock(".settings-mobile-group");
    const mobileGroupList = getLastRuleBlock(".settings-mobile-group__list");
    const mobileItem = getLastRuleBlock(".settings-mobile-item");
    const mobileItemIcon = getLastRuleBlock(".settings-mobile-item__icon");
    const mobileItemArrow = getLastRuleBlock(".settings-mobile-item__arrow");

    expect(settingsPage).toContain("display: flex");
    expect(settingsPage).toContain("min-height: 100vh");
    expect(settingsPage).toContain("background: var(--bg-page)");
    expect(baseSettingsHeader).toContain("background: var(--bg-surface)");
    expect(baseSettingsHeader).toContain("border-bottom: 1px solid var(--border)");
    expect(baseSettingsHeader).toContain("padding: var(--sp-1) var(--sp-4)");
    expect(desktopSettingsHeader).toContain("width: 100%");
    expect(desktopSettingsHeader).toContain("margin: 0");
    expect(desktopSettingsHeader).toContain("display: flex");
    expect(desktopSettingsHeader).toContain("align-items: center");
    expect(desktopSettingsHeader).toContain("justify-content: flex-start");
    expect(desktopSettingsCopy).toContain("justify-content: flex-start");
    expect(desktopSettingsCopy).toContain("flex: 0 1 auto");
    expect(desktopSettingsCopy).toContain("gap: 0");
    expect(desktopSettingsTitle).toContain("font-size: var(--type-section-title-size)");
    expect(desktopSettingsTitle).toContain("line-height: var(--type-section-title-line-height)");
    expect(settingsBody).toContain("align-items: stretch");
    expect(settingsBody).toContain("background: var(--bg-page)");
    expect(settingsSidebar).toContain("background: var(--bg-panel)");
    expect(settingsSidebar).toContain("padding: var(--sp-4)");
    expect(settingsSidebar).toContain("width: 240px");
    expect(settingsContent).toContain("display: flex");
    expect(settingsContent).toContain("justify-content: center");
    expect(settingsContent).toContain("padding: var(--sp-6)");
    expect(settingsContent).toContain("background: var(--bg-page)");
    expect(settingsContentFillHeight).toContain("justify-content: flex-start");
    expect(settingsContentFillHeightSurface).toContain("display: flex");
    expect(settingsContentFillHeightSurface).toContain("flex-direction: column");
    expect(settingsContentFillHeightSurface).toContain("flex: 1");
    expect(settingsContentFillHeightSurface).toContain("min-height: 0");
    expect(settingsNavItem).toContain("min-height: 40px");
    expect(settingsNavItem).toContain("border: 1px solid transparent");
    expect(settingsNavItem).toContain("border-radius: var(--radius-md)");
    expect(settingsNavItemHover).toContain("background: var(--bg-hover)");
    expect(settingsNavItemActive).toContain("background: var(--bg-active)");
    expect(settingsNavItemActive).toContain("border-color: color-mix");
    expect(settingsNavItemActive).toContain("var(--accent-blue)");
    expect(mobileContent).toContain("padding: 0");
    expect(mobileRootContent).toContain("padding-left: var(--sp-3)");
    expect(mobileRootContent).toContain("padding-right: var(--sp-3)");
    expect(mobileRoot).toContain("display: flex");
    expect(mobileRoot).toContain("flex-direction: column");
    expect(mobileRoot).toContain("gap: var(--sp-5)");
    expect(mobileRoot).toContain("padding: var(--sp-4) 0 var(--sp-4)");
    expect(mobileGroup).toContain("gap: var(--sp-2)");
    expect(mobileGroupList).toContain("border: 1px solid");
    expect(mobileGroupList).toContain("border-radius: 12px");
    expect(mobileGroupList).toContain("overflow: hidden");
    expect(mobileItem).toContain("min-height: 60px");
    expect(mobileItem).toContain("padding: var(--sp-3) var(--sp-4)");
    expect(mobileItem).toContain("border: none");
    expect(mobileItem).not.toContain("linear-gradient(");
    expect(mobileItemIcon).toContain("color: var(--icon-secondary)");
    expect(mobileItemArrow).toContain("color: var(--text-tertiary)");
  });

  it("keeps settings mobile headers and back actions on the same flat pane language as workspace chrome", () => {
    const mobilePageBack = getLastRuleBlock(".page-header__back");
    const mobileSettingsPage = getLastRuleBlock(".settings-page--mobile");
    const mobileSettingsHeader = getLastRuleBlock(".settings-header").replace(/\s+/g, " ");
    const mobileSettingsHeaderPage = getLastRuleBlock(
      ".settings-page--mobile > .settings-header"
    ).replace(/\s+/g, " ");
    const mobileSettingsHeaderPageHeader = getLastRuleBlock(".settings-header .mobile-page-header");
    const mobileSettingsHeaderLeading = getLastRuleBlock(
      ".settings-header .mobile-page-header .page-header__leading"
    );
    const mobileSettingsHeaderBack = getLastRuleBlock(
      ".settings-header .mobile-page-header .page-header__back"
    );
    const mobileSettingsBody = getLastRuleBlock(".settings-body--mobile");
    const mobileSettingsFooter = getLastRuleBlock(".settings-footer--mobile").replace(/\s+/g, " ");
    const mobileSettingsFooterPage = getLastRuleBlock(
      ".settings-page--mobile > .settings-footer"
    ).replace(/\s+/g, " ");

    expect(mobileSettingsPage).toContain("min-height: 100dvh");
    expect(mobileSettingsPage).toContain("height: 100dvh");
    expect(mobileSettingsHeader).toContain(
      "padding: calc(var(--mobile-safe-top) + var(--sp-1)) calc(var(--mobile-safe-right) + var(--sp-4)) var(--sp-1) calc(var(--mobile-safe-left) + var(--sp-4))"
    );
    expect(mobileSettingsHeaderPage).toContain(
      "padding: calc(var(--mobile-safe-top) + var(--sp-1)) calc(var(--mobile-safe-right) + var(--sp-4)) var(--sp-1) calc(var(--mobile-safe-left) + var(--sp-4))"
    );
    expect(mobileSettingsHeaderPageHeader).toContain("gap: var(--sp-2)");
    expect(mobileSettingsHeaderLeading).toContain("gap: var(--sp-2)");
    expect(mobileSettingsHeaderBack).toContain("min-height: 32px");
    expect(mobileSettingsHeaderBack).toContain("gap: var(--sp-1)");
    expect(mobileSettingsBody).toContain("background: var(--bg-page)");
    expect(mobilePageBack).toContain("background: transparent");
    expect(mobilePageBack).toContain("box-shadow: none");
    expect(mobilePageBack).not.toContain("border-radius: 999px");
    expect(mobileSettingsFooter).toContain(
      "padding: var(--sp-2) calc(var(--mobile-safe-right) + var(--sp-4)) calc(var(--mobile-safe-bottom) + var(--sp-4)) calc(var(--mobile-safe-left) + var(--sp-4))"
    );
    expect(mobileSettingsFooterPage).toContain(
      "padding: var(--sp-2) calc(var(--mobile-safe-right) + var(--sp-4)) calc(var(--mobile-safe-bottom) + var(--sp-4)) calc(var(--mobile-safe-left) + var(--sp-4))"
    );
    expect(mobileSettingsFooter).toContain("min-height: 32px");
  });

  it("keeps mobile container surfaces on shared radius tokens instead of bespoke rounded-card values", () => {
    const settingsGroupList = getLastRuleBlock(".settings-mobile-group__list");
    const settingsItemIconShell = getLastRuleBlock(".settings-mobile-item__icon-shell");

    expect(settingsGroupList).toContain("border-radius: 12px");
    expect(settingsItemIconShell).toContain("border-radius: var(--radius-xl)");
  });

  it("keeps the mobile workspace launch action docked in a compact editor-style footer rail", () => {
    const launchFooter = getLastRuleBlock(".mobile-sheet--launch .mobile-sheet__footer").replace(
      /\s+/g,
      " "
    );
    const launchActionRail = getLastRuleBlock(".mobile-launch-sheet__footer");
    const launchActionButton = getLastRuleBlock(
      ".mobile-launch-sheet__footer .launch-start-btn--mobile"
    );

    expect(launchFooter).toContain(
      "padding: var(--sp-2) calc(var(--mobile-safe-right) + var(--sp-4)) calc(var(--mobile-safe-bottom) + var(--sp-4)) calc(var(--mobile-safe-left) + var(--sp-4))"
    );
    expect(launchActionRail).toContain("padding: var(--sp-2)");
    expect(launchActionRail).toContain("border-radius: var(--radius-xl)");
    expect(launchActionRail).toContain("background: color-mix(");
    expect(launchActionButton).toContain("min-height: 44px");
    expect(launchActionButton).toContain("border-radius: var(--radius-md)");
    expect(launchActionButton).toContain("font-size: var(--type-body-strong-size)");
    expect(launchActionButton).toContain("box-shadow: none");
  });

  it("keeps mobile supervisor sheets aligned with the shared fullscreen page spacing and action sizing", () => {
    const supervisorRoot = getLastRuleBlock(".mobile-supervisor-sheet__root").replace(/\s+/g, " ");
    const supervisorDetail = getLastRuleBlock(".mobile-supervisor-sheet__detail").replace(
      /\s+/g,
      " "
    );
    const supervisorFullscreenFooter = getLastRuleBlock(
      ".mobile-supervisor-sheet.mobile-sheet--fullscreen .mobile-sheet__footer"
    ).replace(/\s+/g, " ");
    const supervisorActionButton = getLastRuleBlock(
      ".mobile-supervisor-sheet__actions > .btn"
    ).replace(/\s+/g, " ");
    const supervisorFooterButton = getLastRuleBlock(
      ".mobile-supervisor-sheet__footer > .btn"
    ).replace(/\s+/g, " ");

    expect(supervisorRoot).toContain("padding: var(--sp-4)");
    expect(supervisorRoot).toContain("padding-bottom: var(--sp-5)");
    expect(supervisorDetail).toContain("padding: var(--sp-4)");
    expect(supervisorDetail).toContain("padding-bottom: var(--sp-5)");
    expect(supervisorFullscreenFooter).toContain(
      "padding: var(--sp-2) var(--sp-4) calc(var(--mobile-safe-bottom) + var(--sp-4))"
    );
    expect(supervisorActionButton).toContain("min-height: 44px");
    expect(supervisorFooterButton).toContain("min-height: 44px");
    expect(supervisorFooterButton).toContain("box-shadow: none");
    expect(getLastRuleBlock(".mobile-supervisor-sheet__footer")).toContain("padding: var(--sp-2)");
    expect(getLastRuleBlock(".mobile-supervisor-sheet__footer")).toContain(
      "border-radius: var(--radius-xl)"
    );
    expect(getLastRuleBlock(".mobile-supervisor-sheet__footer")).toContain(
      "background: color-mix("
    );
  });

  it("keeps the mobile workspace home screen aligned to settings chrome and editor-pane empty states", () => {
    const topbar = getLastRuleBlock(".mobile-topbar").replace(/\s+/g, " ");
    const emptyStage = getLastRuleBlock(".mobile-shell__agent-empty").replace(/\s+/g, " ");
    const bottomStack = getLastRuleBlock(".mobile-shell__bottom-stack").replace(/\s+/g, " ");
    const dockShell = getLastRuleBlock(".mobile-dock-shell").replace(/\s+/g, " ");
    const dock = getLastRuleBlock(".mobile-dock");
    const dockItem = getRuleBlocksFrom(stylesheet, ".mobile-dock__item").find((block) =>
      block.includes("display: flex")
    );
    const dockLabel = getLastRuleBlock(".mobile-dock__label");
    const statusBar = getLastRuleBlock(
      ".mobile-shell__bottom-stack > .workspace-status-bar"
    ).replace(/\s+/g, " ");
    const statusStrip = getLastRuleBlock(
      ".mobile-shell__bottom-stack .git-panel-status-strip"
    ).replace(/\s+/g, " ");
    const emptyPane = getLastRuleBlock(".mobile-shell__empty-content");
    const emptyState = getLastRuleBlock(".mobile-shell__empty-state");
    const emptyTitle = getLastRuleBlock(".mobile-shell__empty-title");
    const placeholderCopy = getLastRuleBlock(".mobile-shell__placeholder-copy");
    const emptyCta = getLastRuleBlock(".mobile-shell__empty-cta");
    const topbarWorkspaceButton = getLastGroupedRuleBlock(
      /\.mobile-topbar__workspace-button\s*\{([^}]*)\}/g
    );
    const topbarIconButton = getLastRuleBlock(".mobile-topbar__icon-button");

    expect(topbar).toContain(
      "padding: calc(var(--mobile-safe-top) + var(--sp-1)) calc(var(--mobile-safe-right) + var(--sp-4)) var(--sp-1) calc(var(--mobile-safe-left) + var(--sp-4))"
    );
    expect(topbarWorkspaceButton).toContain("border-bottom: none");
    expect(topbarWorkspaceButton).toContain("border-radius: 0");
    expect(topbarIconButton).toContain("border: none");
    expect(topbarIconButton).toContain("border-radius: 10px");
    expect(topbarIconButton).toContain("background: transparent");
    expect(emptyStage).toContain("padding: clamp(34px, 9vh, 72px) var(--sp-4) var(--sp-3)");
    expect(bottomStack).toContain("background: linear-gradient(");
    expect(bottomStack).toContain("border-top: 1px solid color-mix(");
    expect(bottomStack).not.toContain("backdrop-filter");
    expect(dockShell).toContain(
      "padding: 3px calc(var(--mobile-safe-right) + var(--sp-4)) 0 calc(var(--mobile-safe-left) + var(--sp-4))"
    );
    expect(dock).toContain("gap: var(--sp-2)");
    expect(dock).toContain("border-bottom: none");
    expect(dock).toContain("min-height: 36px");
    expect(dockItem).toBeTruthy();
    expect(dockItem).toContain("min-height: 36px");
    expect(dockItem).toContain("height: 36px");
    expect(dockItem).toContain("padding: 1px var(--sp-2) 0");
    expect(dockLabel).toContain("font-size: var(--type-kicker-size)");
    expect(statusBar).toContain("padding-bottom: calc(var(--mobile-safe-bottom) + var(--sp-1))");
    expect(statusBar).toContain("border-top: 1px solid");
    expect(statusStrip).toContain("min-height: 28px");
    expect(statusStrip).toContain("font-size: var(--type-kicker-size)");
    expect(statusStrip).toContain(
      "padding: 0 calc(var(--mobile-safe-right) + var(--sp-4)) 0 calc(var(--mobile-safe-left) + var(--sp-4))"
    );
    expect(emptyPane).toContain("position: relative");
    expect(emptyPane).toContain("width: min(100%, 320px)");
    expect(emptyPane).toContain("align-self: flex-start");
    expect(emptyPane).toContain("padding: 0");
    expect(emptyPane).toContain("border: none");
    expect(emptyPane).toContain("background: transparent");
    expect(emptyState).toContain("align-items: flex-start");
    expect(emptyState).toContain("width: 100%");
    expect(emptyState).toContain("text-align: left");
    expect(emptyState).toContain("gap: var(--sp-3)");
    expect(emptyTitle).toContain("font-size: var(--type-app-title-size)");
    expect(placeholderCopy).toContain("gap: var(--sp-2)");
    expect(emptyCta).toContain("min-height: 38px");
    expect(emptyCta).toContain("width: auto");
    expect(emptyCta).toContain("min-width: 136px");
    expect(emptyCta).toContain("border-radius: 12px");
  });

  it("keeps mobile container surfaces on shared radius tokens instead of bespoke rounded-card values", () => {
    const dockItem = getRuleBlocksFrom(stylesheet, ".mobile-dock__item").find((block) =>
      block.includes("display: flex")
    );
    const mobileTerminalSheet = getLastRuleBlock(".mobile-terminal-sheet");
    const mobileTerminal = getLastRuleBlock(".mobile-terminal-sheet .bottom-terminal");
    const mobileFilesSurface = getLastRuleBlock(".mobile-sheet--files .file-tree-shell--mobile");
    const mobileFilesGitSurface = getLastRuleBlock(".mobile-sheet--files .git-panel--mobile");
    const mobileFilesSegmented = getLastRuleBlock(".mobile-files-sheet__segmented");
    const mobileFilesSegment = getLastRuleBlock(".mobile-files-sheet__segment");
    const mobileFilesSegmentActive = getLastRuleBlock(".mobile-files-sheet__segment.active");
    const mobileFilesSegmentIndicator = getLastRuleBlock(
      ".mobile-files-sheet__segment.active::after"
    );
    const mobileFilesTabAction = getLastRuleBlock(".mobile-files-sheet__tab-action");
    const mobileFileSearch = getLastRuleBlock(
      ".mobile-sheet--files .file-tree-shell--mobile .file-tree-search"
    );
    const mobileFileRow = getLastRuleBlock(
      ".mobile-sheet--files .file-tree-shell--mobile .tree-item"
    );
    const mobileFileRowSelected = getLastRuleBlock(
      ".mobile-sheet--files .file-tree-shell--mobile .tree-item.selected"
    );
    const supervisorRoot = getLastRuleBlock(".mobile-supervisor-sheet__root");
    const supervisorHeader = getLastRuleBlock(".mobile-supervisor-sheet__detail-header");
    const drawerItem = getLastRuleBlock(".mobile-workspace-drawer__item");
    const drawerFooterButton = getLastRuleBlock(".mobile-workspace-drawer__footer-button");
    const welcomeCard = getLastRuleBlock(".welcome-card--mobile");
    const welcomeFeature = getLastRuleBlock(".welcome-card--mobile .welcome-feature");
    const welcomeButton = getLastRuleBlock(".welcome-card--mobile .welcome-btn");
    const authCard = getLastRuleBlock(".auth-card-shell--mobile");
    const authStatusPanel = getLastRuleBlock(".auth-card-shell--mobile .auth-status-panel");
    const settingsItem = getLastRuleBlock(".settings-mobile-item");
    const settingsItemIconShell = getLastRuleBlock(".settings-mobile-item__icon-shell");

    expect(dockItem).toBeTruthy();
    expect(dockItem).toContain("border-radius: 0");
    expect(mobileTerminalSheet).not.toContain("linear-gradient(");
    expect(mobileTerminal).toContain("border-radius: 0");
    expect(mobileTerminal).not.toContain("var(--radius-xl) var(--radius-xl) 0 0");
    expect(mobileFilesSegmented).toContain(
      "border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent)"
    );
    expect(mobileFilesSegmented).toContain("border-radius: 0");
    expect(mobileFilesSegmented).not.toContain("linear-gradient(");
    expect(mobileFilesSegmented).toContain("box-shadow: none");
    expect(mobileFilesSegment).toContain("padding: 0");
    expect(mobileFilesSegment).toContain("font-weight: var(--type-label-weight)");
    expect(mobileFilesSegmentActive).toContain("background: transparent");
    expect(mobileFilesSegmentIndicator).toContain("height: 1.5px");
    expect(mobileFilesTabAction).toContain("border: none");
    expect(mobileFilesTabAction).toContain("border-radius: 6px");
    expect(mobileFilesTabAction).toContain("background: transparent");
    expect(mobileFilesSurface).toContain(
      "border: 1px solid color-mix(in srgb, var(--border) 80%, transparent)"
    );
    expect(mobileFilesSurface).toContain("border-radius: var(--radius-md)");
    expect(mobileFilesSurface).toContain("box-shadow: none");
    expect(mobileFilesSurface).not.toContain("linear-gradient(");
    expect(mobileFilesGitSurface).toContain(
      "border: 1px solid color-mix(in srgb, var(--border) 80%, transparent)"
    );
    expect(mobileFilesGitSurface).toContain("border-radius: var(--radius-md)");
    expect(mobileFilesGitSurface).toContain("box-shadow: none");
    expect(mobileFileSearch).toContain("margin: 0");
    expect(mobileFileSearch).toContain("border-radius: 0");
    expect(mobileFileSearch).toContain("border-right: none");
    expect(mobileFileSearch).toContain("border-left: none");
    expect(mobileFileSearch).toContain("background: transparent");
    expect(mobileFileRow).toContain("min-height: 40px");
    expect(mobileFileRow).toContain("border-radius: 0");
    expect(mobileFileRowSelected).toContain(
      "border-left: 2px solid color-mix(in srgb, var(--accent-blue) 88%, white 12%)"
    );
    expect(supervisorRoot).toContain("border-radius: var(--radius-xl) var(--radius-xl) 0 0");
    expect(supervisorHeader).toContain("border-radius: var(--radius-xl)");
    expect(drawerItem).toContain("border-radius: var(--radius-xl)");
    expect(drawerFooterButton).toContain("border-radius: var(--radius-md)");
    expect(welcomeCard).toContain("border-radius: var(--radius-xl)");
    expect(welcomeFeature).toContain("border-radius: var(--radius-xl)");
    expect(welcomeButton).toContain("border-radius: var(--radius-md)");
    expect(authCard).toContain("border-radius: var(--radius-xl)");
    expect(authStatusPanel).toContain("border-radius: var(--radius-xl)");
    expect(settingsItem).toContain("border-radius: 0");
    expect(settingsItemIconShell).toContain("border-radius: var(--radius-xl)");
  });

  it("keeps settings content groups and provider controls aligned with editor configuration panels", () => {
    const settingsGroup = getLastRuleBlock(".settings-group");
    const settingsGroupTitle = getLastRuleBlock(".settings-group-title");
    const settingsGroupDesc = getLastRuleBlock(".settings-group-desc");
    const settingsPillsBase = getRuleBlocksFrom(stylesheet, ".settings-pills")[0];
    const settingsPillsMobile = getLastRuleBlock(".settings-pills");
    const settingsToggleRow = getLastRuleBlock(".settings-toggle-row");
    const settingsInfoRowBase = getRuleBlocksFrom(stylesheet, ".settings-info-row")[0];
    const settingsInfoRowMobile = getLastRuleBlock(".settings-info-row");
    const settingsInfoLabel = getLastRuleBlock(".settings-info-label");
    const settingsInfoValueBase = getRuleBlocksFrom(stylesheet, ".settings-info-value")[0];
    const settingsInfoValueMobile = getLastRuleBlock(".settings-info-value");
    const settingsStatusHint = getLastRuleBlock(".settings-status-hint");
    const settingsLink = getLastRuleBlock(".settings-link");
    const providerTabs = getLastRuleBlock(".settings-provider-tabs");
    const providerTab = getLastRuleBlock(".settings-provider-tab");
    const providerTabActive = getLastRuleBlock(".settings-provider-tab-active");
    const providerSubnav = getLastRuleBlock(".settings-provider-subnav");
    const providerSubnavButtonActive = getLastRuleBlock(".settings-provider-subnav-button-active");
    const providerMobileEntryBase = getRuleBlocksFrom(
      stylesheet,
      ".settings-provider-mobile-entry"
    )[0];
    const providerMobileEntryMobile = getLastRuleBlock(".settings-provider-mobile-entry");
    const commandPreview = getLastRuleBlock(".settings-command-preview");
    const settingsFooter = getLastRuleBlock(".settings-footer");

    expect(settingsGroup).toContain("margin-bottom: var(--sp-8)");
    expect(settingsGroupTitle).toContain("font-size: var(--type-kicker-size)");
    expect(settingsGroupTitle).toContain("text-transform: uppercase");
    expect(settingsGroupTitle).toContain("letter-spacing:");
    expect(settingsGroupDesc).toContain("max-width:");
    expect(settingsPillsBase).toContain("gap: var(--sp-1)");
    expect(settingsPillsBase).toContain("padding-bottom: var(--sp-1)");
    expect(settingsPillsMobile).toContain("gap: var(--sp-2)");
    expect(settingsToggleRow).toContain("display: grid");
    expect(settingsToggleRow).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(settingsToggleRow).toContain("padding: var(--sp-3) 0");
    expect(settingsInfoRowBase).toContain("display: grid");
    expect(settingsInfoRowBase).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(settingsInfoRowBase).toContain("padding: var(--sp-3) 0");
    expect(settingsInfoRowBase).toContain("border-bottom: 1px solid var(--border)");
    expect(settingsInfoRowMobile).toContain("grid-template-columns: 1fr");
    expect(settingsInfoLabel).toContain("text-transform: uppercase");
    expect(settingsInfoLabel).toContain("letter-spacing:");
    expect(settingsInfoValueBase).toContain("flex-direction: column");
    expect(settingsInfoValueBase).toContain("align-items: flex-end");
    expect(settingsInfoValueBase).toContain("min-width: 14ch");
    expect(settingsInfoValueBase).toContain("max-width: 40ch");
    expect(settingsInfoValueMobile).toContain("align-items: flex-start");
    expect(settingsInfoValueMobile).toContain("min-width: 0");
    expect(settingsInfoValueMobile).toContain("max-width: 100%");
    expect(settingsStatusHint).toContain("line-height: var(--type-meta-line-height)");
    expect(settingsLink).toContain("display: inline-flex");
    expect(settingsLink).toContain("font-weight: var(--font-medium)");
    expect(providerTabs).toContain("gap: var(--sp-1)");
    expect(providerTabs).toContain("margin-bottom: var(--sp-4)");
    expect(providerTab).toContain("background: transparent");
    expect(providerTab).toContain("border: 1px solid transparent");
    expect(providerTabActive).toContain("background: var(--bg-active)");
    expect(providerTabActive).toContain("border-color: var(--border-focus)");
    expect(providerSubnav).toContain("gap: var(--sp-1)");
    expect(providerSubnav).toContain("margin-bottom: var(--sp-4)");
    expect(providerSubnavButtonActive).toContain("background: var(--bg-active)");
    expect(providerSubnavButtonActive).toContain("border-color: var(--border-focus)");
    expect(providerMobileEntryBase).toContain("padding: var(--sp-3) 0");
    expect(providerMobileEntryBase).toContain("border-top: 1px solid var(--border)");
    expect(providerMobileEntryBase).toContain("border-radius: 0");
    expect(providerMobileEntryBase).toContain("background: transparent");
    expect(providerMobileEntryMobile).toContain("padding-left: var(--sp-4)");
    expect(commandPreview).toContain("border-radius: var(--radius-sm)");
    expect(commandPreview).toContain("background: color-mix");
    expect(settingsFooter).toContain("background: var(--bg-surface)");
    expect(settingsFooter).toContain("border-top: 1px solid var(--border)");
    expect(settingsFooter).toContain("min-height: 32px");
    expect(settingsFooter).toContain("padding: var(--sp-3) var(--sp-6)");
  });

  it("keeps shared appearance pills aligned with flat editor option toggles instead of rounded app chips", () => {
    const pill = getLastRuleBlockFrom(pillStylesheet, ".pill");
    const pillHover = getLastRuleBlockFrom(pillStylesheet, ".pill:hover:not(:disabled)");
    const pillFocus = getLastRuleBlockFrom(pillStylesheet, ".pill:focus-visible");
    const active = getLastRuleBlockFrom(pillStylesheet, ".active");

    expect(pill).toContain("min-height: 36px");
    expect(pill).toContain("padding: var(--sp-2) var(--sp-3)");
    expect(pill).toContain("border: 1px solid transparent");
    expect(pill).toContain("border-radius: var(--radius-md)");
    expect(pill).toContain("background: transparent");
    expect(pill).toContain("font-size: var(--type-label-size)");
    expect(pill).toContain("font-weight: var(--type-label-weight)");
    expect(pillHover).toContain("background: var(--bg-hover)");
    expect(pillHover).toContain("border-color: color-mix");
    expect(pillFocus).toContain("border-color: var(--border-focus)");
    expect(active).toContain("background: var(--bg-active)");
    expect(active).toContain("border-color: var(--border-focus)");
    expect(active).not.toContain("background: var(--accent-blue)");
  });

  it("keeps inline notices closer to embedded status strips than standalone cards", () => {
    const notice = getLastRuleBlockFrom(noticeStylesheet, ".notice");
    const warning = getLastRuleBlockFrom(noticeStylesheet, ".warning");
    const error = getLastRuleBlockFrom(noticeStylesheet, ".error");
    const title = getLastRuleBlockFrom(noticeStylesheet, ".title");
    const message = getLastRuleBlockFrom(noticeStylesheet, ".message");
    const action = getLastRuleBlockFrom(noticeStylesheet, ".action");

    expect(notice).toContain("margin: 0 0 var(--sp-4)");
    expect(notice).toContain("padding: var(--sp-2) var(--sp-3)");
    expect(notice).toContain("border-radius: var(--radius-sm)");
    expect(notice).toContain("background: color-mix");
    expect(warning).toContain("background: color-mix");
    expect(error).toContain("background: color-mix");
    expect(title).toContain("text-transform: uppercase");
    expect(title).toContain("font-size: var(--type-kicker-size)");
    expect(message).toContain("font-size: var(--type-meta-size)");
    expect(action).toContain("align-self: flex-start");
  });

  it("keeps shared segmented controls aligned with flat editor settings tabs instead of pill chrome", () => {
    const providerTabs = getLastRuleBlockFrom(
      segmentedControlStylesheet,
      ":global(.settings-provider-tabs)"
    );
    const providerTab = getLastRuleBlockFrom(
      segmentedControlStylesheet,
      ":global(.settings-provider-tab)"
    );
    const providerTabActive = getLastRuleBlockFrom(
      segmentedControlStylesheet,
      ":global(.settings-provider-tab.active)"
    );
    const providerSubnav = getLastRuleBlockFrom(
      segmentedControlStylesheet,
      ":global(.settings-provider-subnav)"
    );
    const providerSubnavActive = getLastRuleBlockFrom(
      segmentedControlStylesheet,
      ":global(.settings-provider-subnav-button.active)"
    );
    const shortcutsTabs = getLastRuleBlockFrom(
      segmentedControlStylesheet,
      ":global(.shortcuts-category-tabs)"
    );
    const shortcutsTab = getLastRuleBlockFrom(
      segmentedControlStylesheet,
      ":global(.shortcuts-category-tab)"
    );
    const shortcutsTabActive = getLastRuleBlockFrom(
      segmentedControlStylesheet,
      ":global(.shortcuts-category-tab.active)"
    );

    expect(providerTabs).toContain("background: transparent");
    expect(providerTabs).toContain("border: none");
    expect(providerTabs).toContain("padding: 0");
    expect(providerTab).toContain("background: transparent");
    expect(providerTab).toContain("border-color: transparent");
    expect(providerTabActive).toContain("background: var(--bg-active)");
    expect(providerTabActive).toContain("border-color: var(--border-focus)");
    expect(providerTabActive).not.toContain("var(--accent-blue)");
    expect(providerSubnav).toContain("background: transparent");
    expect(providerSubnav).toContain("border-bottom: 1px solid var(--border)");
    expect(providerSubnavActive).toContain("background: var(--bg-active)");
    expect(providerSubnavActive).toContain("border-color: var(--border-focus)");
    expect(shortcutsTabs).toContain("background: transparent");
    expect(shortcutsTabs).toContain("border: none");
    expect(shortcutsTabs).toContain("padding: 0");
    expect(shortcutsTab).toContain("background: transparent");
    expect(shortcutsTab).toContain("border-color: transparent");
    expect(shortcutsTabActive).toContain("background: var(--bg-active)");
    expect(shortcutsTabActive).toContain("border-color: var(--border-focus)");
    expect(shortcutsTabActive).not.toContain(
      "color-mix(in srgb, var(--accent-blue) 18%, var(--bg-surface))"
    );
  });

  it("keeps shortcut bindings rendered as editor-style keycaps through the shared kbd primitive", () => {
    const keycap = getLastRuleBlockFrom(kbdStylesheet, ":global(.shortcuts-key)");
    const hover = getLastRuleBlockFrom(kbdStylesheet, ":global(.shortcuts-key):hover");
    const focus = getLastRuleBlockFrom(kbdStylesheet, ":global(.shortcuts-key):focus-visible");

    expect(keycap).toContain("display: inline-flex");
    expect(keycap).toContain("align-items: center");
    expect(keycap).toContain("justify-content: center");
    expect(keycap).toContain("background: color-mix");
    expect(keycap).toContain("color: var(--text-primary)");
    expect(keycap).toContain("border-radius: var(--radius-sm)");
    expect(hover).toContain("border-color: var(--border-focus)");
    expect(hover).toContain("background: var(--bg-active)");
    expect(focus).toContain("border-color: var(--border-focus)");
  });

  it("keeps shortcut settings rows aligned with editor-pane list treatment instead of standalone cards", () => {
    const categoryTabsBase = getRuleBlocksFrom(stylesheet, ".shortcuts-category-tabs")[0];
    const categoryTabsMobile = getLastRuleBlock(".shortcuts-category-tabs");
    const categoryTab = getLastRuleBlock(".shortcuts-category-tab");
    const categoryTabActive = getLastRuleBlock(".shortcuts-category-tab.active");
    const listBase = getRuleBlocksFrom(stylesheet, ".shortcuts-list")[0];
    const listMobile = getLastRuleBlock(".shortcuts-list");
    const itemBase = getRuleBlocksFrom(stylesheet, ".shortcuts-item")[0];
    const itemMobile = getLastRuleBlock(".shortcuts-item");
    const customItem = getLastRuleBlock(".shortcuts-item-custom");
    const footerBase = getRuleBlocksFrom(stylesheet, ".shortcuts-footer")[0];
    const footerMobile = getLastRuleBlock(".shortcuts-footer");

    expect(categoryTabsBase).toContain("background: transparent");
    expect(categoryTabsBase).toContain("border: none");
    expect(categoryTabsBase).toContain("padding: 0");
    expect(categoryTabsMobile).toContain("padding: 0 var(--sp-4)");
    expect(categoryTab).toContain("background: transparent");
    expect(categoryTab).toContain("border: 1px solid transparent");
    expect(categoryTabActive).toContain("background: var(--bg-active)");
    expect(categoryTabActive).toContain("border-color: var(--border-focus)");
    expect(categoryTabActive).not.toContain("rgba(108, 182, 255, 0.2)");
    expect(listBase).toContain("gap: 0");
    expect(listBase).toContain("border-top: 1px solid var(--border)");
    expect(listMobile).toContain("margin: 0");
    expect(itemBase).toContain("padding: var(--sp-3) var(--sp-4)");
    expect(itemBase).toContain("background: transparent");
    expect(itemBase).toContain("border: none");
    expect(itemBase).toContain("border-bottom: 1px solid var(--border)");
    expect(itemBase).toContain("border-radius: 0");
    expect(itemMobile).toContain("flex-direction: column");
    expect(itemMobile).toContain("align-items: flex-start");
    expect(customItem).toContain("background: color-mix");
    expect(customItem).not.toContain("rgba(241, 184, 106, 0.05)");
    expect(footerBase).toContain("display: flex");
    expect(footerBase).toContain("padding: var(--sp-3) var(--sp-4) 0");
    expect(footerBase).toContain("border-top: 1px solid var(--border)");
    expect(footerMobile).toContain("padding-left: var(--sp-4)");
    expect(footerMobile).toContain("padding-right: var(--sp-4)");
  });

  it("keeps provider config editing closer to embedded editor panes than modal-like cards", () => {
    const providerConfigStack = getLastRuleBlock(".settings-provider-config-stack--fill-height");
    const providerContentFill = getLastRuleBlock(".settings-provider-content--fill-height");
    const configCardBase = getRuleBlocksFrom(stylesheet, ".config-card")[0];
    const configCardHeaderBase = getRuleBlocksFrom(stylesheet, ".config-card-header")[0];
    const configCardBody = getLastRuleBlock(".config-card-body");
    const configCardBodyFillHeight = getLastRuleBlock(".config-card-body--fill-height");
    const configCardBodyFillHeightMonaco = getLastRuleBlock(
      ".config-card-body--fill-height > .monaco-host"
    );
    const configCardBodyFillHeightActions = getLastRuleBlock(
      ".config-card-body--fill-height > .config-card-actions"
    );
    const configCardActionsBase = getRuleBlocksFrom(stylesheet, ".config-card-actions")[0];
    const configCardMobile = getLastGroupedRuleBlockFrom(
      stylesheet,
      /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.config-card\s*\{([^}]*)\}/g
    );
    const configHeaderActionsMobile = getLastGroupedRuleBlockFrom(
      stylesheet,
      /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.config-card-header,\s*\.config-card-actions\s*\{([^}]*)\}/g
    );
    const configEmptyStateBase = getRuleBlocksFrom(stylesheet, ".config-empty-state")[0];
    const configEmptyIcon = getLastRuleBlock(".config-empty-icon");
    const configErrorBase = getRuleBlocksFrom(stylesheet, ".config-card-error")[0];

    expect(providerConfigStack).toContain("display: flex");
    expect(providerConfigStack).toContain("min-height: 0");
    expect(providerContentFill).toContain("flex-direction: column");
    expect(configCardBase).toContain("margin-top: var(--sp-4)");
    expect(configCardBase).toContain("border-radius: var(--radius-md)");
    expect(configCardBase).toContain("box-shadow: none");
    expect(configCardBase).not.toContain("var(--radius-lg)");
    expect(configCardMobile).toContain("border-radius: 0");
    expect(configCardHeaderBase).toContain("background: transparent");
    expect(configCardHeaderBase).toContain("padding: var(--sp-3) var(--sp-4)");
    expect(configCardHeaderBase).not.toContain("cursor: pointer");
    expect(configHeaderActionsMobile).toContain("padding-left: var(--sp-4)");
    expect(configCardBody).toContain("background: transparent");
    expect(configCardBodyFillHeight).toContain("display: flex");
    expect(configCardBodyFillHeight).toContain("flex-direction: column");
    expect(configCardBodyFillHeightMonaco).toContain("flex: 1");
    expect(configCardBodyFillHeightMonaco).toContain("min-height: 0");
    expect(configCardBodyFillHeightActions).toContain("flex: 0 0 auto");
    expect(configCardActionsBase).toContain("border-top: 1px solid var(--border)");
    expect(configCardActionsBase).toContain("background: transparent");
    expect(configEmptyStateBase).toContain("align-items: flex-start");
    expect(configEmptyStateBase).toContain("text-align: left");
    expect(configEmptyIcon).toContain("font-size: var(--text-sm)");
    expect(configEmptyIcon).not.toContain("48px");
    expect(configErrorBase).toContain("background: color-mix");
    expect(configErrorBase).toContain("border-top: 1px solid var(--border)");
  });

  it("keeps provider base controls aligned with inspector-style config rows on desktop and mobile", () => {
    const configField = getLastRuleBlock(".settings-config-field");
    const configLabel = getLastRuleBlock(".settings-config-label");
    const argsInput = getLastRuleBlock(".settings-provider-args-input");
    const commandPreview = getLastRuleBlock(".settings-command-preview");
    const providerMobileEntryBase = getRuleBlocksFrom(
      stylesheet,
      ".settings-provider-mobile-entry"
    )[0];
    const providerMobileEntryMobile = getLastRuleBlock(".settings-provider-mobile-entry");
    const providerMobileEntryMeta = getLastRuleBlock(".settings-provider-mobile-entry__meta");

    expect(configField).toContain("display: flex");
    expect(configField).toContain("flex-direction: column");
    expect(configField).toContain("gap: var(--sp-2)");
    expect(configField).toContain("margin-bottom: var(--sp-4)");
    expect(configLabel).toContain("font-size: var(--type-kicker-size)");
    expect(configLabel).toContain("text-transform: uppercase");
    expect(configLabel).toContain("letter-spacing:");
    expect(configLabel).toContain("margin-bottom: 0");
    expect(argsInput).toContain("background: color-mix");
    expect(argsInput).toContain("border-color: var(--border)");
    expect(argsInput).toContain("font-family: var(--type-code-inline-family)");
    expect(commandPreview).toContain("min-height:");
    expect(commandPreview).toContain("white-space: pre-wrap");
    expect(commandPreview).toContain("border-radius: var(--radius-sm)");
    expect(commandPreview).not.toContain("word-break: break-all");
    expect(providerMobileEntryBase).toContain("border: none");
    expect(providerMobileEntryBase).toContain("border-top: 1px solid var(--border)");
    expect(providerMobileEntryBase).toContain("border-radius: 0");
    expect(providerMobileEntryBase).toContain("padding: var(--sp-3) 0");
    expect(providerMobileEntryMobile).toContain("padding-left: var(--sp-4)");
    expect(providerMobileEntryMobile).toContain("padding-right: var(--sp-4)");
    expect(providerMobileEntryMeta).toContain("font-family: var(--type-code-inline-family)");
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

  it("keeps the desktop file tree search and selected row aligned with the polished panel chrome", () => {
    const search = getLastRuleBlock(".file-tree-shell .file-tree-search");
    const searchInput = getLastRuleBlock(".file-tree-shell .file-tree-search-input");
    const row = getLastRuleBlock(".file-tree-shell .tree-item");
    const rowSelected = getLastRuleBlock(".file-tree-shell .tree-item.selected");
    const rowActions = getLastRuleBlock(".file-tree-shell--desktop .tree-item-actions");

    expect(search).toContain("margin: 8px 12px 10px");
    expect(search).toContain("border-radius: 8px");
    expect(search).toContain("background: color-mix(");
    expect(searchInput).toContain("font-size: var(--type-body-strong-size)");
    expect(searchInput).toContain("line-height: var(--type-body-strong-line-height)");
    expect(searchInput).toContain("font-weight: var(--type-body-strong-weight)");
    expect(row).toContain("min-height: 26px");
    expect(row).toContain("border-radius: 8px");
    expect(row).toContain("transition:");
    expect(rowSelected).toContain("border-left: 2px solid");
    expect(rowSelected).toContain("background: color-mix(");
    expect(rowActions).toContain("opacity: 0");
  });

  it("keeps the desktop git panel and command palette on tighter tool-surface chrome", () => {
    const gitScroll = getLastRuleBlock(".git-panel-scroll");
    const gitCommitBlock = getLastRuleBlock(".git-commit-block");
    const gitSection = getLastRuleBlock(".git-panel-section");
    const gitWorktreeRow = getLastRuleBlock(".git-worktree-row");
    const gitHistoryRow = getLastRuleBlock(".git-history-row");
    const commandPalette = getLastRuleBlock(".command-palette");
    const commandPaletteDesktop = getLastRuleBlock(".command-palette--desktop");
    const commandPaletteHeader = getLastRuleBlock(".command-palette-header");
    const commandPaletteSearch = getLastRuleBlock(".command-palette-search");
    const commandPaletteItem = getLastRuleBlock(".command-palette--desktop .command-palette-item");

    expect(gitScroll).toContain("gap: 14px");
    expect(gitCommitBlock).toContain("gap: 10px");
    expect(gitSection).toContain("gap: 8px");
    expect(gitWorktreeRow).toContain("min-height: 28px");
    expect(gitHistoryRow).toContain("min-height: 34px");
    expect(commandPalette).toContain("max-width: var(--desktop-modal-max-width-md)");
    expect(commandPaletteDesktop).toContain("overflow: hidden");
    expect(commandPaletteHeader).toContain("padding: var(--sp-3) var(--sp-4)");
    expect(commandPaletteSearch).toContain("padding: var(--sp-3) var(--sp-4)");
    expect(commandPaletteItem).toContain("align-items: center");
    expect(commandPaletteItem).toContain("gap: var(--sp-3)");
    expect(commandPaletteItem).toContain("padding: var(--sp-3) var(--sp-4)");
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

  it("keeps the mobile active session chrome visually flat and aligned with the shell header", () => {
    const viewport = getLastRuleBlock(".mobile-shell__viewport");
    const content = getLastRuleBlock(".mobile-shell__content");
    const landscapeViewport = getLastRuleBlock(
      ".mobile-shell--landscape-compact .mobile-shell__viewport"
    );
    const sessionCard = getLastRuleBlock(".mobile-shell__agent-stage > .session-card");
    const progress = getLastRuleBlock(".mobile-shell__agent-stage .session-progress");
    const header = getLastRuleBlock(".mobile-shell__agent-stage .session-header");
    const headerLeft = getLastRuleBlock(".mobile-shell__agent-stage .session-header-left");
    const titleRow = getLastRuleBlock(".mobile-shell__agent-stage .session-title-row");
    const badges = getLastGroupedRuleBlock(
      /\.mobile-shell__agent-stage \.session-provider-badge,\s*\.mobile-shell__agent-stage \.session-state-badge\s*\{([^}]*)\}/g
    );
    const supervisorBadge = getLastRuleBlock(".mobile-shell__agent-stage .mobile-supervisor-badge");
    const supervisorLabel = getLastRuleBlock(
      ".mobile-shell__agent-stage .mobile-supervisor-badge__label"
    );

    expect(viewport).toContain("padding: 0");
    expect(viewport).toContain("border-top:");
    expect(viewport).not.toContain("padding: 4px");
    expect(landscapeViewport).toContain("padding-top: 0");
    expect(content).toContain("gap: 4px");
    expect(sessionCard).toContain("border-radius: 0");
    expect(sessionCard).toContain("box-shadow: none");
    expect(progress).toContain("display: none");
    expect(header).toContain("padding: 4px");
    expect(header).toContain("border-bottom:");
    expect(header).not.toContain("linear-gradient(");
    expect(headerLeft).toContain("gap: 6px");
    expect(titleRow).toContain("gap: 6px");
    expect(badges).toContain("height: 15px");
    expect(badges).toContain("border-radius: 3px");
    expect(supervisorBadge).toContain("min-height: 26px");
    expect(supervisorBadge).toContain("border-radius: 4px");
    expect(supervisorBadge).not.toContain("border-radius: var(--radius-lg)");
    expect(supervisorLabel).toContain("font-size: var(--type-kicker-size)");
    expect(supervisorLabel).toContain("line-height: var(--type-kicker-line-height)");
    expect(supervisorLabel).toContain("font-weight: var(--type-kicker-weight)");
  });

  it("keeps supervisor entry icons and labels vertically centered", () => {
    const desktopButton = getLastRuleBlock(".supervisor-enable-btn");
    const desktopButtonIcon = getLastRuleBlock(".supervisor-enable-btn > .themed-icon");
    const desktopButtonIconSvg = getLastRuleBlock(".supervisor-enable-btn > .themed-icon svg");
    const desktopButtonLabel = getLastRuleBlock(".supervisor-enable-btn > span");
    const mobileBadge = getLastGroupedRuleBlock(
      /\.mobile-supervisor-badge\s*\{([^}]*justify-content:[^}]*)\}/g
    );
    const mobileBadgeIcon = getLastRuleBlock(".mobile-supervisor-badge__icon");
    const mobileBadgeIconSvg = getLastRuleBlock(".mobile-supervisor-badge__icon svg");
    const mobileBadgeLabel = getLastRuleBlock(".mobile-supervisor-badge__label");

    expect(desktopButton).toContain("justify-content: center");
    expect(desktopButton).toContain("line-height: var(--type-label-line-height)");
    expect(desktopButtonIcon).toContain("display: inline-flex");
    expect(desktopButtonIconSvg).toContain("display: block");
    expect(desktopButtonLabel).toContain("display: inline-flex");
    expect(desktopButtonLabel).toContain("align-items: center");
    expect(desktopButtonLabel).toContain("line-height: 1");
    expect(mobileBadge).toContain("justify-content: center");
    expect(mobileBadge).toContain("line-height: 1");
    expect(mobileBadgeIcon).toContain("display: inline-flex");
    expect(mobileBadgeIcon).toContain("align-items: center");
    expect(mobileBadgeIconSvg).toContain("display: block");
    expect(mobileBadgeLabel).toContain("display: inline-flex");
    expect(mobileBadgeLabel).toContain("align-items: center");
    expect(mobileBadgeLabel).toContain("line-height: var(--type-label-line-height)");
  });

  it("keeps the mobile terminal keybar flow-positioned and token-driven", () => {
    const shell = getLastRuleBlock(".xterm-host-shell");
    const shellWithMobileInput = getLastRuleBlock(".xterm-host-shell--mobile-input");
    const host = getLastRuleBlock(".xterm-host");
    const keybar = getLastRuleBlock(".mobile-terminal-input-bar");
    const actions = getLastRuleBlock(".mobile-terminal-input-bar__actions");
    const actionButton = getLastRuleBlock(".mobile-terminal-input-bar__action");
    const keys = getLastRuleBlock(".mobile-terminal-input-bar__keys");
    const key = getLastRuleBlock(".mobile-terminal-input-bar__key");
    const ctrlKey = getLastRuleBlock(".mobile-terminal-input-bar__ctrl");
    const shiftKey = getLastRuleBlock(".mobile-terminal-input-bar__shift");
    const escapeKey = getLastRuleBlock('.mobile-terminal-input-bar__key[aria-label="Escape"]');
    const tabKey = getLastRuleBlock('.mobile-terminal-input-bar__key[aria-label="Tab"]');
    const enterKey = getLastRuleBlock('.mobile-terminal-input-bar__key[aria-label="Enter"]');
    const upArrowKey = getLastRuleBlock('.mobile-terminal-input-bar__key[aria-label="Up arrow"]');
    const ctrlLocked = getLastRuleBlock(
      '.mobile-terminal-input-bar__ctrl[data-ctrl-mode="locked"]'
    );
    const shiftArmed = getLastRuleBlock(
      '.mobile-terminal-input-bar__shift[data-shift-armed="true"]'
    );

    expect(shell).toContain("display: flex");
    expect(shell).toContain("flex-direction: column");
    expect(shell).toContain("min-height: 0");
    expect(shellWithMobileInput).toContain("gap: 0");
    expect(host).toContain("position: relative");
    expect(host).toContain("flex: 1 1 auto");
    expect(host).toContain("min-height: 0");
    expect(keybar).toContain("flex-shrink: 0");
    expect(keybar).not.toContain("position: absolute");
    expect(keybar).toContain("min-width: 0");
    expect(keybar).toContain("border-top:");
    expect(keybar).not.toContain("border-bottom:");
    expect(actions).toContain("border-right:");
    expect(actions).toContain("gap: 3px");
    expect(actions).toContain("margin-right: var(--sp-1)");
    expect(actions).toContain("padding-right: var(--sp-1)");
    expect(actionButton).toContain("min-height: 20px");
    expect(actionButton).toContain("font-size: 9px");
    expect(keys).toContain("display: flex");
    expect(keys).toContain("overflow-x: auto");
    expect(keys).toContain("gap: 3px");
    expect(key).toContain("min-height: 20px");
    expect(key).toContain("font-size: 9px");
    expect(key).toContain("border-radius: var(--radius-sm)");
    expect(key).not.toContain("border-radius: 999px");
    expect(ctrlKey).toContain("min-width: 28px");
    expect(shiftKey).toContain("min-width: 28px");
    expect(escapeKey).toContain("min-width: 28px");
    expect(tabKey).toContain("min-width: 28px");
    expect(enterKey).toContain("min-width: 34px");
    expect(upArrowKey).toContain("min-width: 20px");
    expect(ctrlLocked).toContain("var(--accent-blue)");
    expect(shiftArmed).toContain("var(--accent-blue)");
  });

  it("keeps the mobile fullscreen terminal chrome on a single compact tool surface", () => {
    const terminalSheet = getLastRuleBlock(".mobile-terminal-sheet");
    const mobileTerminal = getLastRuleBlock(".mobile-terminal-sheet .bottom-terminal");
    const toolbar = getLastRuleBlock(".bottom-terminal--mobile-fullscreen .terminal-toolbar");
    const mobileToolbarRow = getLastRuleBlock(
      ".bottom-terminal--mobile-fullscreen .terminal-toolbar-mobile-row"
    );
    const selector = getLastRuleBlock(".bottom-terminal--mobile-fullscreen .terminal-selector");
    const selectorButton = getLastRuleBlock(
      ".bottom-terminal--mobile-fullscreen .terminal-selector-btn"
    );
    const placeholder = getLastRuleBlock(
      ".bottom-terminal--mobile-fullscreen .terminal-toolbar-mobile-placeholder"
    );
    const panelButton = getLastRuleBlock(".bottom-terminal--mobile-fullscreen .panel-toolbar-btn");
    const xterm = getLastRuleBlock(".bottom-terminal--mobile-fullscreen .bottom-terminal-xterm");

    expect(terminalSheet).toContain("padding: 0");
    expect(terminalSheet).not.toContain("linear-gradient(");
    expect(mobileTerminal).toContain("border-radius: 0");
    expect(mobileTerminal).toContain("box-shadow: none");
    expect(toolbar).toContain("min-height: 32px");
    expect(toolbar).toContain("padding: 0 var(--sp-2)");
    expect(toolbar).not.toContain("background: linear-gradient(");
    expect(mobileToolbarRow).toContain("display: flex");
    expect(mobileToolbarRow).toContain("align-items: center");
    expect(mobileToolbarRow).toContain("width: 100%");
    expect(selector).toContain("flex: 1");
    expect(selectorButton).toContain("border-radius: var(--radius-sm)");
    expect(selectorButton).not.toContain("border-radius: 999px");
    expect(placeholder).toContain("border: none");
    expect(placeholder).toContain("background: transparent");
    expect(panelButton).toContain("border-radius: var(--radius-sm)");
    expect(panelButton).not.toContain("border-radius: 999px");
    expect(xterm).toContain("padding: 0 var(--sp-2) var(--sp-1)");
  });

  it("keeps the supervisor timeout setting aligned as a label-left control-right row", () => {
    const inlineFieldBase = getRuleBlocksFrom(stylesheet, ".settings-config-field--inline")[0];
    const inlineFieldMobile = getLastRuleBlock(".settings-config-field--inline");
    const inlineLabel = getLastRuleBlock(".settings-config-field--inline .settings-config-label");
    const controlBase = getRuleBlocksFrom(stylesheet, ".settings-config-control")[0];
    const controlMobile = getLastRuleBlock(".settings-config-control");
    const compactInputBase = getRuleBlocksFrom(stylesheet, ".settings-input-compact")[0];
    const compactInputMobile = getLastRuleBlock(".settings-input-compact");

    expect(inlineFieldBase).toContain("display: grid");
    expect(inlineFieldBase).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(inlineFieldBase).toContain("align-items: center");
    expect(inlineFieldMobile).toContain("grid-template-columns: 1fr");
    expect(inlineFieldMobile).toContain("align-items: flex-start");
    expect(inlineLabel).toContain("margin-bottom: 0");
    expect(controlBase).toContain("justify-content: flex-end");
    expect(controlMobile).toContain("justify-content: flex-start");
    expect(compactInputBase).toContain("text-align: right");
    expect(compactInputMobile).toContain("text-align: left");
  });

  it("removes the unused legacy provider card chrome from settings styles", () => {
    expect(stylesheet).not.toContain(".settings-provider-card {");
    expect(stylesheet).not.toContain(".settings-provider-header {");
    expect(stylesheet).not.toContain(".settings-provider-badge {");
    expect(stylesheet).not.toContain(".settings-provider-meta {");
  });
});
