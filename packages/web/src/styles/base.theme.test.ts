// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(`${process.cwd()}/src/styles/base.css`, "utf8");
const tokensStylesheet = readFileSync(`${process.cwd()}/src/styles/tokens.css`, "utf8");

function getRuleBlock(selector: string) {
  const blocks: string[] = [];
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null = null;
  const normalizedSelector = selector.replace(/\s+/g, " ").trim();

  while ((match = matcher.exec(stylesheet)) !== null) {
    const selectors = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((entry) => entry.replace(/\s+/g, " ").trim());

    if (selectors.includes(normalizedSelector)) {
      blocks.push(match[2]);
    }
  }

  if (blocks.length === 0) {
    throw new Error(`expected CSS rule for ${selector}`);
  }

  return blocks.at(-1) ?? "";
}

describe("base.css theme-sensitive shells", () => {
  it("keeps the app loading shell on theme tokens instead of dark-only gradients", () => {
    const shell = getRuleBlock(".app-loading-shell");
    const card = getRuleBlock(".app-loading-card");

    expect(shell).toContain("var(--surface-page-bg)");
    expect(shell).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
    expect(card).toContain("var(--surface-overlay-bg)");
    expect(card).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
    expect(card).toContain("box-shadow: var(--surface-overlay-shadow)");
    expect(card).toContain("border-radius: var(--radius-overlay)");
  });

  it("defines shared icon tone and surface utilities", () => {
    const tone = getRuleBlock(".icon-tone-secondary");
    const surface = getRuleBlock(".icon-surface-warning");
    const chip = getRuleBlock(".icon-chip");
    const themedIcon = getRuleBlock(".themed-icon");
    const themedTone = getRuleBlock(".themed-icon--tone-warning");
    const themedSurface = getRuleBlock(".themed-icon--surface-info");

    expect(tone).toContain("color: var(--icon-secondary)");
    expect(surface).toContain("background: var(--state-warning-bg)");
    expect(chip).toContain("display: inline-flex");
    expect(chip).toContain("align-items: center");
    expect(chip).toContain("justify-content: center");
    expect(chip).toContain("border-radius: var(--radius-control)");
    expect(themedIcon).toContain("display: inline-flex");
    expect(themedIcon).toContain("line-height: 0");
    expect(themedTone).toContain("color: var(--icon-warning)");
    expect(themedSurface).toContain("background: var(--icon-surface-info)");
  });

  it("routes focus and shell chrome through semantic foundation tokens", () => {
    expect(getRuleBlock(":focus-visible")).toContain(
      "outline: var(--state-focus-ring-width) solid var(--state-focus-ring-color)"
    );
    expect(getRuleBlock(".app-loading-shell")).toContain("var(--surface-page-bg)");
    expect(getRuleBlock(".app-loading-card")).toContain("var(--surface-overlay-bg)");
    expect(getRuleBlock(".app-loading-card")).toContain(
      "box-shadow: var(--surface-overlay-shadow)"
    );
    expect(getRuleBlock(".app-loading-card")).toContain("border-radius: var(--radius-overlay)");
    expect(getRuleBlock(".icon-chip")).toContain("border-radius: var(--radius-control)");
    expect(getRuleBlock(".icon-surface-warning")).toContain("background: var(--state-warning-bg)");
  });

  it("defines app-shell background variables and appearance-aware loading shell hooks", () => {
    const app = getRuleBlock(".app");
    const appBefore = getRuleBlock(".app::before");
    const appAfter = getRuleBlock(".app::after");
    const loadingShell = getRuleBlock(".app-loading-shell");

    expect(app).toContain("background: var(--surface-page-bg)");
    expect(app).toContain("isolation: isolate");
    expect(appBefore).toContain("background-image: var(--app-bg-image, none)");
    expect(appBefore).toContain("background-size: var(--app-bg-fit, cover)");
    expect(appBefore).toContain("filter: blur(var(--app-bg-blur, 0px))");
    expect(appAfter).toContain("var(--app-bg-dim, 0)");
    expect(loadingShell).toContain("var(--app-surface-opacity, 0.96)");
    expect(loadingShell).toContain("backdrop-filter: var(--app-surface-backdrop-filter, none)");
  });
});

describe("base.css viewport sizing", () => {
  it("uses dynamic viewport height for the shared app shell", () => {
    const root = getRuleBlock("#root");
    const app = getRuleBlock(".app");

    expect(root).toContain("height: 100dvh");
    expect(root).not.toContain("height: 100vh");
    expect(app).toContain("height: 100dvh");
    expect(app).not.toContain("height: 100vh");
  });
});

