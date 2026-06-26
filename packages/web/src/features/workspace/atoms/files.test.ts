import { describe, expect, it } from "vitest";
import {
  createWorkspaceBrowserEditorTab,
  deriveDocumentPreviewKind,
  deriveEditorModeForOpenFile,
  deriveEditorModeForPath,
  isDocumentPreviewPath,
  isPreviewByDefaultPath,
  normalizeWorkspaceEditorTabs,
} from "./files";

describe("workspace file preview classification", () => {
  it("classifies markdown and html files as document previews", () => {
    expect(isPreviewByDefaultPath("README.md")).toBe(true);
    expect(isPreviewByDefaultPath("docs/page.html")).toBe(true);
    expect(isDocumentPreviewPath("docs/page.html")).toBe(true);
    expect(deriveDocumentPreviewKind("README.md")).toBe("markdown");
    expect(deriveDocumentPreviewKind("docs/page.html")).toBe("html");
    expect(deriveEditorModeForPath("README.md")).toBe("preview");
    expect(
      deriveEditorModeForOpenFile({
        kind: "text",
        path: "README.md",
        content: "# Docs",
        savedContent: "# Docs",
        baseHash: "hash-1",
        isDirty: false,
      })
    ).toBe("preview");
  });
});

describe("workspace editor tabs", () => {
  it("keeps browser tabs typed instead of normalizing them into file paths", () => {
    expect(
      normalizeWorkspaceEditorTabs([
        { kind: "file", path: "src/app.tsx" },
        { kind: "browser", id: "dev-browser", url: null },
        { kind: "file", path: "src/app.tsx", pinned: false },
        { kind: "browser", id: "dev-browser", url: null },
        { kind: "file", path: "" },
        { kind: "browser", id: "   " },
      ])
    ).toEqual([
      { kind: "file", path: "src/app.tsx", pinned: true },
      {
        kind: "browser",
        id: "dev-browser",
        url: null,
        devicePreset: "desktop",
        viewportWidth: null,
        viewportHeight: null,
        orientation: "portrait",
        userAgentMode: "desktop",
      },
    ]);
  });

  it("preserves preview file tabs when they are already marked unpinned", () => {
    expect(
      normalizeWorkspaceEditorTabs([{ kind: "file", path: "src/preview.ts", pinned: false }])
    ).toEqual([{ kind: "file", path: "src/preview.ts", pinned: false }]);
  });

  it("keeps duplicate same-url browser tabs when ids differ", () => {
    expect(
      normalizeWorkspaceEditorTabs([
        { kind: "browser", id: "browser-1", url: "localhost:8000" },
        { kind: "browser", id: "browser-2", url: "localhost:8000" },
        { kind: "browser", id: "browser-1", url: "localhost:8000" },
      ])
    ).toEqual([
      {
        kind: "browser",
        id: "browser-1",
        url: "localhost:8000",
        devicePreset: "desktop",
        viewportWidth: null,
        viewportHeight: null,
        orientation: "portrait",
        userAgentMode: "desktop",
      },
      {
        kind: "browser",
        id: "browser-2",
        url: "localhost:8000",
        devicePreset: "desktop",
        viewportWidth: null,
        viewportHeight: null,
        orientation: "portrait",
        userAgentMode: "desktop",
      },
    ]);
  });

  it("normalizes browser tab urls to null when blank", () => {
    expect(
      normalizeWorkspaceEditorTabs([{ kind: "browser", id: "browser-1", url: "   " }])
    ).toEqual([
      {
        kind: "browser",
        id: "browser-1",
        url: null,
        devicePreset: "desktop",
        viewportWidth: null,
        viewportHeight: null,
        orientation: "portrait",
        userAgentMode: "desktop",
      },
    ]);
  });

  it("normalizes persisted browser device settings", () => {
    expect(
      normalizeWorkspaceEditorTabs([
        {
          kind: "browser",
          id: "browser-1",
          url: " localhost:8000 ",
          devicePreset: "iphone-14",
          viewportWidth: 390,
          viewportHeight: 844,
          orientation: "portrait",
          userAgentMode: "mobile",
        },
      ])
    ).toEqual([
      {
        kind: "browser",
        id: "browser-1",
        url: "localhost:8000",
        devicePreset: "iphone-14",
        viewportWidth: 390,
        viewportHeight: 844,
        orientation: "portrait",
        userAgentMode: "mobile",
      },
    ]);
  });

  it("deduplicates canvas tabs by sourcePath", () => {
    expect(
      normalizeWorkspaceEditorTabs([
        {
          kind: "canvas",
          id: "canvas:.coder-studio/canvases/runtime-flow.csc",
          title: "Runtime Flow",
          sourcePath: ".coder-studio/canvases/runtime-flow.csc",
        },
        {
          kind: "canvas",
          id: "canvas:legacy-id",
          title: "Runtime Flow",
          sourcePath: ".coder-studio/canvases/runtime-flow.csc",
          canvasId: "canvas-1",
        },
      ])
    ).toHaveLength(1);
  });

  it("creates browser editor tabs with normalized urls", () => {
    const tab = createWorkspaceBrowserEditorTab(" localhost:8000 ");

    expect(tab.kind).toBe("browser");
    expect(tab.url).toBe("localhost:8000");
    expect(tab.id).toMatch(/\S/);
  });

  it("creates browser tabs with default desktop device settings", () => {
    const tab = createWorkspaceBrowserEditorTab();

    expect(tab).toMatchObject({
      kind: "browser",
      url: null,
      devicePreset: "desktop",
      viewportWidth: null,
      viewportHeight: null,
      orientation: "portrait",
      userAgentMode: "desktop",
    });
    expect(tab.id).toMatch(/\S/);
  });
});
