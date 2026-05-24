// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
const drawerStylesheet = readFileSync(
  `${process.cwd()}/src/components/ui/drawer/index.module.css`,
  "utf8"
);
const localOverlayStylesheet = readFileSync(
  `${process.cwd()}/src/components/ui/local-overlay/index.module.css`,
  "utf8"
);
const progressBarStylesheet = readFileSync(
  `${process.cwd()}/src/components/ui/progress-bar/index.module.css`,
  "utf8"
);
const confirmDialogStyles = readFileSync(
  `${process.cwd()}/src/components/ui/confirm-dialog/index.module.css`,
  "utf8"
);
const modalStylesheet = readFileSync(
  `${process.cwd()}/src/components/ui/modal/index.module.css`,
  "utf8"
);
const migrationInventory = readFileSync(`${process.cwd()}/src/components/ui/MIGRATION.md`, "utf8");
const buttonStyles = readFileSync(
  `${process.cwd()}/src/components/ui/button/index.module.css`,
  "utf8"
);
const iconButtonStyles = readFileSync(
  `${process.cwd()}/src/components/ui/icon-button/index.module.css`,
  "utf8"
);
const popoverStyles = readFileSync(
  `${process.cwd()}/src/components/ui/popover/index.module.css`,
  "utf8"
);
const inputStyles = readFileSync(
  `${process.cwd()}/src/components/ui/input/index.module.css`,
  "utf8"
);
const datetimePickerStyles = readFileSync(
  `${process.cwd()}/src/components/ui/datetime-picker/index.module.css`,
  "utf8"
);
const textareaStyles = readFileSync(
  `${process.cwd()}/src/components/ui/textarea/index.module.css`,
  "utf8"
);
const tabsStyles = readFileSync(`${process.cwd()}/src/components/ui/tabs/index.module.css`, "utf8");
const statusDotStylesheet = readFileSync(
  `${process.cwd()}/src/components/ui/status-dot/index.module.css`,
  "utf8"
);

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

function hasRuleBlockFrom(source: string, selector: string) {
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  const normalizedSelector = selector.replace(/\s+/g, " ").trim();
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(source))) {
    const selectors = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((entry) => entry.replace(/\s+/g, " ").trim());

    if (selectors.includes(normalizedSelector)) {
      return true;
    }
  }

  return false;
}

function hasRuleBlock(selector: string) {
  return hasRuleBlockFrom(stylesheet, selector);
}

function getLastRuleBlock(selector: string) {
  return getLastRuleBlockFrom(stylesheet, selector);
}