describe("base.css desktop typography foundation", () => {
  it("defines the semantic and desktop layout tokens used by polished PC surfaces", () => {
    expect(tokensStylesheet).toContain("--text-muted:");
    expect(tokensStylesheet).toContain("--bg-panel:");
    expect(tokensStylesheet).toContain("--bg-elevated:");
    expect(tokensStylesheet).toContain("--accent-red:");
    expect(tokensStylesheet).toContain("--desktop-topbar-height:");
    expect(tokensStylesheet).toContain("--desktop-statusbar-height:");
    expect(tokensStylesheet).toContain("--desktop-sidebar-header-height:");
    expect(tokensStylesheet).toContain("--desktop-panel-padding:");
    expect(tokensStylesheet).toContain("--desktop-panel-gap:");
    expect(tokensStylesheet).toContain("--desktop-content-max-width:");
    expect(tokensStylesheet).toContain("--desktop-modal-max-width-md:");
    expect(tokensStylesheet).toContain("--desktop-modal-max-width-lg:");
  });

  it("defines semantic overlay z-index tokens for governed layers", () => {
    expect(tokensStylesheet).toContain("--z-local-overlay:");
    expect(tokensStylesheet).toContain("--z-drawer-backdrop:");
    expect(tokensStylesheet).toContain("--z-drawer:");
    expect(tokensStylesheet).toContain("--z-workbench-backdrop:");
    expect(tokensStylesheet).toContain("--z-workbench:");
    expect(tokensStylesheet).toContain("--z-modal-backdrop:");
    expect(tokensStylesheet).toContain("--z-modal:");
    expect(tokensStylesheet).toContain("--z-popover:");
    expect(tokensStylesheet).toContain("--z-tooltip:");
    expect(tokensStylesheet).toContain("--z-toast:");
  });

  it("maps base text elements onto semantic typography tokens", () => {
    expect(getRuleBlock("body")).toContain("font-size: var(--type-body-3-size)");
    expect(getRuleBlock("body")).toContain("line-height: var(--type-body-3-line-height)");
    expect(getRuleBlock("body")).toContain("font-weight: var(--type-body-3-weight)");
    expect(getRuleBlock("p")).toContain("line-height: var(--type-body-3-line-height)");

    expect(getRuleBlock("button")).toContain("font-size: var(--type-body-3-size)");
    expect(getRuleBlock("button")).toContain("line-height: var(--type-body-3-line-height)");
    expect(getRuleBlock("button")).toContain("font-weight: var(--type-body-3-weight)");
    expect(getRuleBlock("input")).toContain("font-size: var(--type-body-3-size)");
    expect(getRuleBlock("input")).toContain("line-height: var(--type-body-3-line-height)");
    expect(getRuleBlock("input")).toContain("font-weight: var(--type-body-3-weight)");
    expect(getRuleBlock("textarea")).toContain("font-size: var(--type-body-3-size)");
    expect(getRuleBlock("select")).toContain("font-size: var(--type-body-3-size)");
  });

  it("maps headings and helper text onto the new semantic hierarchy", () => {
    expect(getRuleBlock("h1")).toContain("font-size: var(--type-heading-1-size)");
    expect(getRuleBlock("h1")).toContain("font-weight: var(--type-heading-1-weight)");
    expect(getRuleBlock("h2")).toContain("font-size: var(--type-heading-2-size)");
    expect(getRuleBlock("h3")).toContain("font-size: var(--type-heading-3-size)");
    expect(getRuleBlock("h4")).toContain("font-size: var(--type-heading-4-size)");
    expect(getRuleBlock("h5")).toContain("font-size: var(--type-heading-5-size)");
    expect(getRuleBlock("h6")).toContain("font-size: var(--type-heading-6-size)");

    expect(getRuleBlock(".page-kicker")).toContain("font-size: var(--type-body-6-size)");
    expect(getRuleBlock(".page-kicker")).toContain("font-weight: var(--type-body-6-weight)");
    expect(getRuleBlock(".page-title")).toContain("font-size: var(--type-heading-1-size)");
    expect(getRuleBlock(".section-title")).toContain("font-size: var(--type-body-6-size)");
    expect(getRuleBlock(".meta-text")).toContain("font-size: var(--type-body-5-size)");
    expect(getRuleBlock(".hint-text")).toContain("font-size: var(--type-body-5-size)");
    expect(getRuleBlock(".mono-meta")).toContain("font-size: var(--type-body-5-size)");
    expect(getRuleBlock(".mono-meta")).toContain("font-family: var(--font-mono)");
  });

  it("maps app shell copy onto direct role tokens", () => {
    expect(getRuleBlock(".connection-banner")).toContain("font-size: var(--type-body-6-size)");
    expect(getRuleBlock(".connection-banner")).toContain(
      "line-height: var(--type-body-6-line-height)"
    );
    expect(getRuleBlock(".app-loading-kicker")).toContain("font-size: var(--type-body-6-size)");
    expect(getRuleBlock(".app-loading-title")).toContain("font-size: var(--type-heading-1-size)");
    expect(getRuleBlock(".app-loading-desc")).toContain("font-size: var(--type-body-3-size)");
  });
});
