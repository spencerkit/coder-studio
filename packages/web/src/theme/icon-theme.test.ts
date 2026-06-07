import { AlertTriangle, Info } from "lucide-react";
import { describe, expect, it } from "vitest";
import { BASE_ICON_THEME, getIconPresentation, ICON_SEMANTICS, THEME_IDS } from "./index";

describe("theme icon resolver", () => {
  const builtInThemes = THEME_IDS;
  const seasonalThemes = THEME_IDS.filter((themeId) =>
    /^(spring|summer|autumn|winter)-(dark|light)$/.test(themeId)
  );
  const semanticStatusExpectations = [
    ["state.success", { glyph: Info, tone: "success", surface: "success" }],
    ["state.warning", { glyph: AlertTriangle, tone: "warning", surface: "warning" }],
    ["state.error", { glyph: AlertTriangle, tone: "error", surface: "error" }],
    ["state.info", { glyph: Info, tone: "info", surface: "info" }],
  ] as const;

  it("resolves the base semantic set for every built-in theme", () => {
    for (const themeId of builtInThemes) {
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
    for (const themeId of builtInThemes) {
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

  it("keeps mobile dock icons aligned within each built-in theme", () => {
    for (const themeId of builtInThemes) {
      const agentTone = getIconPresentation(themeId, "mobile.dock.agent").tone;
      const filesTone = getIconPresentation(themeId, "mobile.dock.files").tone;
      const terminalTone = getIconPresentation(themeId, "mobile.dock.terminal").tone;

      expect(filesTone).toBe(terminalTone);

      if (themeId === "spring-dark" || themeId === "autumn-dark") {
        expect(agentTone).toBe("accent");
        expect(filesTone).toBe("current");
      } else if (
        themeId === "spring-light" ||
        themeId === "summer-dark" ||
        themeId === "summer-light" ||
        themeId === "autumn-light"
      ) {
        expect(agentTone).toBe("accent");
        expect(filesTone).toBe("secondary");
      } else if (themeId === "winter-dark" || themeId === "winter-light") {
        expect(agentTone).toBe("info");
        expect(filesTone).toBe("secondary");
      } else {
        expect(agentTone).toBe(filesTone);
      }
    }
  });

  it("keeps the seasonal shared git footer hierarchy stable", () => {
    for (const themeId of seasonalThemes) {
      expect(getIconPresentation(themeId, "git.footer.diff")).toEqual(
        expect.objectContaining({ tone: "warning" })
      );
      expect(getIconPresentation(themeId, "git.footer.push")).toEqual(
        expect.objectContaining({ tone: "success" })
      );
    }
  });

  it("keeps settings navigation icons aligned within each built-in theme", () => {
    for (const themeId of builtInThemes) {
      const tones = new Set([
        getIconPresentation(themeId, "nav.settings.general").tone,
        getIconPresentation(themeId, "nav.settings.providers").tone,
        getIconPresentation(themeId, "nav.settings.appearance").tone,
        getIconPresentation(themeId, "nav.settings.shortcuts").tone,
        getIconPresentation(themeId, "nav.settings.monitoring").tone,
        getIconPresentation(themeId, "nav.settings.diagnostics").tone,
        getIconPresentation(themeId, "nav.settings.about").tone,
        getIconPresentation(themeId, "nav.settings.analysis").tone,
      ]);

      expect(tones.size).toBe(1);
    }
  });

  it("keeps workspace activity navigation icons aligned within each built-in theme", () => {
    for (const themeId of builtInThemes) {
      const tones = new Set([
        getIconPresentation(themeId, "nav.explorer").tone,
        getIconPresentation(themeId, "nav.search").tone,
        getIconPresentation(themeId, "nav.sourceControl").tone,
      ]);

      expect(tones.size).toBe(1);
    }
  });

  it("locks the approved base contract for semantic status icons", () => {
    for (const [semantic, expected] of semanticStatusExpectations) {
      expect(BASE_ICON_THEME.icons[semantic]).toEqual(expected);
    }
  });

  it("applies the approved seasonal icon hierarchy without retheming semantic status icons", () => {
    for (const themeId of ["spring-dark", "spring-light"] as const) {
      expect(getIconPresentation(themeId, "mobile.dock.agent")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "terminal.action.new")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "git.branch")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
    }
    expect(getIconPresentation("spring-light", "mobile.dock.files")).toEqual(
      expect.objectContaining({ tone: "secondary" })
    );
    expect(getIconPresentation("spring-light", "mobile.dock.terminal")).toEqual(
      expect.objectContaining({ tone: "secondary" })
    );
    expect(getIconPresentation("spring-dark", "mobile.dock.files")).toEqual(
      expect.objectContaining({ tone: "current" })
    );
    expect(getIconPresentation("spring-dark", "mobile.dock.terminal")).toEqual(
      expect.objectContaining({ tone: "current" })
    );

    for (const themeId of ["summer-dark", "summer-light"] as const) {
      expect(getIconPresentation(themeId, "mobile.dock.agent")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "terminal.action.new")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "git.branch")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
    }
    expect(getIconPresentation("summer-light", "mobile.dock.files")).toEqual(
      expect.objectContaining({ tone: "secondary" })
    );
    expect(getIconPresentation("summer-light", "mobile.dock.terminal")).toEqual(
      expect.objectContaining({ tone: "secondary" })
    );
    expect(getIconPresentation("summer-dark", "mobile.dock.files")).toEqual(
      expect.objectContaining({ tone: "secondary" })
    );
    expect(getIconPresentation("summer-dark", "mobile.dock.terminal")).toEqual(
      expect.objectContaining({ tone: "secondary" })
    );

    for (const themeId of ["autumn-dark", "autumn-light"] as const) {
      expect(getIconPresentation(themeId, "mobile.dock.agent")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "terminal.action.new")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(getIconPresentation(themeId, "git.branch")).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
    }
    expect(getIconPresentation("autumn-light", "mobile.dock.files")).toEqual(
      expect.objectContaining({ tone: "secondary" })
    );
    expect(getIconPresentation("autumn-light", "mobile.dock.terminal")).toEqual(
      expect.objectContaining({ tone: "secondary" })
    );
    expect(getIconPresentation("autumn-dark", "mobile.dock.files")).toEqual(
      expect.objectContaining({ tone: "current" })
    );
    expect(getIconPresentation("autumn-dark", "mobile.dock.terminal")).toEqual(
      expect.objectContaining({ tone: "current" })
    );

    for (const themeId of ["winter-dark", "winter-light"] as const) {
      expect(getIconPresentation(themeId, "mobile.dock.agent")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "mobile.dock.files")).toEqual(
        expect.objectContaining({ tone: "secondary" })
      );
      expect(getIconPresentation(themeId, "mobile.dock.terminal")).toEqual(
        expect.objectContaining({ tone: "secondary" })
      );
      expect(getIconPresentation(themeId, "terminal.action.new")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
      expect(getIconPresentation(themeId, "git.branch")).toEqual(
        expect.objectContaining({ tone: "info" })
      );
    }

    for (const themeId of seasonalThemes) {
      for (const [semantic, expected] of semanticStatusExpectations) {
        const seasonalPresentation = getIconPresentation(themeId, semantic);
        const basePresentation = BASE_ICON_THEME.icons[semantic];

        expect(seasonalPresentation).toEqual(
          expect.objectContaining({
            tone: expected.tone,
            surface: expected.surface,
            Icon: basePresentation.glyph,
            strokeWidth: basePresentation.strokeWidth,
          })
        );
      }
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
        expect.objectContaining({ tone: "info" })
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
        expect.objectContaining({ tone: "secondary" })
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
        expect.objectContaining({ tone: "secondary" })
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
        expect.objectContaining({ tone: "secondary" })
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
        expect.objectContaining({ tone: "info" })
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
        expect.objectContaining({ tone: "secondary" })
      );
      expect(getIconPresentation(themeId, "nav.settings.providers")).toEqual(
        expect.objectContaining({ tone: "secondary" })
      );
    }
  });
});