async function buildRuntimeStylesheet() {
  const tempDir = mkdtempSync(join(process.cwd(), ".vite-style-build-"));
  const entryFile = join(tempDir, "runtime-entry.ts");

  writeFileSync(
    entryFile,
    [
      'import buttonStyles from "../src/components/ui/button/index.module.css";',
      'import tabsStyles from "../src/components/ui/tabs/index.module.css";',
      "void [buttonStyles.btn, tabsStyles.tab];",
    ].join("\n"),
    "utf8"
  );

  try {
    const output = await build({
      configFile: false,
      root: process.cwd(),
      plugins: [],
      build: {
        write: false,
        outDir: join(tempDir, "dist"),
        cssCodeSplit: true,
        lib: {
          entry: entryFile,
          formats: ["es"],
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
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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

  it("keeps toast feedback chrome on semantic foundation tokens", () => {
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
    expect(getLastRuleBlockFrom(toastStyles, ".success")).toContain(
      "border-left: 3px solid var(--state-success-text)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".error")).toContain(
      "border-left: 3px solid var(--state-error-text)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".warning")).toContain(
      "border-left: 3px solid var(--state-warning-text)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".info")).toContain(
      "border-left: 3px solid var(--state-info-text)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".success .icon")).toContain(
      "color: var(--state-success-icon)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".success .icon")).toContain(
      "background: var(--state-success-bg)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".error .icon")).toContain(
      "color: var(--state-error-icon)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".error .icon")).toContain(
      "background: var(--state-error-bg)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".warning .icon")).toContain(
      "color: var(--state-warning-icon)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".warning .icon")).toContain(
      "background: var(--state-warning-bg)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".info .icon")).toContain(
      "color: var(--state-info-icon)"
    );
    expect(getLastRuleBlockFrom(toastStyles, ".info .icon")).toContain(
      "background: var(--state-info-bg)"
    );
  });

  it("keeps confirm dialog danger icons on icon tokens", () => {
    expect(getLastRuleBlockFrom(confirmDialogStyles, ".titleDanger")).toContain(
      "var(--icon-warning)"
    );
    expect(getLastRuleBlockFrom(confirmDialogStyles, ".iconDanger")).toContain(
      "color: var(--icon-warning)"
    );
    expect(getLastRuleBlockFrom(confirmDialogStyles, ".headerLeading")).toContain(
      "align-items: center"
    );
    expect(getLastRuleBlockFrom(confirmDialogStyles, ".headerLeading")).toContain(
      "gap: var(--sp-3)"
    );
    expect(getLastRuleBlockFrom(confirmDialogStyles, ".headerCopy")).toContain("min-width: 0");
  });

  it("maps text-entry and navigation primitives onto semantic typography tokens", async () => {
    expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain(
      "font-size: var(--type-body-3-size)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain(
      "font-weight: var(--type-body-3-weight)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain(
      "line-height: var(--type-body-3-line-height)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".sm")).toContain(
      "font-size: var(--type-body-6-size)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".sm")).toContain(
      "font-weight: var(--type-body-6-weight)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".lg")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(inputStyles, ".input")).toContain(
      "font-size: var(--type-body-3-size)"
    );
    expect(getLastRuleBlockFrom(inputStyles, ".input")).toContain(
      "font-weight: var(--type-body-3-weight)"
    );
    expect(getLastRuleBlockFrom(inputStyles, ".sm")).toContain(
      "font-size: var(--type-body-6-size)"
    );
    expect(getLastRuleBlockFrom(inputStyles, ".sm")).toContain(
      "font-weight: var(--type-body-6-weight)"
    );
    expect(getLastRuleBlockFrom(inputStyles, ".lg")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(textareaStyles, ".input")).toContain(
      "font-size: var(--type-body-3-size)"
    );
    expect(getLastRuleBlockFrom(textareaStyles, ".input")).toContain(
      "font-weight: var(--type-body-3-weight)"
    );
    expect(getLastRuleBlockFrom(textareaStyles, ".lg")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain(
      "font-size: var(--type-body-6-size)"
    );
    expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain(
      "font-weight: var(--type-body-6-weight)"
    );
    expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain(
      "line-height: var(--type-body-6-line-height)"
    );
    expect(getLastRuleBlockFrom(tabsStyles, ":global(.worktree-tab)")).toContain(
      "font-size: var(--type-body-6-size)"
    );
    expect(getLastRuleBlockFrom(tabsStyles, ":global(.worktree-tab)")).toContain(
      "font-weight: var(--type-body-6-weight)"
    );
    expect(getLastRuleBlockFrom(datetimePickerStyles, ".action")).toContain(
      "font-size: var(--type-body-3-size)"
    );
    expect(getLastRuleBlockFrom(datetimePickerStyles, ".action")).toContain(
      "font-weight: var(--type-body-3-weight)"
    );
    expect(getLastRuleBlockFrom(datetimePickerStyles, ".calendarTitle")).toContain(
      "font-size: var(--type-heading-6-size)"
    );
    expect(getLastRuleBlockFrom(datetimePickerStyles, ".calendarWeekday")).toContain(
      "font-size: var(--type-body-6-size)"
    );
    expect(getLastRuleBlockFrom(datetimePickerStyles, ".calendarDay")).toContain(
      "font-size: var(--type-body-3-size)"
    );

    const runtimeStylesheet = await buildRuntimeStylesheet();

    expect(getLastRuleBlockFrom(runtimeStylesheet, ".btn")).toContain(
      "font-size:var(--type-body-3-size)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".btn")).toContain(
      "font-weight:var(--type-body-3-weight)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".btn-sm")).toContain(
      "font-size:var(--type-body-6-size)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".btn-sm")).toContain(
      "font-weight:var(--type-body-6-weight)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".panel-tab")).toContain(
      "font-size:var(--type-body-6-size)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".panel-tab")).toContain(
      "font-weight:var(--type-body-6-weight)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".worktree-tab")).toContain(
      "font-size:var(--type-body-6-size)"
    );
    expect(getLastRuleBlockFrom(runtimeStylesheet, ".worktree-tab")).toContain(
      "font-weight:var(--type-body-6-weight)"
    );
  });

  it("maps control and navigation primitives onto semantic density and radius roles", () => {
    expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain(
      "height: var(--control-height-md)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain(
      "border-radius: var(--radius-control)"
    );
    expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain(
      "padding: 0 var(--inset-control-inline)"
    );

    expect(getLastRuleBlockFrom(iconButtonStyles, ".root")).toContain(
      "width: var(--icon-button-size-md)"
    );
    expect(getLastRuleBlockFrom(iconButtonStyles, ".root")).toContain(
      "height: var(--icon-button-size-md)"
    );
    expect(getLastRuleBlockFrom(iconButtonStyles, ".root")).toContain(
      "border-radius: var(--radius-control)"
    );
    expect(getLastRuleBlockFrom(iconButtonStyles, ".root:focus-visible")).toContain(
      "box-shadow: none"
    );
    expect(getLastRuleBlockFrom(iconButtonStyles, ".root:focus-visible")).toContain(
      "outline: none"
    );

    expect(getLastRuleBlockFrom(inputStyles, ".input")).toContain(
      "height: var(--control-height-md)"
    );
    expect(getLastRuleBlockFrom(inputStyles, ".input")).toContain(
      "padding: 0 var(--inset-control-inline)"
    );
    expect(getLastRuleBlockFrom(inputStyles, ".input")).toContain(
      "border-radius: var(--radius-control)"
    );

    expect(getLastRuleBlockFrom(textareaStyles, ".input")).toContain(
      "border-radius: var(--radius-control)"
    );
    expect(getLastRuleBlockFrom(textareaStyles, ".textarea")).toContain(
      "padding: var(--inset-control-block) var(--inset-control-inline)"
    );

    const switchStyles = readFileSync(
      `${process.cwd()}/src/components/ui/switch/index.module.css`,
      "utf8"
    );
    expect(getLastRuleBlockFrom(switchStyles, ".track")).toContain(
      "border-radius: var(--radius-pill)"
    );

    expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain(
      "border-radius: var(--radius-control)"
    );
    expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain(
      "padding: var(--inset-control-block) var(--inset-control-inline)"
    );

    expect(
      getRuleBlocksFrom(segmentedControlStylesheet, ":global(.shortcuts-category-tabs)").some(
        (block) => block.includes("gap: var(--gap-control)")
      )
    ).toBe(true);
    expect(getLastRuleBlockFrom(segmentedControlStylesheet, ".segmentedControlOption")).toContain(
      "border-radius: var(--radius-control)"
    );

    expect(getLastRuleBlockFrom(kbdStylesheet, ".kbd")).toContain(
      "border-radius: var(--radius-control-sm)"
    );
    expect(getLastRuleBlockFrom(popoverStyles, ".content")).toContain(
      "border-radius: var(--radius-overlay)"
    );

    const actionMenuStyles = readFileSync(
      `${process.cwd()}/src/components/ui/action-menu/index.module.css`,
      "utf8"
    );
    expect(getLastRuleBlockFrom(actionMenuStyles, ".menu")).toContain(
      "padding: var(--inset-panel)"
    );
  });

  it("keeps desktop popovers above modal shells so picker overlays are not occluded", () => {
    expect(getLastRuleBlockFrom(modalStylesheet, ":global(.modal-overlay)")).toContain(
      "z-index: var(--z-modal-backdrop)"
    );
    expect(getLastRuleBlockFrom(popoverStyles, ".content")).toContain("z-index: var(--z-popover)");
  });

  it("maps display and status primitives onto semantic typography roles", () => {
    expect(
      getRuleBlocksFrom(tagStyles, ":where(.tag)").some((block) =>
        block.includes("font-size: var(--type-body-6-size)")
      )
    ).toBe(true);
    expect(
      getRuleBlocksFrom(tagStyles, ":where(.tag)").some((block) =>
        block.includes("letter-spacing: 0.08em")
      )
    ).toBe(true);
    expect(getLastRuleBlockFrom(tagStyles, ".sm")).not.toContain("font-size:");

    expect(getLastRuleBlockFrom(badgeStyles, ":where(.badge)")).toContain(
      "font-size: var(--type-body-6-size)"
    );
    expect(getLastRuleBlockFrom(badgeStyles, ":where(.badge)")).toContain(
      "font-weight: var(--type-body-6-weight)"
    );
    expect(getLastRuleBlockFrom(pillStylesheet, ".pill")).toContain(
      "font-size: var(--type-body-6-size)"
    );
    expect(getLastRuleBlockFrom(pillStylesheet, ".pill")).toContain(
      "font-weight: var(--type-body-6-weight)"
    );
    expect(getLastRuleBlockFrom(tooltipStyles, ".tooltip")).toContain(
      "font-size: var(--type-body-5-size)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".title")).toContain(
      "font-size: var(--type-body-6-size)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".message")).toContain(
      "font-size: var(--type-body-5-size)"
    );
    expect(getLastRuleBlockFrom(modalStyles, ".title")).toContain(
      "font-size: var(--type-heading-4-size)"
    );
    expect(getLastRuleBlockFrom(emptyStateStyles, ".title")).toContain(
      "font-size: var(--type-heading-5-size)"
    );
    expect(getLastRuleBlockFrom(emptyStateStyles, ".description")).toContain(
      "font-size: var(--type-body-3-size)"
    );
  });

  it("maps feedback and overlay primitives onto semantic foundation roles", () => {
    const notice = getLastRuleBlockFrom(noticeStylesheet, ".notice");
    const tooltip = getLastRuleBlockFrom(tooltipStyles, ".tooltip");
    const modalOverlay = getLastRuleBlockFrom(modalStyles, ".overlay");
    const drawerBackdrop = getLastRuleBlockFrom(drawerStylesheet, ".backdrop");
    const localOverlay = getLastRuleBlockFrom(localOverlayStylesheet, ".overlay");
    const localOverlayCard = getLastRuleBlockFrom(localOverlayStylesheet, ".card");
    const toast = getLastRuleBlockFrom(toastStyles, ".toast");
    const progressRoot = getLastRuleBlockFrom(progressBarStylesheet, ".root");
    const emptyState = getLastRuleBlockFrom(emptyStateStyles, ".root");

    expect(getLastRuleBlockFrom(tagStyles, ":where(.tag)")).toContain(
      "border-radius: var(--radius-tag)"
    );
    expect(getLastRuleBlockFrom(badgeStyles, ":where(.badge)")).toContain(
      "border-radius: var(--radius-chip)"
    );
    expect(getLastRuleBlockFrom(pillStylesheet, ".pill")).toContain(
      "border-radius: var(--radius-pill)"
    );

    expect(tooltip).toContain("border: 1px solid var(--surface-overlay-border)");
    expect(tooltip).toContain("border-radius: var(--radius-overlay)");
    expect(tooltip).toContain("background: var(--surface-overlay-bg)");
    expect(tooltip).toContain("box-shadow: var(--surface-overlay-shadow)");

    expect(notice).toContain("gap: var(--gap-content)");
    expect(notice).toContain("padding: var(--inset-control-block) var(--inset-control-inline)");
    expect(notice).toContain("border-radius: var(--radius-overlay)");
    expect(notice).toContain("background: var(--surface-elevated-bg)");
    expect(getLastRuleBlockFrom(noticeStylesheet, ".info")).toContain(
      "border-color: var(--state-info-border)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".info")).toContain(
      "background: var(--state-info-bg)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".success")).toContain(
      "border-color: var(--state-success-border)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".success")).toContain(
      "background: var(--state-success-bg)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".warning")).toContain(
      "border-color: var(--state-warning-border)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".warning")).toContain(
      "background: var(--state-warning-bg)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".error")).toContain(
      "border-color: var(--state-error-border)"
    );
    expect(getLastRuleBlockFrom(noticeStylesheet, ".error")).toContain(
      "background: var(--state-error-bg)"
    );

    expect(modalOverlay).toContain("background: var(--overlay-backdrop)");
    expect(
      getRuleBlocksFrom(modalStyles, ".card").some((block) =>
        block.includes("border: 1px solid var(--surface-overlay-border)")
      )
    ).toBe(true);
    expect(
      getRuleBlocksFrom(modalStyles, ".card").some((block) =>
        block.includes("border-radius: var(--radius-overlay)")
      )
    ).toBe(true);
    expect(
      getRuleBlocksFrom(modalStyles, ".card").some((block) =>
        block.includes("background: var(--surface-overlay-bg)")
      )
    ).toBe(true);
    expect(
      getRuleBlocksFrom(modalStyles, ".card").some((block) =>
        block.includes("box-shadow: var(--surface-overlay-shadow)")
      )
    ).toBe(true);

    expect(drawerBackdrop).toContain("background: var(--overlay-backdrop)");
    expect(
      getRuleBlocksFrom(drawerStylesheet, ".panel").some((block) =>
        block.includes("border: 1px solid var(--surface-overlay-border)")
      )
    ).toBe(true);
    expect(
      getRuleBlocksFrom(drawerStylesheet, ".panel").some((block) =>
        block.includes("border-radius: var(--radius-overlay)")
      )
    ).toBe(true);
    expect(
      getRuleBlocksFrom(drawerStylesheet, ".panel").some((block) =>
        block.includes("background: var(--surface-overlay-bg)")
      )
    ).toBe(true);
    expect(
      getRuleBlocksFrom(drawerStylesheet, ".panel").some((block) =>
        block.includes("box-shadow: var(--surface-overlay-shadow)")
      )
    ).toBe(true);

    expect(localOverlay).toContain("background: var(--overlay-backdrop)");
    expect(localOverlayCard).toContain("border: 1px solid var(--surface-overlay-border)");
    expect(localOverlayCard).toContain("border-radius: var(--radius-local-overlay)");
    expect(localOverlayCard).toContain("background: var(--surface-overlay-bg)");
    expect(localOverlayCard).toContain("box-shadow: var(--surface-overlay-shadow)");

    expect(toast).toContain("border: 1px solid var(--surface-overlay-border)");
    expect(toast).toContain("border-radius: var(--radius-overlay)");
    expect(toast).toContain("background: var(--surface-overlay-bg)");
    expect(toast).toContain("box-shadow: var(--surface-overlay-shadow)");

    expect(progressRoot).toContain("background: var(--state-info-bg)");
    expect(getLastRuleBlockFrom(progressBarStylesheet, ".success")).toContain(
      "--progress-bar-color: var(--state-success-text)"
    );
    expect(getLastRuleBlockFrom(progressBarStylesheet, ".warning")).toContain(
      "--progress-bar-color: var(--state-warning-text)"
    );
    expect(getLastRuleBlockFrom(progressBarStylesheet, ".error")).toContain(
      "--progress-bar-color: var(--state-error-text)"
    );
    expect(getLastRuleBlockFrom(progressBarStylesheet, ".info")).toContain(
      "--progress-bar-color: var(--state-info-text)"
    );
    expect(getLastRuleBlockFrom(progressBarStylesheet, ".neutral")).toContain(
      "--progress-bar-color: var(--state-disabled-text)"
    );

    expect(getLastRuleBlockFrom(statusDotStylesheet, ".dot")).toContain(
      "border-radius: var(--radius-chip)"
    );
    expect(getLastRuleBlockFrom(statusDotStylesheet, ":global(.session-dot-running)")).toContain(
      "--status-dot-current-color: var(--state-info-text)"
    );

    expect(emptyState).toContain("gap: var(--gap-content)");
    expect(emptyState).toContain("padding: var(--inset-dialog) var(--inset-panel)");
  });

  it("keeps config status colors on icon tokens", () => {
    expect(getLastRuleBlock(".config-status--success")).toContain("var(--icon-success)");
    expect(getLastRuleBlock(".config-status--warning")).toContain("var(--icon-warning)");
    expect(getLastRuleBlock(".config-status--info")).toContain("var(--icon-info)");
    expect(getLastRuleBlock(".config-status--error")).toContain("var(--icon-error)");
  });

  it("keeps supervisor detail section titles on the denser body-strong scale", () => {
    const supervisorDetailTitle = getLastRuleBlock(".supervisor-details-section-title");

    expect(supervisorDetailTitle).toContain("font-size: var(--type-body-3-size)");
    expect(supervisorDetailTitle).toContain("line-height: var(--type-body-3-line-height)");
    expect(supervisorDetailTitle).toContain("font-weight: var(--type-body-3-weight)");
  });

  it("keeps supervisor details on a flatter single-surface hierarchy", () => {
    const editButton = getLastRuleBlock(".supervisor-details-edit-btn");
    const detailsSurface = getLastRuleBlock(".supervisor-details-surface");
    const summaryCard = getLastRuleBlock(".supervisor-summary-card");
    const stackedMetaGrid = getLastRuleBlock(".supervisor-meta-grid--stacked");
    const metaItem = getLastRuleBlock(".supervisor-meta-item");
    const reasoningItem = getLastRuleBlock(".supervisor-meta-item--reasoning");
    const errorText = getLastRuleBlock(".supervisor-error");

    expect(editButton).toContain("font-size: var(--type-body-6-size)");
    expect(editButton).toContain("border-color: transparent");
    expect(detailsSurface).not.toContain("border:");
    expect(summaryCard).toContain("border: none");
    expect(summaryCard).toContain("box-shadow: none");
    expect(stackedMetaGrid).toContain("grid-template-columns: 1fr");
    expect(stylesheet).not.toMatch(/(^|,)\s*\.supervisor-details-surface--runtime\b/m);
    expect(metaItem).toContain("padding: 0");
    expect(metaItem).not.toContain("border:");
    expect(reasoningItem).not.toContain("border-style: dashed");
    expect(errorText).toContain("color: var(--accent-pink)");
    expect(errorText).not.toContain("background:");
    expect(errorText).not.toContain("border-left:");
  });

  it("collapses supervisor progress headers based on container width, not only viewport width", () => {
    const progressSurface = getLastRuleBlock(".supervisor-details-surface--progress");
    const progressContainerBlock = getLastGroupedRuleBlock(
      /@container\s*\(max-width:\s*30rem\)\s*\{([\s\S]*?\.supervisor-progress-item__header\s*\{[\s\S]*?\})[\s\S]*?\}/g
    );

    expect(progressSurface).toContain("container-type: inline-size");
    expect(progressContainerBlock).toContain("flex-direction: column");
    expect(progressContainerBlock).toContain("align-items: flex-start");
  });

  it("exposes global mobile safe-area tokens so standalone mobile views keep their padding", () => {
    expect(tokensStylesheet).toContain("--mobile-safe-top: env(safe-area-inset-top, 0px);");
    expect(tokensStylesheet).toContain("--mobile-safe-right: env(safe-area-inset-right, 0px);");
    expect(tokensStylesheet).toContain("--mobile-safe-bottom: env(safe-area-inset-bottom, 0px);");
    expect(tokensStylesheet).toContain("--mobile-safe-left: env(safe-area-inset-left, 0px);");
  });

  it("tracks governed overlay families as complete after convergence", () => {
    expect(migrationInventory).toContain(
      "| Drawer | 🟢 complete | `worktree-modal`, `worktree-manager-surface` | 0 | 2026-05-19 |"
    );
    expect(migrationInventory).toContain(
      "| WorkbenchLayer | 🟢 complete | `command-palette-overlay`, `launch-overlay` | 0 | 2026-05-19 |"
    );
    expect(migrationInventory).toContain(
      "| LocalOverlay | 🟢 complete | upload busy inline overlay, `paste-dialog-overlay`, `xterm-replay-overlay` | 0 | 2026-05-19 |"
    );
  });

  it("does not leave governed desktop overlays on raw feature-owned backdrops", () => {
    expect(stylesheet).not.toMatch(/(^|,)\s*\.command-palette-overlay\b/m);
    expect(stylesheet).not.toMatch(/(^|,)\s*\.launch-overlay\b/m);
    expect(stylesheet).not.toMatch(/(^|,)\s*\.paste-dialog-overlay\b/m);
  });

  it("keeps shared overlay families on semantic z-index tokens", () => {
    const modalStyles = readFileSync(
      `${process.cwd()}/src/components/ui/modal/index.module.css`,
      "utf8"
    );
    const drawerStyles = readFileSync(
      `${process.cwd()}/src/components/ui/drawer/index.module.css`,
      "utf8"
    );
    const workbenchStyles = readFileSync(
      `${process.cwd()}/src/components/ui/workbench-layer/index.module.css`,
      "utf8"
    );
    const localOverlayStyles = readFileSync(
      `${process.cwd()}/src/components/ui/local-overlay/index.module.css`,
      "utf8"
    );

    expect(modalStyles).toContain("var(--z-modal-backdrop)");
    expect(drawerStyles).toContain("var(--z-drawer-backdrop)");
    expect(drawerStyles).toContain("var(--z-drawer)");
    expect(workbenchStyles).toContain("var(--z-workbench-backdrop)");
    expect(workbenchStyles).toContain("var(--z-workbench)");
    expect(localOverlayStyles).toContain("var(--z-local-overlay)");
  });

  it("keeps the workspace launch modal theme-aware", () => {
    const modal = getLastRuleBlock(".launch-modal");
    const launchButton = getLastRuleBlock(".launch-start-btn");
    const launchButtonFocus = getLastRuleBlock(".launch-start-btn:focus-visible");
    const launchButtonHover = getLastRuleBlock(".launch-start-btn:hover");
    const mobileLaunchButton = getLastRuleBlock(".launch-start-btn--mobile");

    expect(modal).not.toContain("rgba(17, 24, 31, 0.98)");
    expect(modal).toContain("var(--bg-surface)");
    expect(launchButton).toContain("gap: var(--gap-default)");
    expect(launchButton).toContain("border-radius: var(--radius-control-lg)");
    expect(launchButtonFocus).toContain("var(--state-focus-ring-width)");
    expect(launchButtonFocus).toContain("var(--state-focus-ring-color)");
    expect(launchButtonHover).toContain("box-shadow: var(--shadow-lg)");
    expect(mobileLaunchButton).toContain("border-radius: var(--radius-xl)");
    expect(mobileLaunchButton).toContain("box-shadow: var(--shadow-lg)");
  });

  it("keeps workspace chrome on tokens instead of hardcoded dark fills", () => {
    const topbar = getLastRuleBlock(".app-topbar");
    const topbarTabs = getLastRuleBlock(".topbar-tabs");
    const topbarTab = getLastRuleBlock(".topbar-tab");
    const topbarTabContent = getLastRuleBlock(".topbar-tab-content");
    const activeTab = getLastRuleBlock(".topbar-tab.active");
    const miniMap = getLastRuleBlock(".workspace-session-mini-map");
    const miniMapViewport = getLastRuleBlock(".workspace-session-mini-map__viewport");
    const miniMapColumn = getLastRuleBlock(".workspace-session-mini-map__column");
    const workspaceResizer = getLastRuleBlock(".workspace-resizer");
    const emptyCard = getLastRuleBlock(".workspace-empty-inner");
    const resolvingCard = getLastRuleBlock(".workspace-resolving-card");
    const workspaceGitEditor = getLastRuleBlock(".workspace-git-editor");
    const resolvingConsoleStatus = getLastRuleBlock(".workspace-resolving-console-status");
    const resolvingSkeleton = getLastGroupedRuleBlock(
      /\.workspace-resolving-pill,\s*\.workspace-resolving-line,\s*\.workspace-resolving-console-line\s*\{([^}]*)\}/g
    );
    const resolvingStrongLine = getLastRuleBlock(".workspace-resolving-line-strong");
    const mainStage = getLastRuleBlock(".workspace-main-stage");
    const sessionTerminal = getLastRuleBlock(".session-terminal");
    const sessionCard = getLastRuleBlock(".session-card");
    const activeSessionCard = getLastRuleBlock(".session-card.session-card--active");
    const activeSessionHeader = getLastRuleBlock(
      ".session-card.session-card--active > .panel-header"
    );
    const activeSessionTitle = getLastRuleBlock(
      ".session-card.session-card--active > .panel-header .panel-header__title"
    );
    const statusBar = getLastRuleBlock(".workspace-status-bar");
    const agentPanes = getLastRuleBlock(".workspace-main-stage > .agent-panes");
    const bottomPanel = getLastRuleBlock(".workspace-bottom-panel");
    const activityBar = getLastRuleBlock(".workspace-activity-bar");
    const activityBarButton = getLastRuleBlock(".workspace-activity-bar__button");
    const activityBarButtonHover = getLastRuleBlock(".workspace-activity-bar__button:hover");
    const activityBarButtonActive = getLastRuleBlock(".workspace-activity-bar__button--active");
    const sidebarActions = getLastRuleBlock(".workspace-sidebar-panel__actions");
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

    expect(topbar).toContain("var(--surface-overlay-bg)");
    expect(topbar).toContain("var(--app-surface-opacity, 0.96)");
    expect(topbar).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
    expect(topbarTabs).toContain("gap: var(--gap-micro)");
    expect(topbarTab).toContain("gap: var(--gap-tight)");
    expect(topbarTab).toContain(
      "padding: 0 var(--control-height-md) 0 var(--inset-control-inline)"
    );
    expect(topbarTabContent).toContain("gap: var(--gap-tight)");
    expect(topbarTabContent).toContain("background: transparent");
    expect(topbarTabContent).toContain("box-shadow: none");
    expect(activeTab).toContain("var(--bg-active)");
    expect(activeTab).not.toContain("rgba(45, 63, 79, 0.92)");
    expect(topbarTab).toContain("position: relative");
    expect(topbarTab).toContain("overflow: hidden");
    expect(miniMap).toContain("position: relative");
    expect(miniMap).toContain("width: calc(");
    expect(miniMap).toContain("var(--workspace-session-map-columns, 1) *");
    expect(miniMap).toContain("var(--gap-compact)");
    expect(miniMap).toContain("height: var(--sp-3)");
    expect(miniMapViewport).toContain("display: inline-flex");
    expect(miniMapViewport).toContain("gap: var(--gap-compact)");
    expect(miniMapViewport).toContain("height: 100%");
    expect(miniMapColumn).toContain("flex: 0 0 var(--sp-1)");
    expect(miniMapColumn).toContain("height: 100%");
    expect(miniMapColumn).toContain("border-radius: var(--radius-full)");
    expect(miniMapColumn).toContain("background: var(");
    expect(miniMapColumn).toContain("--workspace-session-map-column-fill");
    expect(miniMapColumn).toContain("var(--workspace-session-map-empty) 100%");
    expect(tokensStylesheet).toContain(
      "--workspace-session-map-running: var(--state-success-text)"
    );
    expect(tokensStylesheet).toContain(
      "--workspace-session-map-starting: var(--state-warning-text)"
    );
    expect(tokensStylesheet).toContain("--workspace-session-map-idle: color-mix(");
    expect(tokensStylesheet).toContain("--workspace-session-map-empty: color-mix(");
    expect(workspaceResizer).toContain("z-index: var(--z-inline)");
    expect(emptyCard).toContain("var(--bg-surface)");
    expect(resolvingCard).toContain("var(--bg-surface)");
    expect(workspaceGitEditor).toContain("var(--bg-terminal)");
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
    expect(sessionCard).toContain("var(--surface-overlay-bg)");
    expect(sessionCard).toContain("var(--app-surface-opacity, 0.96)");
    expect(sessionCard).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
    expect(activeSessionCard).toContain("background: var(--bg-active)");
    expect(activeSessionCard).toContain("box-shadow: inset 0 0 0 1px var(--border-focus)");
    expect(activeSessionHeader).toContain(
      "background: color-mix(in srgb, var(--bg-active) 88%, var(--bg-page) 12%)"
    );
    expect(activeSessionTitle).toContain("color: var(--text-primary)");
    expect(resolvingConsoleStatus).toContain("background: var(--state-success-text)");
    expect(resolvingConsoleStatus).toContain("border-radius: var(--radius-chip)");
    expect(resolvingConsoleStatus).toContain("var(--state-success-border)");
    expect(resolvingSkeleton).toContain(
      "background: color-mix(in srgb, var(--bg-hover) 74%, var(--bg-surface) 26%)"
    );
    expect(resolvingStrongLine).toContain("border: 1px solid var(--state-info-border)");
    expect(resolvingStrongLine).toContain("background: var(--state-info-bg)");
    expect(activityBar).toContain("border-right: 1px solid var(--border)");
    expect(activityBar).toContain(
      "background: color-mix(in srgb, var(--bg-panel) 88%, var(--bg-page))"
    );
    expect(activityBarButton).toContain("border-radius: var(--radius-lg)");
    expect(activityBarButton).toContain("background: transparent");
    expect(activityBarButtonHover).toContain("background: var(--bg-hover)");
    expect(activityBarButtonActive).toContain(
      "background: color-mix(in srgb, var(--accent-blue) 14%, transparent)"
    );
    expect(sidebarActions).toContain("gap: var(--gap-control)");
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
    expect(paneDividerBaseRules).toContain("z-index: var(--z-inline-raised)");
    expect(paneDividerLineRules).toContain(
      "background: color-mix(in srgb, var(--border) 62%, transparent)"
    );
    expect(paneDividerLineRules).toContain("border-radius: var(--radius-pill)");
    expect(paneDividerHorizontalRules).toContain("width: 10px");
    expect(paneDividerHorizontalRules).toContain("margin-left: -5px");
    expect(paneDividerHorizontalRules).toContain("margin-right: -5px");
    expect(paneDividerVerticalRules).toContain("height: 10px");
    expect(paneDividerVerticalRules).toContain("margin-top: -5px");
    expect(paneDividerVerticalRules).toContain("margin-bottom: -5px");
    expect(bottomPanel).toContain("padding: 0");
    expect(bottomPanel).not.toContain("padding: 0 0 14px");
    expect(bottomPanel).not.toContain("padding: 0 14px 14px");
    expect(bottomTerminalShellRules).toContain("var(--surface-overlay-bg)");
    expect(bottomTerminalShellRules).toContain("var(--app-surface-opacity, 0.96)");
    expect(bottomTerminalShellRules).toContain(
      "backdrop-filter: var(--app-surface-backdrop-filter, none)"
    );
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
    const commandPalette = getLastRuleBlock(".command-palette");
    const launchModal = getLastRuleBlock(".launch-modal");

    expect(topbar).toContain("min-height: var(--desktop-topbar-height)");
    expect(statusBar).toContain("min-height: var(--desktop-statusbar-height)");
    expect(commandPalette).toContain("max-width: var(--desktop-modal-max-width-md)");
    expect(launchModal).toContain("max-width: min(var(--desktop-modal-max-width-lg), 90vw)");
  });

  it("keeps auth and welcome shells on flat page surfaces", () => {
    const authScreen = getLastRuleBlock(".auth-screen");
    const authCard = getLastRuleBlock(".auth-card-shell");
    const welcomeCard = getLastRuleBlock(".welcome-card");
    const welcomeFeature = getLastRuleBlock(".welcome-feature");

    expect(authScreen).toContain("var(--bg-page)");
    expect(authScreen).not.toContain("radial-gradient(");
    expect(authScreen).not.toContain("rgba(17, 24, 31, 0.96)");
    expect(authCard).toContain("background: var(--bg-surface)");
    expect(authCard).toContain("box-shadow: var(--shadow-sm)");
    expect(authCard).not.toContain("linear-gradient(");
    expect(welcomeCard).toContain("background: var(--bg-surface)");
    expect(welcomeCard).toContain("align-items: stretch");
    expect(welcomeCard).not.toContain("box-shadow: var(--shadow-xl)");
    expect(welcomeFeature).toContain("background: transparent");
    expect(welcomeFeature).not.toContain("min-height: 148px");
    expect(authCard).not.toContain("rgba(13, 20, 26, 0.94)");
  });

  it("keeps quick actions sized to its label instead of icon-button width", () => {
    const quickActions = getLastRuleBlock(".topbar-quick-actions");

    expect(quickActions).toContain("width: auto");
    expect(quickActions).toContain("min-width: max-content");
    expect(quickActions).toContain("flex-shrink: 0");
    expect(quickActions).toContain("padding: 0 var(--inset-control-block)");
    expect(quickActions).toContain("gap: var(--gap-tight)");
  });

  it("keeps app topbar and left panel compatibility overrides on shared foundation tokens", () => {
    const appTopbarBlocks = getRuleBlocksFrom(stylesheet, ".app-topbar");
    const leftPanelBlocks = getRuleBlocksFrom(stylesheet, ".left-panel");

    expect(appTopbarBlocks.some((block) => block.includes("padding: 0 var(--sp-2)"))).toBe(true);
    expect(appTopbarBlocks.some((block) => block.includes("gap: var(--gap-compact)"))).toBe(true);
    expect(leftPanelBlocks.some((block) => block.includes("background: var(--bg-sidebar)"))).toBe(
      true
    );
    expect(leftPanelBlocks.some((block) => block.includes("box-shadow: none"))).toBe(true);
  });

  it("keeps file context menu action stacks on compact cluster gaps", () => {
    const sectionItems = getLastRuleBlock(".file-context-menu__section-items");
    const sheetActions = getLastRuleBlock(".file-context-menu__sheet-actions");

    expect(sectionItems).toContain("gap: var(--gap-compact)");
    expect(sheetActions).toContain("gap: var(--gap-compact)");
  });

  it("keeps mobile sheet and drawer backdrops on the shared overlay backdrop token", () => {
    const mobileSheetBackdrop = getLastRuleBlock(".mobile-sheet-layer__backdrop");
    const mobileDrawerBackdrop = getLastRuleBlock(".mobile-drawer-layer__backdrop");

    expect(mobileSheetBackdrop).toContain("background: var(--overlay-backdrop)");
    expect(mobileDrawerBackdrop).toContain("background: var(--overlay-backdrop)");
  });

  it("keeps mobile sheets below shared modal dialogs so confirmation overlays remain visible", () => {
    const mobileSheetLayer = getLastRuleBlock(".mobile-sheet-layer");
    const mobileDrawerLayer = getLastRuleBlock(".mobile-drawer-layer");
    const modalOverlay = getLastRuleBlockFrom(modalStylesheet, ":global(.modal-overlay)");

    expect(mobileSheetLayer).toContain("z-index: var(--z-sheet)");
    expect(mobileDrawerLayer).toContain("z-index: var(--z-sheet)");
    expect(modalOverlay).toContain("z-index: var(--z-modal-backdrop)");
  });

  it("keeps worktree state chips and mobile tabs on shared state and layer tokens", () => {
    const cleanChip = getLastRuleBlock(".worktree-chip-status.worktree-clean");
    const dirtyChip = getLastRuleBlock(".worktree-chip-status.worktree-dirty");
    const mobileTabs = getLastRuleBlock(".mobile-worktree-sheet__tabs");

    expect(cleanChip).toContain("color: var(--state-success-text)");
    expect(cleanChip).toContain("background: var(--state-success-bg)");
    expect(dirtyChip).toContain("color: var(--state-warning-text)");
    expect(dirtyChip).toContain("background: var(--state-warning-bg)");
    expect(mobileTabs).toContain("z-index: var(--z-inline)");
  });

  it("routes settings and workspace shared surfaces through appearance-aware background tokens", () => {
    const settingsContent = getLastRuleBlock(".settings-content");
    const settingsSurface = getRuleBlocksFrom(stylesheet, ".settings-content-surface").find(
      (block) => block.includes("var(--surface-overlay-bg)")
    );
    const appTopbar = getLastRuleBlock(".app-topbar");
    const workspacePage = getLastRuleBlock(".workspace-page");
    const sessionCard = getLastRuleBlock(".session-card");
    const bottomTerminal = getLastRuleBlock(".workspace-bottom-panel > .bottom-terminal");
    const mobileShell = getLastGroupedRuleBlock(/\.mobile-shell\s*\{([^}]*)\}/g);
    const mobileTopbar = getLastRuleBlock(".mobile-topbar");
    const mobileBottomStack = getLastRuleBlock(".mobile-shell__bottom-stack");

    expect(settingsContent).toContain("var(--app-surface-opacity, 0.96)");
    expect(settingsContent).toContain("var(--surface-page-bg)");
    expect(settingsSurface).toBeTruthy();
    expect(settingsSurface).toContain("var(--surface-overlay-bg)");
    expect(settingsSurface).toContain("var(--app-surface-opacity, 0.96)");
    expect(settingsSurface).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
    expect(appTopbar).toContain("var(--surface-overlay-bg)");
    expect(appTopbar).toContain("var(--app-surface-opacity, 0.96)");
    expect(appTopbar).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
    expect(workspacePage).toContain("var(--surface-page-bg)");
    expect(workspacePage).toContain("var(--app-surface-opacity, 0.96)");
    expect(sessionCard).toContain("var(--surface-overlay-bg)");
    expect(sessionCard).toContain("var(--app-surface-opacity, 0.96)");
    expect(sessionCard).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
    expect(bottomTerminal).toContain("var(--surface-overlay-bg)");
    expect(bottomTerminal).toContain("var(--app-surface-opacity, 0.96)");
    expect(bottomTerminal).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
    expect(mobileShell).toContain("var(--surface-page-bg)");
    expect(mobileShell).toContain("var(--app-surface-opacity, 0.96)");
    expect(mobileTopbar).toContain("var(--surface-overlay-bg)");
    expect(mobileTopbar).toContain("var(--app-surface-opacity, 0.96)");
    expect(mobileTopbar).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
    expect(mobileBottomStack).toContain("var(--surface-overlay-bg)");
    expect(mobileBottomStack).toContain("var(--app-surface-opacity, 0.96)");
    expect(mobileBottomStack).toContain(
      "backdrop-filter: var(--app-surface-backdrop-filter, none)"
    );
  });

  it("keeps workbench backdrops and overlay cards on fallback-safe backdrop filters", () => {
    const workbenchStyles = readFileSync(
      `${process.cwd()}/src/components/ui/workbench-layer/index.module.css`,
      "utf8"
    );
    const backdrop = getLastRuleBlockFrom(workbenchStyles, ":global(.workbench-layer-backdrop)");
    const surface = getLastRuleBlockFrom(workbenchStyles, ":global(.workbench-layer)");

    expect(backdrop).toContain("background: var(--overlay-backdrop)");
    expect(backdrop).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
    expect(surface).not.toContain("backdrop-filter:");
    expect(workbenchStyles).not.toContain("backdrop-filter: blur(8px)");
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
    const editorError = getLastRuleBlock(".code-editor-error");
    const codeLines = getLastRuleBlock(".code-lines");
    const codeModeToggleRules = getRuleBlocksFrom(stylesheet, ".code-mode-toggle").join("\n");
    const activeCodeMode = getLastRuleBlock(".code-mode-btn.active");
    const imageCanvasRules = getRuleBlocksFrom(stylesheet, ".image-preview-canvas").join("\n");
    const imagePreview = getLastRuleBlock(".image-preview-img");
    const imageMeta = getLastRuleBlock(".image-preview-meta");
    const addedLine = getLastRuleBlock(".git-diff-line-added");
    const removedLine = getLastRuleBlock(".git-diff-line-removed");

    expect(editorShell).toContain("var(--bg-surface)");
    expect(editorShell).not.toContain("rgba(11, 18, 24, 0.92)");
    expect(editorHeader).toContain("var(--bg-surface)");
    expect(editorHeader).not.toContain("rgba(18, 26, 34, 0.96)");
    expect(editorError).toContain("gap: var(--gap-tight)");
    expect(editorError).toContain("padding: var(--gap-tight) var(--inset-control-inline)");
    expect(editorError).toContain("background: var(--editor-diagnostic-error-bg)");
    expect(editorError).toContain("color: var(--state-error-text)");
    expect(codeLines).toContain("padding: var(--editor-pane-inset) 0");
    expect(codeModeToggleRules).toContain("padding: var(--gap-compact)");
    expect(codeModeToggleRules).toContain("gap: var(--gap-compact)");
    expect(codeModeToggleRules).toContain("border-radius: var(--radius-lg)");
    expect(codeModeToggleRules).toContain(
      "background: color-mix(in srgb, var(--bg-hover) 72%, var(--bg-surface) 28%)"
    );
    expect(activeCodeMode).toContain("box-shadow: inset 0 0 0 1px var(--border-focus)");
    expect(imageCanvasRules).toContain("padding: var(--sp-6)");
    expect(imageCanvasRules).toContain(
      "background-color: color-mix(in srgb, var(--bg-terminal) 90%, var(--bg-page) 10%)"
    );
    expect(imagePreview).toContain("box-shadow: var(--shadow-md)");
    expect(imageMeta).toContain("var(--bg-surface)");
    expect(imageMeta).not.toContain("rgba(17, 24, 31, 0.92)");
    expect(addedLine).toContain("var(--color-success)");
    expect(addedLine).not.toContain("#9ce7c8");
    expect(removedLine).toContain("var(--color-error)");
    expect(removedLine).not.toContain("#ffb7c4");
  });

  it("routes terminal, session, editor, and diff chrome through domain sub-spec tokens", () => {
    const xtermShell = getLastRuleBlock(".xterm-host-shell");
    const xtermHost = getLastRuleBlock(".xterm-host");
    const xtermReplayCard = getLastRuleBlock(".xterm-replay-overlay__card");
    const sessionProgress = getLastRuleBlock(".session-progress");
    const sessionHeader = getLastRuleBlock(".session-header");
    const sessionHeaderLeft = getLastRuleBlock(".session-header-left");
    const sessionHeaderCopyBlocks = getRuleBlocksFrom(stylesheet, ".session-header-copy");
    const sessionTitleRow = getLastRuleBlock(".session-title-row");
    const sessionHeaderActions = getRuleBlocksFrom(stylesheet, ".session-header-actions");
    const sessionBadges = getLastGroupedRuleBlock(
      /\.session-provider-badge,\s*\.session-state-badge\s*\{([^}]*)\}/g
    );
    const sessionMetaSeparator = getLastRuleBlock(".session-meta span + span::before");
    const sessionDotBlocks = getRuleBlocksFrom(stylesheet, ".session-dot");
    const runningHeader = getLastRuleBlock(".session-card > .panel-header.session-header--running");
    const runningDot = getLastRuleBlock(".session-dot-running");
    const focusPulse = getLastRuleBlock(".session-card--focus-pulse");
    const gitView = getLastRuleBlock(".workspace-git-view");
    const editorHeader = getLastRuleBlock(".code-editor-header");
    const editorBody = getLastRuleBlock(".code-editor-body");
    const addedLine = getLastRuleBlock(".git-diff-line-added");
    const removedLine = getLastRuleBlock(".git-diff-line-removed");
    const diffEmpty = getLastRuleBlock(".git-diff-empty");

    expect(xtermShell).toContain("padding: var(--terminal-panel-inset)");
    expect(xtermHost).toContain("border-radius: var(--terminal-local-overlay-radius)");
    expect(xtermReplayCard).toContain("border-radius: var(--terminal-local-overlay-radius)");
    expect(sessionProgress).toContain("background: var(--state-info-bg)");
    expect(sessionHeader).toContain("padding: var(--gap-tight) var(--inset-control-inline)");
    expect(sessionHeaderLeft).toContain("gap: var(--gap-default)");
    expect(sessionHeaderCopyBlocks.some((block) => block.includes("gap: var(--gap-compact)"))).toBe(
      true
    );
    expect(sessionTitleRow).toContain("gap: var(--session-row-gap)");
    expect(sessionHeaderActions.some((block) => block.includes("gap: var(--gap-control)"))).toBe(
      true
    );
    expect(sessionBadges).toContain("border-radius: var(--session-state-radius)");
    expect(sessionMetaSeparator).toContain("border-radius: var(--radius-chip)");
    expect(
      sessionDotBlocks.some(
        (block) =>
          block.includes("box-shadow: 0 0 0 4px") &&
          block.includes("var(--status-dot-current-color, var(--text-tertiary))")
      )
    ).toBe(true);
    expect(runningHeader).toContain("background: var(--terminal-state-running-bg)");
    expect(runningHeader).toContain("border-bottom-color: var(--terminal-state-running-border)");
    expect(runningDot).toContain("background: var(--terminal-state-running-text)");
    expect(runningDot).toContain("var(--terminal-state-running-border)");
    expect(focusPulse).toContain("z-index: var(--z-inline-raised)");
    expect(gitView).toContain("padding: var(--editor-pane-inset)");
    expect(editorHeader).toContain("padding: var(--gap-default) var(--editor-toolbar-inset)");
    expect(editorBody).toContain("background: var(--surface-panel-bg)");
    expect(addedLine).toContain("background: var(--diff-add-bg)");
    expect(removedLine).toContain("background: var(--diff-delete-bg)");
    expect(diffEmpty).toContain("gap: var(--diff-section-gap)");
    expect(diffEmpty).toContain("padding: var(--diff-thread-inset)");
    expect(diffEmpty).toContain("border-radius: var(--diff-thread-radius)");
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

  it("keeps the unified editor toolbar docked to the right without an outline", () => {
    const toolbar = getLastRuleBlock(".editor-surface__toolbar");
    const toolbarButtons = getLastRuleBlock(".editor-surface__toolbar .code-mode-btn");
    const activeToolbarButtons = getLastRuleBlock(".editor-surface__toolbar .code-mode-btn.active");

    expect(toolbar).toContain("display: inline-flex");
    expect(toolbar).toContain("justify-content: flex-end");
    expect(toolbar).toContain("margin-left: auto");
    expect(toolbar).not.toContain("border: 1px");
    expect(toolbarButtons).toContain("border: none");
    expect(toolbarButtons).toContain("box-shadow: none");
    expect(activeToolbarButtons).toContain("box-shadow: none");
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
    const claudeCard = getLastRuleBlock(".agent-provider-card-claude");
    const codexCard = getLastRuleBlock(".agent-provider-card-codex");
    const providerIcon = getLastRuleBlock(".agent-provider-card-icon");

    expect(launcher).toContain("container-type: inline-size");
    expect(content).toContain("max-width: 100%");
    expect(providerCard).toContain("min-width: 0");
    expect(providerBody).toContain("width: 100%");
    expect(providerBody).toContain("gap: var(--gap-tight)");
    expect(providerArrow).toContain("flex-shrink: 0");
    expect(claudeCard).toContain("background: var(--state-warning-bg)");
    expect(claudeCard).toContain("border-color: var(--state-warning-border)");
    expect(codexCard).toContain("background: var(--state-info-bg)");
    expect(codexCard).toContain("border-color: var(--state-info-border)");
    expect(providerIcon).toContain("background: var(--icon-surface-subtle)");
    expect(stylesheet).toMatch(
      /@container\s*\(max-width:\s*36rem\)\s*\{[\s\S]*?\.agent-draft-providers\s*\{[\s\S]*?grid-template-columns:\s*1fr;[\s\S]*?\}/
    );
  });

  it("keeps legacy agent pane chrome aligned to shared density and state tokens", () => {
    const progress = getLastRuleBlock(".agent-progress");
    const header = getLastRuleBlock(".agent-header");
    const badge = getLastRuleBlock(".agent-badge");
    const runningStatus = getLastRuleBlock(".agent-status.running");
    const idleStatus = getLastRuleBlock(".agent-status.idle");
    const headerLeft = getLastRuleBlock(".agent-header-left");
    const actions = getLastRuleBlock(".agent-actions");

    expect(progress).toContain("background: var(--state-info-bg)");
    expect(header).toContain("gap: var(--gap-default)");
    expect(header).toContain("padding: var(--gap-tight) var(--inset-control-inline)");
    expect(badge).toContain("padding: var(--inset-chip-block) var(--inset-chip-inline)");
    expect(badge).toContain("border-radius: var(--radius-control-sm)");
    expect(runningStatus).toContain("background: var(--state-success-bg)");
    expect(runningStatus).toContain("color: var(--state-success-text)");
    expect(idleStatus).toContain("background: var(--state-disabled-bg)");
    expect(idleStatus).toContain("color: var(--state-disabled-text)");
    expect(headerLeft).toContain("gap: var(--gap-default)");
    expect(actions).toContain("gap: var(--gap-control)");
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
    const mobilePageHeaderTitle = getLastRuleBlock(".mobile-page-header .page-header__title");
    const mobilePageHeaderBack = getLastRuleBlock(".mobile-page-header .page-header__back");
    const headerLeading = getLastRuleBlock(".page-header__leading");
    const backButton = getLastRuleBlock(".mobile-sheet--fullscreen .page-header__back");
    const headerActions = getLastRuleBlock(".page-header__actions");

    expect(fullscreenHeader).toContain("padding: 0 var(--sp-3)");
    expect(pageHeader).toContain("width: 100%");
    expect(mobilePageHeader).toContain("min-height: 44px");
    expect(mobilePageHeaderLeading).toContain("gap: 8px");
    expect(mobilePageHeaderTitle).toContain("font-size: var(--type-heading-5-size)");
    expect(mobilePageHeaderTitle).toContain("line-height: var(--type-heading-5-line-height)");
    expect(mobilePageHeaderTitle).toContain("font-weight: var(--type-heading-5-weight)");
    expect(mobilePageHeaderBack).toContain("min-height: var(--control-height-sm)");
    expect(mobilePageHeaderBack).toContain("gap: var(--gap-tight)");
    expect(mobilePageHeaderBack).toContain("font-family: var(--font-mono)");
    expect(headerLeading).toContain("flex: 1");
    expect(backButton).toContain("background: transparent");
    expect(backButton).not.toContain("border-radius: 999px");
    expect(hasRuleBlock(".mobile-sheet--fullscreen .page-header__title")).toBe(false);
    expect(headerActions).toContain("margin-left: auto");
  });

  it("keeps page header levels on the approved desktop sizing contract", () => {
    const baseTitle = getLastRuleBlock(".page-header__title");
    const copy = getLastRuleBlock(".page-header__copy");
    const primaryHeader = getLastRuleBlock(".page-header--primary");
    const secondaryHeader = getLastRuleBlock(".page-header--secondary");
    const primaryTitle = getLastRuleBlock(".page-header--primary .page-header__title");
    const secondaryTitle = getLastRuleBlock(".page-header--secondary .page-header__title");

    expect(baseTitle).toContain("font-weight: var(--type-heading-5-weight)");
    expect(copy).toContain("gap: var(--gap-compact)");
    expect(primaryHeader).toContain("min-height: 56px");
    expect(secondaryHeader).toContain("min-height: 48px");
    expect(primaryTitle).toContain("font-size: var(--type-heading-4-size)");
    expect(primaryTitle).toContain("line-height: var(--type-heading-4-line-height)");
    expect(primaryTitle).toContain("font-weight: var(--type-heading-4-weight)");
    expect(secondaryTitle).toContain("font-size: var(--type-heading-5-size)");
    expect(secondaryTitle).toContain("line-height: var(--type-heading-5-line-height)");
    expect(secondaryTitle).toContain("font-weight: var(--type-heading-5-weight)");
  });

  it("keeps diagnostics mobile summary titles on the typography token contract", () => {
    const diagnosticsTitle = getLastRuleBlock(".diagnostics-summary__title");
    const diagnosticsMobileTitle = getLastRuleBlock(
      ".diagnostics-summary--mobile .diagnostics-summary__title"
    );

    expect(diagnosticsTitle).toContain("font-size: var(--type-heading-4-size)");
    expect(diagnosticsTitle).toContain("line-height: var(--type-heading-4-line-height)");
    expect(diagnosticsTitle).toContain("font-weight: var(--type-heading-4-weight)");
    expect(diagnosticsMobileTitle).toContain("font-size: var(--type-heading-3-size)");
    expect(diagnosticsMobileTitle).toContain("line-height: var(--type-heading-3-line-height)");
    expect(diagnosticsMobileTitle).toContain("font-weight: var(--type-heading-3-weight)");
  });

  it("keeps panel headers on the approved dense container chrome contract", () => {
    const panelHeader =
      [...getRuleBlocksFrom(stylesheet, ".panel-header")]
        .reverse()
        .find((block) => block.includes("border-bottom: 1px solid var(--border)")) ?? "";
    const leading = getLastRuleBlock(".panel-header__leading");
    const copy = getLastRuleBlock(".panel-header__copy");
    const title = getLastRuleBlock(".panel-header__title");
    const meta = getLastRuleBlock(".panel-header__meta");
    const actions = getLastRuleBlock(".panel-header__actions");
    const branch = getLastRuleBlock(".panel-branch");
    const branchButton = getLastRuleBlock(".panel-branch-button");
    const tabs = getLastRuleBlock(".panel-tabs");
    const tab = getLastRuleBlock(".panel-tab");
    const toolbar = getLastRuleBlock(".panel-toolbar");
    const tabsRow = getLastRuleBlock(".panel-tabs-row");
    const mobilePanelHeader = getLastGroupedRuleBlockFrom(
      stylesheet,
      /@media \(max-width: 640px\)\s*\{[\s\S]*?\n\s*\.panel-header\s*\{([^}]*)\}/g
    );

    expect(panelHeader).toContain("min-height: var(--panel-header-height)");
    expect(panelHeader).toContain("gap: var(--sp-3)");
    expect(panelHeader).toContain("padding: var(--gap-tight) var(--inset-control-inline)");
    expect(panelHeader).toContain("border-bottom: 1px solid var(--border)");
    expect(leading).toContain("flex: 1");
    expect(copy).toContain("min-width: 0");
    expect(copy).toContain("gap: var(--gap-compact)");
    expect(title).toContain("font-size: var(--type-heading-5-size)");
    expect(title).toContain("line-height: var(--type-heading-5-line-height)");
    expect(title).toContain("font-weight: var(--type-heading-5-weight)");
    expect(meta).toContain("display: flex");
    expect(actions).toContain("margin-left: auto");
    expect(actions).toContain("flex-shrink: 0");
    expect(branch).toContain("margin-bottom: var(--space-default)");
    expect(branch).toContain("padding: var(--gap-compact) var(--sp-2)");
    expect(branch).toContain("border-radius: var(--radius-control-sm)");
    expect(branch).toContain("background: var(--state-hover-bg-subtle)");
    expect(branchButton).toContain("gap: var(--gap-control)");
    expect(tabs).toContain("gap: var(--gap-control)");
    expect(tab).toContain("padding: var(--gap-compact) var(--sp-2)");
    expect(tab).toContain("border-radius: var(--radius-control-sm)");
    expect(toolbar).toContain("min-height: calc(var(--control-height-sm) + var(--gap-tight))");
    expect(toolbar).toContain("padding: var(--gap-tight) var(--inset-control-inline)");
    expect(tabsRow).toContain("gap: var(--gap-default)");
    expect(mobilePanelHeader).toContain("min-height: 44px");
    expect(hasRuleBlock(".session-header .panel-header__title")).toBe(false);
    expect(hasRuleBlock(".mobile-shell__agent-stage .session-header .panel-header__actions")).toBe(
      false
    );
    expect(hasRuleBlock(".code-editor-header .panel-header__title")).toBe(false);
    expect(hasRuleBlock(".workspace-sidebar-panel__header .panel-header__title-row")).toBe(false);
  });

  it("keeps dialog headers on the approved modal header contract", () => {
    const modalTitle = getLastRuleBlockFrom(modalStylesheet, ".title");
    const dialogHeader =
      getRuleBlocksFrom(modalStylesheet, ".dialogHeader").find((block) =>
        block.includes("align-items: flex-start")
      ) ?? "";
    const dialogDescription = getLastRuleBlockFrom(
      modalStylesheet,
      ":global(.dialog-header__description)"
    );
    const dialogIcon = getLastRuleBlock(".supervisor-dialog-header-icon");
    const editTone = getLastRuleBlock(".supervisor-dialog--edit .supervisor-dialog-header-icon");

    expect(modalTitle).toContain("font-size: var(--type-heading-4-size)");
    expect(modalTitle).toContain("line-height: var(--type-heading-4-line-height)");
    expect(modalTitle).toContain("font-weight: var(--type-heading-4-weight)");
    expect(dialogDescription).toContain("font-size: var(--type-body-5-size)");
    expect(dialogDescription).toContain("line-height: var(--type-body-5-line-height)");
    expect(dialogDescription).toContain("font-weight: var(--type-body-5-weight)");
    expect(dialogHeader).toContain("align-items: flex-start");
    expect(dialogIcon).toContain("width: 28px");
    expect(dialogIcon).toContain("height: 28px");
    expect(editTone).toContain("var(--icon-surface-info)");
    expect(editTone).toContain("var(--icon-info)");
    expect(hasRuleBlock(".supervisor-dialog-header")).toBe(false);
    expect(hasRuleBlock(".supervisor-dialog-subtitle")).toBe(false);
    expect(hasRuleBlock(".supervisor-dialog .modal-header h3")).toBe(false);
  });

  it("keeps supervisor dialog body styling flat and dense", () => {
    const modalBody = getLastRuleBlock(".supervisor-dialog .modal-body");
    const formGroup = getLastRuleBlock(".supervisor-dialog .form-group");
    const intro = getLastRuleBlock(".supervisor-dialog-intro");
    const introEditTone = getLastRuleBlock(
      ".supervisor-dialog--edit .supervisor-dialog-intro__icon"
    );
    const introTitle = getLastRuleBlock(".supervisor-dialog-intro__title");
    const introDescription = getLastRuleBlock(".supervisor-dialog-intro__description");
    const objectiveLabelRow = getLastRuleBlock(".supervisor-objective-label-row");
    const compactInputGroup = getLastGroupedRuleBlock(
      /\.supervisor-dialog \.input,\s*\n\.supervisor-dialog \.mobile-select-trigger\s*\{([^}]*)\}/g
    );
    const textarea = getLastRuleBlock(".supervisor-dialog .textarea");

    expect(modalBody).toContain("gap: var(--sp-3)");
    expect(formGroup).toContain("gap: var(--gap-tight)");
    expect(intro).toContain("display: flex");
    expect(intro).toContain("padding: var(--sp-3)");
    expect(intro).toContain("border: 1px solid color-mix(in srgb, var(--border) 90%, transparent)");
    expect(intro).toContain(
      "background: color-mix(in srgb, var(--bg-surface) 88%, var(--bg-hover))"
    );
    expect(introEditTone).toContain("var(--icon-surface-info)");
    expect(introEditTone).toContain("var(--icon-info)");
    expect(introTitle).toContain("font-size: var(--type-body-3-size)");
    expect(introTitle).toContain("line-height: var(--type-body-3-line-height)");
    expect(introDescription).toContain("font-size: var(--type-body-5-size)");
    expect(introDescription).toContain("line-height: var(--type-body-5-line-height)");
    expect(objectiveLabelRow).toContain("display: flex");
    expect(objectiveLabelRow).toContain("align-items: center");
    expect(objectiveLabelRow).toContain("justify-content: space-between");
    expect(objectiveLabelRow).toContain("gap: var(--sp-2)");
    expect(compactInputGroup).toContain("font-size: var(--type-body-6-size)");
    expect(compactInputGroup).toContain("line-height: var(--type-body-6-line-height)");
    expect(textarea).toContain("font-size: var(--type-body-5-size)");
    expect(textarea).toContain("min-height: 104px");
    expect(textarea).toContain("color: var(--text-secondary)");
  });

  it("keeps supervisor strip, history badges, and restore cards on shared state tokens", () => {
    const enableHover = getLastRuleBlock(".supervisor-enable-btn:hover");
    const pulse = getLastRuleBlock(".supervisor-pulse");
    const evaluatingPulse = getLastRuleBlock(".supervisor-pulse.supervisor-state-evaluating");
    const injectingPulse = getLastRuleBlock(".supervisor-pulse.supervisor-state-injecting");
    const errorPulse = getLastRuleBlock(".supervisor-pulse.supervisor-state-error");
    const stateTag = getLastRuleBlock(".supervisor-state-tag");
    const idleTag = getLastRuleBlock(".supervisor-state-tag.supervisor-state-idle");
    const evaluatingTag = getLastRuleBlock(".supervisor-state-tag.supervisor-state-evaluating");
    const injectingTag = getLastRuleBlock(".supervisor-state-tag.supervisor-state-injecting");
    const pausedTag = getLastRuleBlock(".supervisor-state-tag.supervisor-state-paused");
    const errorTag = getLastRuleBlock(".supervisor-state-tag.supervisor-state-error");
    const stoppedTag = getLastRuleBlock(".supervisor-state-tag.supervisor-state-stopped");
    const cycleCount = getLastRuleBlock(".supervisor-cycle-count");
    const actions = getLastRuleBlock(".supervisor-actions");
    const dangerHover = getLastRuleBlock(".supervisor-icon-btn-danger:hover:not(:disabled)");
    const providerPill = getLastRuleBlock(".supervisor-provider-pill");
    const progressMarker = getLastRuleBlock(".supervisor-progress-item__marker");
    const manualTrigger = getLastRuleBlock(
      '.supervisor-history-item[data-trigger="manual"] .supervisor-history-trigger'
    );
    const scheduledTrigger = getLastRuleBlock(
      '.supervisor-history-item[data-trigger="scheduled"] .supervisor-history-trigger'
    );
    const continueTrigger = getLastRuleBlock(
      '.supervisor-history-item[data-trigger="continue"] .supervisor-history-trigger'
    );
    const stopTrigger = getLastRuleBlock(
      '.supervisor-history-item[data-trigger="stop"] .supervisor-history-trigger'
    );
    const errorTrigger = getLastRuleBlock(
      '.supervisor-history-item[data-trigger="error"] .supervisor-history-trigger'
    );
    const inProgressTrigger = getLastRuleBlock(
      '.supervisor-history-item[data-trigger="in_progress"] .supervisor-history-trigger'
    );
    const restoreEntry = getLastRuleBlock(".supervisor-restore-entry");
    const restoreCard = getLastRuleBlock(".supervisor-restore-card");

    expect(enableHover).toContain("background: var(--state-success-bg)");
    expect(enableHover).toContain("border-color: var(--state-success-border)");
    expect(enableHover).toContain("color: var(--state-success-text)");
    expect(pulse).toContain("background: var(--state-success-text)");
    expect(pulse).toContain("var(--state-success-border)");
    expect(evaluatingPulse).toContain("background: var(--state-info-text)");
    expect(evaluatingPulse).toContain("var(--state-info-border)");
    expect(injectingPulse).toContain("background: var(--state-warning-text)");
    expect(injectingPulse).toContain("var(--state-warning-border)");
    expect(errorPulse).toContain("background: var(--state-error-text)");
    expect(errorPulse).toContain("var(--state-error-border)");
    expect(stateTag).toContain("padding: var(--inset-chip-block) var(--inset-chip-inline)");
    expect(stateTag).toContain("border-radius: var(--radius-control-sm)");
    expect(idleTag).toContain("background: var(--state-success-bg)");
    expect(idleTag).toContain("color: var(--state-success-text)");
    expect(evaluatingTag).toContain("background: var(--state-info-bg)");
    expect(evaluatingTag).toContain("color: var(--state-info-text)");
    expect(injectingTag).toContain("background: var(--state-warning-bg)");
    expect(injectingTag).toContain("color: var(--state-warning-text)");
    expect(pausedTag).toContain("background: var(--state-disabled-bg)");
    expect(pausedTag).toContain("color: var(--state-disabled-text)");
    expect(errorTag).toContain("background: var(--state-error-bg)");
    expect(errorTag).toContain("color: var(--state-error-text)");
    expect(stoppedTag).toContain("background: var(--state-disabled-bg)");
    expect(stoppedTag).toContain("color: var(--state-disabled-text)");
    expect(cycleCount).toContain("padding: var(--inset-chip-block) var(--inset-chip-inline)");
    expect(cycleCount).toContain("background: var(--state-disabled-bg)");
    expect(actions).toContain("gap: var(--gap-compact)");
    expect(dangerHover).toContain("background: var(--state-error-bg)");
    expect(dangerHover).toContain("color: var(--state-error-text)");
    expect(providerPill).toContain("padding: var(--inset-chip-block) var(--inset-chip-inline)");
    expect(providerPill).toContain("background: var(--state-info-bg)");
    expect(providerPill).toContain("color: var(--state-info-text)");
    expect(progressMarker).toContain("border-radius: var(--radius-pill)");
    expect(manualTrigger).toContain("color: var(--accent-purple)");
    expect(manualTrigger).toContain("background: color-mix(in srgb, var(--accent-purple)");
    expect(scheduledTrigger).toContain("background: var(--state-info-bg)");
    expect(scheduledTrigger).toContain("color: var(--state-info-text)");
    expect(continueTrigger).toContain("background: var(--state-success-bg)");
    expect(continueTrigger).toContain("color: var(--state-success-text)");
    expect(stopTrigger).toContain("background: var(--state-disabled-bg)");
    expect(stopTrigger).toContain("color: var(--state-disabled-text)");
    expect(errorTrigger).toContain("background: var(--state-error-bg)");
    expect(errorTrigger).toContain("color: var(--state-error-text)");
    expect(inProgressTrigger).toContain("background: var(--state-warning-bg)");
    expect(inProgressTrigger).toContain("color: var(--state-warning-text)");
    expect(restoreEntry).toContain("gap: var(--gap-control)");
    expect(restoreCard).toContain("gap: var(--gap-tight)");
  });

  it("does not allow page or modal wrappers to override approved header typography tokens", () => {
    const settingsBack = getLastRuleBlock(
      ".settings-header .mobile-page-header .page-header__back"
    );
    const mobileSettingsBack = getLastRuleBlock(
      ".settings-page--mobile > .settings-header .mobile-page-header .page-header__back"
    );

    expect(hasRuleBlock(".mobile-sheet--fullscreen .page-header__title")).toBe(false);
    expect(hasRuleBlock(".settings-header .mobile-page-header .page-header__title")).toBe(false);
    expect(
      hasRuleBlock(
        ".settings-page--mobile > .settings-header .mobile-page-header .page-header__title"
      )
    ).toBe(false);
    expect(settingsBack).not.toContain("font-size:");
    expect(settingsBack).not.toContain("line-height:");
    expect(settingsBack).not.toContain("font-weight:");
    expect(mobileSettingsBack).not.toContain("font-size:");
    expect(mobileSettingsBack).not.toContain("line-height:");
    expect(mobileSettingsBack).not.toContain("font-weight:");
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
    const desktopSettingsHeader = getLastRuleBlock(".page-header--secondary");
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
    const mobileItemCopy = getLastRuleBlock(".settings-mobile-item__copy");
    const mobileItemArrow = getLastRuleBlock(".settings-mobile-item__arrow");

    expect(settingsPage).toContain("display: flex");
    expect(settingsPage).toContain("min-height: 100vh");
    expect(settingsPage).toContain("background: var(--bg-page)");
    expect(baseSettingsHeader).toContain("background: var(--bg-surface)");
    expect(baseSettingsHeader).toContain("border-bottom: 1px solid var(--border)");
    expect(baseSettingsHeader).toContain("padding: var(--sp-1) var(--sp-4)");
    expect(desktopSettingsHeader).toContain("min-height: 48px");
    expect(settingsBody).toContain("align-items: stretch");
    expect(settingsBody).toContain("background: var(--bg-page)");
    expect(settingsSidebar).toContain("background: var(--bg-panel)");
    expect(settingsSidebar).toContain("padding: var(--sp-4)");
    expect(settingsSidebar).toContain("width: 240px");
    expect(settingsContent).toContain("display: flex");
    expect(settingsContent).toContain("align-items: flex-start");
    expect(settingsContent).toContain("justify-content: center");
    expect(settingsContent).toContain("padding: var(--sp-6)");
    expect(settingsContent).toContain("var(--surface-page-bg)");
    expect(settingsContent).toContain("var(--app-surface-opacity, 0.96)");
    expect(settingsContentFillHeight).toContain("justify-content: flex-start");
    expect(settingsContentFillHeightSurface).toContain("display: flex");
    expect(settingsContentFillHeightSurface).toContain("flex-direction: column");
    expect(settingsContentFillHeightSurface).toContain("flex: 1");
    expect(settingsContentFillHeightSurface).toContain("min-height: 0");
    expect(settingsNavItem).toContain("min-height: 40px");
    expect(settingsNavItem).toContain("border: 1px solid transparent");
    expect(settingsNavItem).toContain("border-radius: var(--radius-md)");
    expect(settingsNavItem).toContain("align-items: center");
    expect(settingsNavItem).toContain("gap: var(--sp-3)");
    expect(settingsNavItem).toContain("display: flex");
    expect(settingsNavItemHover).toContain("background: var(--bg-hover)");
    expect(settingsNavItemActive).toContain("background: var(--bg-active)");
    expect(settingsNavItemActive).toContain("border-color: color-mix");
    expect(settingsNavItemActive).toContain("var(--accent-blue)");
    expect(getLastRuleBlock(".settings-nav-icon")).toContain("display: inline-flex");
    expect(getLastRuleBlock(".settings-nav-icon")).toContain("line-height: 0");
    expect(getLastRuleBlock(".settings-nav-label")).toContain("display: block");
    expect(getLastRuleBlock(".settings-nav-label")).toContain("min-width: 0");
    expect(getLastRuleBlock(".settings-nav-arrow")).toContain("display: block");
    expect(getLastRuleBlock(".settings-nav-arrow")).toContain("line-height: 0");
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
    expect(mobileItemCopy).toContain("gap: var(--gap-compact)");
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
    const settingsFooterMeta = getLastRuleBlock(".settings-footer__meta");

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
    expect(settingsFooterMeta).toContain("justify-content: space-between");
    expect(settingsFooterMeta).toContain("width: 100%");
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
    expect(launchActionButton).toContain("font-size: var(--type-body-3-size)");
    expect(launchActionButton).toContain("box-shadow: none");
  });

  it("keeps folder picker selection affordances on shared state tokens", () => {
    const directoryHover = getLastRuleBlock(".fp-dir:hover");
    const directorySelected = getLastRuleBlock(".fp-dir.selected");
    const directoryAction = getLastRuleBlock(".fp-dir-action");
    const directoryActionHover = getLastRuleBlock(".fp-dir-action:hover");
    const directoryActionFocus = getLastRuleBlock(".fp-dir-action:focus-visible");

    expect(directoryHover).toContain(
      "background: color-mix(in srgb, var(--state-selected-bg) 72%, transparent)"
    );
    expect(directorySelected).toContain("background: var(--state-selected-bg)");
    expect(directoryAction).toContain("padding: 0 var(--inset-chip-inline)");
    expect(directoryAction).toContain("border-radius: var(--radius-pill)");
    expect(directoryAction).toContain("border: 1px solid var(--state-info-border)");
    expect(directoryAction).toContain("background: var(--state-info-bg)");
    expect(directoryAction).toContain("color: var(--state-info-text)");
    expect(directoryActionHover).toContain("background: color-mix(in srgb, var(--state-info-bg)");
    expect(directoryActionHover).toContain("border-color: var(--state-info-border)");
    expect(directoryActionFocus).toContain("var(--state-focus-ring-width)");
    expect(directoryActionFocus).toContain("var(--state-focus-ring-color)");
  });

  it("keeps mobile supervisor sheets aligned with the shared fullscreen page spacing and action sizing", () => {
    const supervisorDetail = getLastRuleBlock(".mobile-supervisor-sheet__detail").replace(
      /\s+/g,
      " "
    );
    const supervisorDetailInputs = getLastGroupedRuleBlock(
      /\.mobile-supervisor-sheet__detail \.input,\s*\n\s*\.mobile-supervisor-sheet__detail \.mobile-select-trigger,\s*\n\s*\.mobile-supervisor-sheet__detail \.textarea\s*\{([^}]*)\}/g
    );
    const supervisorFullscreenFooter = getLastRuleBlock(
      ".mobile-supervisor-sheet.mobile-sheet--fullscreen .mobile-sheet__footer"
    ).replace(/\s+/g, " ");
    const supervisorFooterButton = getLastRuleBlock(
      ".mobile-supervisor-sheet__footer > .btn"
    ).replace(/\s+/g, " ");

    expect(hasRuleBlock(".mobile-supervisor-sheet__detail-header")).toBe(false);
    expect(hasRuleBlock(".mobile-supervisor-sheet__root")).toBe(false);
    expect(hasRuleBlock(".mobile-supervisor-sheet__actions")).toBe(false);
    expect(hasRuleBlock(".mobile-supervisor-sheet--root")).toBe(false);
    expect(supervisorDetail).toContain("padding: var(--sp-3)");
    expect(supervisorDetail).toContain("padding-bottom: var(--sp-4)");
    expect(supervisorDetailInputs).toContain("font-size: var(--type-body-6-size)");
    expect(supervisorDetailInputs).toContain("line-height: var(--type-body-6-line-height)");
    expect(supervisorDetailInputs).toContain("font-weight: var(--type-body-6-weight)");
    expect(supervisorDetail).not.toContain("border: 1px solid");
    expect(supervisorDetail).not.toContain("border-radius:");
    expect(supervisorDetail).not.toContain("box-shadow:");
    expect(supervisorFullscreenFooter).toContain(
      "padding: var(--sp-1) var(--sp-3) calc(var(--mobile-safe-bottom) + var(--sp-3))"
    );
    expect(supervisorFooterButton).toContain("min-height: 44px");
    expect(supervisorFooterButton).toContain("box-shadow: none");
    expect(getLastRuleBlock(".mobile-supervisor-sheet__footer")).toContain(
      "padding: var(--sp-1) var(--sp-2)"
    );
    expect(getLastRuleBlock(".mobile-supervisor-sheet__footer")).toContain("border: none");
    expect(getLastRuleBlock(".mobile-supervisor-sheet__footer")).toContain("border-radius: 0");
    expect(getLastRuleBlock(".mobile-supervisor-sheet__footer")).toContain(
      "background: transparent"
    );
    expect(getLastRuleBlock(".mobile-supervisor-sheet__footer")).toContain("box-shadow: none");
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
    const statusLeft = getLastRuleBlock(
      ".mobile-shell__bottom-stack .workspace-status-bar__left"
    ).replace(/\s+/g, " ");
    const statusStripLeft = getLastRuleBlock(
      ".mobile-shell__bottom-stack .git-panel-status-strip__left"
    ).replace(/\s+/g, " ");
    const statusMeta = getLastRuleBlock(
      ".mobile-shell__bottom-stack .git-panel-status-strip__meta"
    ).replace(/\s+/g, " ");
    const statusRight = getLastRuleBlock(
      ".mobile-shell__bottom-stack .workspace-status-bar__right"
    ).replace(/\s+/g, " ");
    const statusRightEmpty = getLastRuleBlock(
      ".mobile-shell__bottom-stack .workspace-status-bar__right:empty"
    ).replace(/\s+/g, " ");
    const updateRail = getLastRuleBlock(".mobile-shell__bottom-stack .footer-update-rail").replace(
      /\s+/g,
      " "
    );
    const updateRailText = getLastRuleBlock(
      ".mobile-shell__bottom-stack .footer-update-rail__text"
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
    expect(bottomStack).toContain("var(--surface-overlay-bg)");
    expect(bottomStack).toContain("var(--app-surface-opacity, 0.96)");
    expect(bottomStack).toContain("border-top: 1px solid color-mix(");
    expect(bottomStack).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
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
    expect(dockLabel).toContain("font-size: var(--type-body-6-size)");
    expect(statusBar).toContain("padding: 0 0 calc(var(--mobile-safe-bottom) + var(--sp-1))");
    expect(statusBar).toContain("border-top: 1px solid");
    expect(statusBar).toContain("flex-wrap: wrap");
    expect(statusBar).toContain("gap: 0");
    expect(statusStrip).toContain("min-height: 28px");
    expect(statusStrip).toContain("width: 100%");
    expect(statusStrip).toContain("font-size: var(--type-body-6-size)");
    expect(statusLeft).toContain(
      "padding: 0 calc(var(--mobile-safe-right) + var(--sp-4)) 0 calc(var(--mobile-safe-left) + var(--sp-4))"
    );
    expect(statusStripLeft).toContain("width: 100%");
    expect(statusStripLeft).toContain("justify-content: space-between");
    expect(statusMeta).toContain("margin-left: auto");
    expect(statusMeta).toContain("justify-content: flex-end");
    expect(statusRight).toContain("flex: 0 0 100%");
    expect(statusRight).toContain("width: 100%");
    expect(statusRight).toContain("max-width: none");
    expect(statusRight).toContain("justify-content: flex-end");
    expect(statusRight).toContain("margin-left: 0");
    expect(statusRight).toContain(
      "padding: 0 calc(var(--mobile-safe-right) + var(--sp-4)) 0 calc(var(--mobile-safe-left) + var(--sp-4))"
    );
    expect(statusRight).toContain("border-top: 1px solid");
    expect(statusRightEmpty).toContain("display: none");
    expect(updateRail).toContain("width: 100%");
    expect(updateRail).toContain("flex-wrap: wrap");
    expect(updateRail).toContain("justify-content: flex-end");
    expect(updateRailText).toContain("white-space: normal");
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
    expect(emptyTitle).toContain("font-size: var(--type-heading-5-size)");
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
    const mobileFilesSegmentIcon = getLastRuleBlock(".mobile-files-sheet__segment-icon");
    const mobileFilesSegmentActive = getLastRuleBlock(".mobile-files-sheet__segment.active");
    const mobileFilesSegmentIndicator = getLastRuleBlock(
      ".mobile-files-sheet__segment.active::after"
    );
    const workspaceSectionHeader = getLastRuleBlock(".workspace-sidebar-section__header");
    const workspaceSectionActions = getLastRuleBlock(".workspace-sidebar-section__actions");
    const mobileExplorerPanel = getLastRuleBlock(".mobile-explorer-panel");
    const mobileQuickJumpSearch = getLastRuleBlock(".workspace-quick-jump__search");
    const mobileQuickJumpItem = getLastRuleBlock(".workspace-quick-jump__item");
    const mobileSearchPanel = getLastRuleBlock(".workspace-search-panel--mobile");
    const mobileFileSearch = getLastRuleBlock(
      ".mobile-sheet--files .file-tree-shell--mobile .file-tree-search"
    );
    const mobileFileRow = getLastRuleBlock(
      ".mobile-sheet--files .file-tree-shell--mobile .tree-item"
    );
    const mobileFileRowSelected = getLastRuleBlock(
      ".mobile-sheet--files .file-tree-shell--mobile .tree-item.selected"
    );
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
    expect(hasRuleBlock(".mobile-supervisor-sheet__root")).toBe(false);
    expect(hasRuleBlock(".mobile-supervisor-sheet__detail-header")).toBe(false);
    expect(mobileFilesSegmented).toContain(
      "border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent)"
    );
    expect(mobileFilesSegmented).toContain("border-radius: 0");
    expect(mobileFilesSegmented).not.toContain("linear-gradient(");
    expect(mobileFilesSegmented).toContain("box-shadow: none");
    expect(mobileExplorerPanel).toContain("display: flex");
    expect(mobileExplorerPanel).toContain("flex-direction: column");
    expect(mobileFilesSegment).toContain("padding: 0");
    expect(mobileFilesSegment).toContain("justify-content: center");
    expect(mobileFilesSegment).toContain("min-width: 32px");
    expect(mobileFilesSegment).toContain("font-weight: var(--type-body-6-weight)");
    expect(mobileFilesSegmentIcon).toContain("display: block");
    expect(mobileFilesSegmentActive).toContain("background: transparent");
    expect(mobileFilesSegmentIndicator).toContain("height: 1.5px");
    expect(workspaceSectionHeader).toContain("justify-content: space-between");
    expect(workspaceSectionHeader).toContain("margin-bottom: var(--sp-2)");
    expect(workspaceSectionActions).toContain("margin-left: auto");
    expect(mobileQuickJumpSearch).toContain("border: 1px solid");
    expect(mobileQuickJumpItem).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(mobileSearchPanel).toContain("background: transparent");
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
    expect(drawerItem).toContain("border-radius: var(--radius-xl)");
    expect(drawerFooterButton).toContain("border-radius: var(--radius-md)");
    expect(welcomeCard).toContain("border-radius: var(--radius-lg)");
    expect(welcomeFeature).toContain("border-radius: var(--radius-lg)");
    expect(welcomeButton).toContain("border-radius: var(--radius-md)");
    expect(authCard).toContain("border-radius: var(--radius-lg)");
    expect(authStatusPanel).toContain("border-radius: var(--radius-md)");
    expect(settingsItem).toContain("border-radius: 0");
    expect(settingsItemIconShell).toContain("border-radius: var(--radius-xl)");
  });

  it("stacks mobile welcome and auth shells vertically so cards size to content", () => {
    const welcomeContainer = getLastRuleBlock(".welcome-container--mobile");
    const authScreen = getLastRuleBlock(".auth-screen--mobile");

    expect(welcomeContainer).toContain("flex-direction: column");
    expect(welcomeContainer).toContain("align-items: stretch");
    expect(welcomeContainer).toContain("justify-content: flex-start");
    expect(authScreen).toContain("padding:");
  });

  it("keeps settings content groups and provider controls aligned with editor configuration panels", () => {
    const settingsGroup = getLastRuleBlock(".settings-group");
    const settingsGroupTitle = getLastRuleBlock(".settings-group-title");
    const settingsGroupDesc = getLastRuleBlock(".settings-group-desc");
    const settingsMobileGroupTitle = getLastRuleBlock(".settings-mobile-group__title");
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

    expect(settingsGroup).toContain("margin-bottom: var(--space-section)");
    expect(settingsGroupTitle).toContain("font-size: var(--type-body-3-size)");
    expect(settingsGroupTitle).toContain("text-transform: uppercase");
    expect(settingsGroupTitle).toContain("letter-spacing:");
    expect(settingsGroupDesc).toContain("max-width:");
    expect(settingsMobileGroupTitle).toContain("font-size: var(--type-body-3-size)");
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
    expect(settingsStatusHint).toContain("line-height: var(--type-body-5-line-height)");
    expect(settingsLink).toContain("display: inline-flex");
    expect(settingsLink).toContain("font-weight: var(--font-medium)");
    expect(providerTabs).toContain("gap: var(--sp-1)");
    expect(providerTabs).toContain("margin-bottom: var(--space-default)");
    expect(providerTab).toContain("background: transparent");
    expect(providerTab).toContain("border: 1px solid transparent");
    expect(providerTabActive).toContain("background: var(--bg-active)");
    expect(providerTabActive).toContain("border-color: var(--border-focus)");
    expect(providerSubnav).toContain("gap: var(--sp-1)");
    expect(providerSubnav).toContain("margin-bottom: var(--space-default)");
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
    expect(pill).toContain("border-radius: var(--radius-pill)");
    expect(pill).toContain("background: transparent");
    expect(pill).toContain("font-size: var(--type-body-6-size)");
    expect(pill).toContain("font-weight: var(--type-body-6-weight)");
    expect(pillHover).toContain("background: var(--state-hover-bg-subtle)");
    expect(pillHover).toContain("border-color: var(--state-selected-border)");
    expect(pillFocus).toContain("border-color: var(--state-focus-ring-color)");
    expect(pillFocus).toContain("box-shadow: 0 0 0 var(--state-focus-ring-width)");
    expect(active).toContain("background: var(--state-selected-bg)");
    expect(active).toContain("border-color: var(--state-selected-border)");
    expect(active).not.toContain("background: var(--accent-blue)");
  });

  it("keeps inline notices closer to embedded status strips than standalone cards", () => {
    const notice = getLastRuleBlockFrom(noticeStylesheet, ".notice");
    const warning = getLastRuleBlockFrom(noticeStylesheet, ".warning");
    const error = getLastRuleBlockFrom(noticeStylesheet, ".error");
    const title = getLastRuleBlockFrom(noticeStylesheet, ".title");
    const message = getLastRuleBlockFrom(noticeStylesheet, ".message");
    const action = getLastRuleBlockFrom(noticeStylesheet, ".action");

    expect(notice).toContain("margin: 0 0 var(--space-default)");
    expect(notice).toContain("padding: var(--inset-control-block) var(--inset-control-inline)");
    expect(notice).toContain("border-radius: var(--radius-overlay)");
    expect(notice).toContain("background: var(--surface-elevated-bg)");
    expect(notice).toContain("overflow: hidden");
    expect(warning).toContain("background: var(--state-warning-bg)");
    expect(warning).toContain("border-color: var(--state-warning-border)");
    expect(error).toContain("background: var(--state-error-bg)");
    expect(error).toContain("border-color: var(--state-error-border)");
    expect(title).toContain("text-transform: uppercase");
    expect(title).toContain("font-size: var(--type-body-6-size)");
    expect(message).toContain("font-size: var(--type-body-5-size)");
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
    expect(keycap).toContain("border-radius: var(--radius-control-sm)");
    expect(hover).toContain("border-color: var(--border-focus)");
    expect(hover).toContain("background: var(--bg-active)");
    expect(focus).toContain("border-color: var(--state-focus-ring-color)");
    expect(focus).toContain("box-shadow: 0 0 0 var(--state-focus-ring-width)");
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
    expect(configCardBase).toContain("margin-top: var(--space-default)");
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
    expect(configField).toContain("margin-bottom: var(--space-default)");
    expect(configLabel).toContain("font-size: var(--type-body-6-size)");
    expect(configLabel).toContain("text-transform: uppercase");
    expect(configLabel).toContain("letter-spacing:");
    expect(configLabel).toContain("margin-bottom: 0");
    expect(argsInput).toContain("background: color-mix");
    expect(argsInput).toContain("border-color: var(--border)");
    expect(argsInput).toContain("font-family: var(--font-mono)");
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
    expect(providerMobileEntryMeta).toContain("font-family: var(--font-mono)");
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
    const emptyState = getLastRuleBlock(".file-tree-empty");
    const row = getLastRuleBlock(".file-tree-shell .tree-item");
    const rowSelected = getLastRuleBlock(".file-tree-shell .tree-item.selected");
    const rowActionsBase = getLastRuleBlock(".file-tree-shell .tree-item-actions");
    const rowActionsDesktop = getLastRuleBlock(".file-tree-shell--desktop .tree-item-actions");

    expect(search).toContain("gap: var(--gap-default)");
    expect(search).toContain("margin: var(--space-default) var(--inset-control-inline)");
    expect(search).toContain("padding-inline: var(--inset-control-inline)");
    expect(search).toContain("min-height: var(--control-height-md)");
    expect(search).toContain("border-radius: var(--radius-panel)");
    expect(search).toContain("background: color-mix(");
    expect(searchInput).toContain("font-size: var(--type-body-3-size)");
    expect(searchInput).toContain("line-height: var(--type-body-3-line-height)");
    expect(searchInput).toContain("font-weight: var(--type-body-3-weight)");
    expect(emptyState).toContain("padding: var(--sp-5) var(--inset-panel)");
    expect(row).toContain("min-height: 26px");
    expect(row).toContain("gap: var(--gap-tight)");
    expect(row).toContain("padding:");
    expect(row).toContain("3px");
    expect(row).toContain("var(--inset-control-block)");
    expect(row).toContain("var(--inset-row-inline)");
    expect(row).toContain("border-radius: var(--radius-panel)");
    expect(row).toContain("transition:");
    expect(rowSelected).toContain(
      "border-left: var(--state-focus-ring-width) solid var(--state-selected-border)"
    );
    expect(rowSelected).toContain(
      "padding-left: calc(var(--inset-row-inline) - var(--state-focus-ring-width))"
    );
    expect(rowSelected).toContain("background: var(--state-selected-bg)");
    expect(rowActionsBase).toContain("gap: var(--gap-compact)");
    expect(rowActionsDesktop).toContain("opacity: 0");
  });

  it("keeps workspace search and quick open on compact editor-search chrome", () => {
    const openEditorsHeader = getLastRuleBlock(".workspace-open-editors__header");
    const openEditorsHeaderMain = getLastRuleBlock(".workspace-open-editors__header-main");
    const openEditorsTitle = getLastRuleBlock(".workspace-open-editors__title");
    const openEditorsTitleText = getLastRuleBlock(".workspace-open-editors__title-text");
    const openEditorsCloseAll = getLastRuleBlock(".workspace-open-editors__close-all");
    const openEditorsRow = getLastRuleBlock(".workspace-open-editors__row");
    const searchControls = getLastRuleBlock(".workspace-search-panel__controls");
    const searchInput = getLastRuleBlock(".workspace-search-panel__input");
    const openEditorsItem = getLastRuleBlock(".workspace-open-editors__item");
    const openEditorsItemLabel = getLastRuleBlock(".workspace-open-editors__item-label");
    const searchGroupHeader = getLastRuleBlock(".workspace-search-panel__group-header");
    const searchGroupPath = getLastRuleBlock(".workspace-search-panel__group-path");
    const searchMatch = getLastRuleBlock(".workspace-search-panel__match");
    const searchLine = getLastRuleBlock(".workspace-search-panel__line");
    const quickOpen = getLastRuleBlock(".quick-open");
    const quickOpenSearch = getLastRuleBlock(".quick-open__search");
    const quickOpenItem = getLastRuleBlock(".quick-open__item");
    const quickOpenItemActive = getLastRuleBlock(".quick-open__item--active");
    const quickOpenItemSelected = getLastRuleBlock('.quick-open__item[aria-selected="true"]');
    const quickOpenPrimary = getLastRuleBlock(".quick-open__primary");
    const quickOpenSecondary = getLastRuleBlock(".quick-open__secondary");
    const quickOpenSelectedSecondary = getLastRuleBlock(
      '.quick-open__item[aria-selected="true"] .quick-open__secondary'
    );

    expect(openEditorsHeader).toContain("display: flex");
    expect(openEditorsHeaderMain).toContain("flex: 1 1 auto");
    expect(openEditorsHeaderMain).toContain("min-width: 0");
    expect(openEditorsTitle).toContain("justify-content: flex-start");
    expect(openEditorsTitle).toContain("min-width: 0");
    expect(openEditorsTitleText).toContain("text-overflow: ellipsis");
    expect(openEditorsTitleText).toContain("white-space: nowrap");
    expect(openEditorsCloseAll).toContain("margin-left: auto");
    expect(openEditorsCloseAll).toContain("background: transparent");
    expect(openEditorsCloseAll).toContain("color: var(--text-secondary)");
    expect(openEditorsRow).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(searchControls).toContain("border-bottom: 1px solid color-mix(");
    expect(searchControls).toContain("background: color-mix(");
    expect(searchInput).toContain("min-height: 34px");
    expect(searchInput).toContain("border-radius: 4px");
    expect(searchInput).toContain("box-shadow: none");
    expect(openEditorsItem).toContain("overflow: hidden");
    expect(openEditorsItem).toContain("text-overflow: ellipsis");
    expect(openEditorsItem).toContain("white-space: nowrap");
    expect(openEditorsItemLabel).toContain("text-overflow: ellipsis");
    expect(openEditorsItemLabel).toContain("white-space: nowrap");
    expect(searchGroupHeader).toContain("grid-template-columns: 14px minmax(0, 1fr) auto");
    expect(searchGroupHeader).toContain("box-shadow: inset 0 -1px 0 color-mix(");
    expect(searchGroupPath).toContain("font-family: var(--font-mono)");
    expect(searchGroupPath).toContain("font-size: var(--type-body-6-size)");
    expect(searchMatch).toContain("grid-template-columns: 40px minmax(0, 1fr)");
    expect(searchLine).toContain("text-align: right");

    expect(quickOpen).toContain("border: 1px solid var(--surface-overlay-border)");
    expect(quickOpen).toContain("border-radius: var(--radius-overlay)");
    expect(quickOpen).toContain("background: var(--surface-overlay-bg)");
    expect(quickOpenSearch).toContain("border-bottom: 1px solid color-mix(");
    expect(quickOpenSearch).toContain("background: color-mix(");
    expect(quickOpenItem).toContain("gap: var(--gap-compact)");
    expect(quickOpenItem).toContain("box-shadow: inset 0 -1px 0 color-mix(");
    expect(quickOpenItemActive).toContain(
      "background: color-mix(in srgb, var(--accent-blue) 12%, var(--bg-panel))"
    );
    expect(quickOpenItemSelected).toContain(
      "background: color-mix(in srgb, var(--accent-blue) 12%, var(--bg-panel))"
    );
    expect(quickOpenPrimary).toContain("font-size: var(--type-body-3-size)");
    expect(quickOpenSecondary).toContain("font-size: var(--type-body-5-size)");
    expect(quickOpenSecondary).toContain("color: var(--text-secondary)");
    expect(quickOpenSelectedSecondary).toContain(
      "color: color-mix(in srgb, var(--accent-blue) 52%, var(--text-secondary))"
    );
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
    const commandPaletteSheetSearch = getLastRuleBlock(".command-palette-sheet__search");
    const commandPaletteItem = getLastRuleBlock(".command-palette--desktop .command-palette-item");
    const commandPaletteItemContent = getLastRuleBlock(".command-palette-item-content");
    const commandPaletteItemShortcut = getLastRuleBlock(".command-palette-item-shortcut");

    expect(gitScroll).toContain("gap: 14px");
    expect(gitCommitBlock).toContain("gap: 10px");
    expect(gitSection).toContain("gap: 8px");
    expect(gitWorktreeRow).toContain("min-height: 28px");
    expect(gitHistoryRow).toContain("min-height: 34px");
    expect(commandPalette).toContain("max-width: var(--desktop-modal-max-width-md)");
    expect(commandPaletteDesktop).toContain("overflow: hidden");
    expect(commandPaletteHeader).toContain("padding: var(--sp-3) var(--sp-4)");
    expect(commandPaletteSearch).toContain("padding: var(--sp-3) var(--sp-4)");
    expect(commandPaletteSheetSearch).toContain("z-index: var(--z-inline)");
    expect(commandPaletteItem).toContain("align-items: center");
    expect(commandPaletteItem).toContain("gap: var(--sp-3)");
    expect(commandPaletteItem).toContain("padding: var(--sp-3) var(--sp-4)");
    expect(commandPaletteItemContent).toContain("gap: var(--gap-micro)");
    expect(commandPaletteItemShortcut).toContain("margin-top: var(--space-micro)");
    expect(commandPaletteItemShortcut).toContain(
      "padding: var(--inset-chip-block) var(--inset-chip-inline)"
    );
    expect(commandPaletteItemShortcut).toContain("border-radius: var(--radius-pill)");
  });

  it("keeps session header badges on a single line by truncating the title first", () => {
    const titleRow = getLastRuleBlock(".mobile-shell__agent-stage .session-title-row");
    const title = getLastRuleBlock(".panel-header__title");
    const badges = getLastGroupedRuleBlock(
      /\.mobile-shell__agent-stage \.session-provider-badge,\s*\.mobile-shell__agent-stage \.session-state-badge\s*\{([^}]*)\}/g
    );

    expect(titleRow).toContain("flex-wrap: nowrap");
    expect(title).toContain("overflow: hidden");
    expect(title).toContain("text-overflow: ellipsis");
    expect(title).toContain("white-space: nowrap");
    expect(hasRuleBlock(".mobile-shell__agent-stage .session-title")).toBe(false);
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
    const header = getLastRuleBlock(".mobile-shell__agent-stage > .session-card > .panel-header");
    const titleRow = getLastRuleBlock(".mobile-shell__agent-stage .session-title-row");
    const headerRight = getLastRuleBlock(".mobile-shell__agent-stage .session-header-right");
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
    expect(titleRow).toContain("gap: 6px");
    expect(headerRight).toContain("max-width: 100%");
    expect(headerRight).not.toContain("max-width: min(48%, 220px)");
    expect(hasRuleBlock(".mobile-shell__agent-stage .session-header")).toBe(false);
    expect(hasRuleBlock(".mobile-shell__agent-stage .session-header-left")).toBe(false);
    expect(hasRuleBlock(".mobile-shell__agent-stage .session-title")).toBe(false);
    expect(badges).toContain("height: 15px");
    expect(badges).toContain("border-radius: 3px");
    expect(supervisorBadge).toContain("min-height: 26px");
    expect(supervisorBadge).not.toContain("width: max-content");
    expect(supervisorBadge).toContain("border-radius: 4px");
    expect(supervisorBadge).not.toContain("border-radius: var(--radius-lg)");
    expect(supervisorLabel).toContain("font-size: var(--type-body-6-size)");
    expect(supervisorLabel).toContain("line-height: var(--type-body-6-line-height)");
    expect(supervisorLabel).toContain("font-weight: var(--type-body-6-weight)");
  });

  it("keeps running session header emphasis theme-safe and motion-aware", () => {
    const runningHeader = getLastRuleBlock(".session-card > .panel-header.session-header--running");
    const runningDot = getLastRuleBlock(".session-dot-running");
    const runningBadge = getLastRuleBlock(
      ".session-card > .panel-header .session-state-badge.badge-green"
    );
    const darkRunningBadge = getLastRuleBlock(
      '[data-theme$="-dark"] .session-card > .panel-header .session-state-badge.badge-green'
    );
    const lightRunningBadge = getLastRuleBlock(
      '[data-theme$="-light"] .session-card > .panel-header .session-state-badge.badge-green'
    );
    const statusDotStyles = getLastRuleBlockFrom(
      statusDotStylesheet,
      ":global(.session-dot-running)"
    );
    const runningRingStyles = getRuleBlocksFrom(
      statusDotStylesheet,
      ":global(.session-dot-running)::after"
    );
    const runningRingGhostStyles = getRuleBlocksFrom(
      statusDotStylesheet,
      ":global(.session-dot-running)::before"
    );
    const reducedDotMotion = getLastGroupedRuleBlockFrom(
      statusDotStylesheet,
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?:global\(\.session-dot-running\)::after\s*\{([^}]*)\}/g
    );

    expect(hasRuleBlock(".session-card.session-card--running")).toBe(false);
    expect(runningHeader).toContain("background:");
    expect(runningHeader).not.toContain("animation:");
    expect(runningDot).toContain("box-shadow:");
    expect(runningBadge).toContain("border: 1px solid color-mix(");
    expect(runningBadge).toContain("background: color-mix(in srgb, currentColor");
    expect(runningBadge).not.toContain("animation:");
    expect(darkRunningBadge).toContain("box-shadow:");
    expect(lightRunningBadge).toContain("box-shadow:");
    expect(statusDotStyles).toContain("animation: statusDotRunningPulse 1.18s");
    expect(
      runningRingStyles.some((block) => block.includes("animation: statusDotRunningRing 1.18s"))
    ).toBe(true);
    expect(
      runningRingGhostStyles.some((block) =>
        block.includes("animation: statusDotRunningRingGhost 1.18s")
      )
    ).toBe(true);
    expect(hasRuleBlock(".session-card > .panel-header.session-header--running::after")).toBe(
      false
    );
    expect(reducedDotMotion).toContain("animation: none");
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
    expect(desktopButton).toContain("line-height: var(--type-body-6-line-height)");
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
    expect(mobileBadgeLabel).toContain("line-height: var(--type-body-6-line-height)");
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

  it("keeps the About update action row right-aligned with explicit spacing", () => {
    const actionRowBase = getLastRuleBlock(".settings-actions-row");
    const actionRow = getLastRuleBlock(".settings-actions-row--end");

    expect(actionRowBase).toContain("display: flex");
    expect(actionRowBase).toContain("align-items: center");
    expect(actionRowBase).toContain("flex-wrap: wrap");
    expect(actionRow).toContain("justify-content: flex-end");
    expect(actionRow).toContain("gap: var(--sp-3)");
    expect(actionRow).toContain("margin-top: var(--sp-3)");
  });

  it("does not add a dedicated About interval alignment wrapper", () => {
    expect(hasRuleBlock(".settings-about-interval-control-wrap")).toBe(false);
  });

  it("removes the unused legacy provider card chrome from settings styles", () => {
    expect(stylesheet).not.toContain(".settings-provider-card {");
    expect(stylesheet).not.toContain(".settings-provider-header {");
    expect(stylesheet).not.toContain(".settings-provider-badge {");
    expect(stylesheet).not.toContain(".settings-provider-meta {");
  });
});
