import { describe, expect, it } from "vitest";
import { getIconPresentation, ICON_SEMANTICS } from "./index";

describe("theme icon resolver", () => {
  it("resolves the base semantic set for every built-in theme", () => {
    for (const themeId of [
      "mint-dark",
      "mint-light",
      "graphite-dark",
      "graphite-light",
      "nord-dark",
      "nord-light",
      "hc-dark",
      "hc-light",
    ]) {
      for (const semantic of ICON_SEMANTICS) {
        expect(getIconPresentation(themeId, semantic)).toEqual(
          expect.objectContaining({
            semantic,
            tone: expect.any(String),
            surface: expect.any(String),
            Icon: expect.anything(),
          })
        );
      }
    }
  });

  it("allows themes to vary icon presentation for the same semantic", () => {
    const mintFolder = getIconPresentation("mint-dark", "file.folder.closed");
    const hcFolder = getIconPresentation("hc-dark", "file.folder.closed");

    expect(hcFolder).toEqual(
      expect.objectContaining({
        tone: expect.any(String),
        surface: expect.any(String),
      })
    );
    expect(mintFolder.Icon).not.toBeUndefined();
    expect(hcFolder.Icon).not.toBeUndefined();
    expect(mintFolder.strokeWidth).not.toBe(hcFolder.strokeWidth);
  });

  it("uses distinct glyphs for footer git action semantics", () => {
    const diffIcon = getIconPresentation("mint-dark", "git.action.diff").Icon;
    const pushIcon = getIconPresentation("mint-dark", "git.action.push").Icon;
    const pullIcon = getIconPresentation("mint-dark", "git.action.pull").Icon;
    const refreshIcon = getIconPresentation("mint-dark", "git.action.refresh").Icon;

    expect(new Set([diffIcon, pushIcon, pullIcon, refreshIcon]).size).toBe(4);
  });

  it("gives footer git status semantics a stable visual hierarchy", () => {
    for (const themeId of [
      "mint-dark",
      "mint-light",
      "graphite-dark",
      "graphite-light",
      "nord-dark",
      "nord-light",
      "hc-dark",
      "hc-light",
    ] as const) {
      expect(getIconPresentation(themeId, "git.footer.branch")).toEqual(
        expect.objectContaining({ tone: "current" })
      );
      expect(getIconPresentation(themeId, "git.footer.diff")).toEqual(
        expect.objectContaining({ tone: "warning" })
      );
      expect(getIconPresentation(themeId, "git.footer.push")).toEqual(
        expect.objectContaining({ tone: "success" })
      );
      expect(getIconPresentation(themeId, "git.footer.pull")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.footer.refresh")).toEqual(
        expect.objectContaining({ tone: "secondary" })
      );
    }
  });

  it("applies richer common icon tones for mint themes", () => {
    for (const themeId of ["mint-dark", "mint-light"] as const) {
      expect(getIconPresentation(themeId, "nav.agent")).toEqual(
        expect.objectContaining({ tone: "current" })
      );
      expect(getIconPresentation(themeId, "agent.provider.codex")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "mobile.dock.agent")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "mobile.dock.files")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "mobile.dock.terminal")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "nav.panelTerminal")).toEqual(
        expect.objectContaining({ tone: "current" })
      );
      expect(getIconPresentation(themeId, "nav.panelFiles")).toEqual(
        expect.objectContaining({ tone: "current" })
      );
      expect(getIconPresentation(themeId, "terminal.action.new")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.branch")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.action.diff")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.action.push")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.action.pull")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.action.refresh")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.commit")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "nav.settings.appearance")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
    }
  });

  it("keeps graphite themes restrained while highlighting key icons", () => {
    for (const themeId of ["graphite-dark", "graphite-light"] as const) {
      expect(getIconPresentation(themeId, "nav.agent")).toEqual(
        expect.objectContaining({ tone: "current" })
      );
      expect(getIconPresentation(themeId, "agent.provider.codex")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "mobile.dock.agent")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "mobile.dock.files")).toEqual(
        expect.objectContaining({ tone: "secondary" })
      );
      expect(getIconPresentation(themeId, "mobile.dock.terminal")).toEqual(
        expect.objectContaining({ tone: "secondary" })
      );
      expect(getIconPresentation(themeId, "git.branch")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.action.diff")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.action.push")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.action.pull")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.action.refresh")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "nav.settings.appearance")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "nav.panelTerminal")).toEqual(
        expect.objectContaining({ tone: "current" })
      );
      expect(getIconPresentation(themeId, "nav.panelFiles")).toEqual(
        expect.objectContaining({ tone: "current" })
      );
      expect(getIconPresentation(themeId, "terminal.action.new")).toEqual(
        expect.objectContaining({ tone: "secondary" })
      );
      expect(getIconPresentation(themeId, "git.commit")).toEqual(
        expect.objectContaining({ tone: "secondary" })
      );
    }
  });

  it("gives nord themes a cooler accent hierarchy", () => {
    for (const themeId of ["nord-dark", "nord-light"] as const) {
      expect(getIconPresentation(themeId, "nav.agent")).toEqual(
        expect.objectContaining({ tone: "current" })
      );
      expect(getIconPresentation(themeId, "agent.provider.codex")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "mobile.dock.agent")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "mobile.dock.files")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "mobile.dock.terminal")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "nav.panelTerminal")).toEqual(
        expect.objectContaining({ tone: "current" })
      );
      expect(getIconPresentation(themeId, "nav.panelFiles")).toEqual(
        expect.objectContaining({ tone: "current" })
      );
      expect(getIconPresentation(themeId, "terminal.action.new")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.branch")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "git.action.diff")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "git.action.push")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "git.action.pull")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "git.action.refresh")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "git.commit")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "nav.settings.appearance")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "nav.settings.providers")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
    }
  });
});
