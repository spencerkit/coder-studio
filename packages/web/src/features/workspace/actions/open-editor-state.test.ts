import { describe, expect, it } from "vitest";
import {
  normalizeActiveEditorTab,
  normalizeWorkspaceEditorUiStatePatch,
} from "./open-editor-state";

describe("open editor state browser tab normalization", () => {
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
});
