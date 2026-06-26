import { describe, expect, it } from "vitest";
import {
  normalizeActiveEditorTab,
  normalizeWorkspaceEditorUiStatePatch,
} from "./open-editor-state";

describe("open editor state browser tab normalization", () => {
  it("normalizes legacy file editor tabs as pinned", () => {
    expect(
      normalizeWorkspaceEditorUiStatePatch({
        openEditorTabs: [{ kind: "file", path: "src/app.ts" }],
        activeEditorTab: { kind: "file", path: "src/app.ts" },
      })
    ).toEqual({
      openEditorTabs: [{ kind: "file", path: "src/app.ts", pinned: true }],
      activeEditorTab: { kind: "file", path: "src/app.ts", pinned: true },
    });
  });

  it("preserves preview file editor tabs", () => {
    expect(
      normalizeWorkspaceEditorUiStatePatch({
        openEditorTabs: [{ kind: "file", path: "src/preview.ts", pinned: false }],
        activeEditorTab: { kind: "file", path: "src/preview.ts", pinned: false },
      })
    ).toEqual({
      openEditorTabs: [{ kind: "file", path: "src/preview.ts", pinned: false }],
      activeEditorTab: { kind: "file", path: "src/preview.ts", pinned: false },
    });
  });

  it("does not add an active preview file to persistent open editor paths", () => {
    expect(
      normalizeWorkspaceEditorUiStatePatch({
        openEditorPaths: ["src/pinned.ts"],
        activeEditorPath: "src/preview.ts",
        openEditorTabs: [{ kind: "file", path: "src/preview.ts", pinned: false }],
        activeEditorTab: { kind: "file", path: "src/preview.ts", pinned: false },
      })
    ).toEqual({
      openEditorPaths: ["src/pinned.ts"],
      activeEditorPath: "src/preview.ts",
      openEditorTabs: [{ kind: "file", path: "src/preview.ts", pinned: false }],
      activeEditorTab: { kind: "file", path: "src/preview.ts", pinned: false },
    });
  });

  it("preserves device settings when migrating a legacy dev browser tab", () => {
    expect(
      normalizeWorkspaceEditorUiStatePatch({
        openEditorTabs: [
          {
            kind: "browser",
            id: "dev-browser",
            url: " http://localhost:3000 ",
            devicePreset: "iphone-14",
            viewportWidth: 390,
            viewportHeight: 844,
            orientation: "landscape",
            userAgentMode: "mobile",
          },
        ],
        activeEditorTab: {
          kind: "browser",
          id: "dev-browser",
          url: " http://localhost:3000 ",
          devicePreset: "iphone-14",
          viewportWidth: 390,
          viewportHeight: 844,
          orientation: "landscape",
          userAgentMode: "mobile",
        },
      })
    ).toEqual({
      openEditorTabs: [
        {
          kind: "browser",
          id: "dev-browser-legacy",
          url: "http://localhost:3000",
          devicePreset: "iphone-14",
          viewportWidth: 390,
          viewportHeight: 844,
          orientation: "landscape",
          userAgentMode: "mobile",
        },
      ],
      activeEditorTab: {
        kind: "browser",
        id: "dev-browser-legacy",
        url: "http://localhost:3000",
        devicePreset: "iphone-14",
        viewportWidth: 390,
        viewportHeight: 844,
        orientation: "landscape",
        userAgentMode: "mobile",
      },
    });
  });

  it("preserves device fields for a regular browser active tab", () => {
    expect(
      normalizeActiveEditorTab({
        kind: "browser",
        id: "browser-1",
        url: " http://localhost:3000 ",
        devicePreset: "custom",
        viewportWidth: 1200,
        viewportHeight: 800,
        orientation: "landscape",
        userAgentMode: "mobile",
      })
    ).toEqual({
      kind: "browser",
      id: "browser-1",
      url: "http://localhost:3000",
      devicePreset: "custom",
      viewportWidth: 1200,
      viewportHeight: 800,
      orientation: "landscape",
      userAgentMode: "mobile",
    });
  });

  it("preserves sourcePath-first canvas tabs and appends an active canvas tab when it is missing from open tabs", () => {
    expect(
      normalizeWorkspaceEditorUiStatePatch({
        openEditorTabs: [
          {
            kind: "canvas",
            id: "canvas:.coder-studio/canvases/report.csc",
            title: "Report",
            sourcePath: " .coder-studio/canvases/report.csc ",
          },
        ],
        activeEditorTab: {
          kind: "canvas",
          id: "canvas:.coder-studio/canvases/runtime-flow.csc",
          title: "Runtime Flow",
          artifactType: "architecture_canvas",
          sourcePath: " .coder-studio/canvases/runtime-flow.csc ",
        },
      })
    ).toEqual({
      openEditorTabs: [
        {
          kind: "canvas",
          id: "canvas:.coder-studio/canvases/report.csc",
          title: "Report",
          sourcePath: ".coder-studio/canvases/report.csc",
        },
        {
          kind: "canvas",
          id: "canvas:.coder-studio/canvases/runtime-flow.csc",
          title: "Runtime Flow",
          artifactType: "architecture_canvas",
          sourcePath: ".coder-studio/canvases/runtime-flow.csc",
        },
      ],
      activeEditorTab: {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/runtime-flow.csc",
        title: "Runtime Flow",
        artifactType: "architecture_canvas",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      },
    });
  });
});
