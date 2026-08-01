// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { CodeEditorTabsHeader } from "./code-editor-tabs-header";

function wrapperFor(locale: "en" | "zh" = "en") {
  const store = createStore();
  store.set(localeAtom, locale);

  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("CodeEditorTabsHeader", () => {
  it("marks preview file tabs with a preview class", () => {
    render(
      <CodeEditorTabsHeader
        activeFilePath="src/preview.ts"
        activeFullPath="/workspace/src/preview.ts"
        activeEditorTab={{ kind: "file", path: "src/preview.ts", pinned: false }}
        openEditorTabs={[{ kind: "file", path: "src/preview.ts", pinned: false }]}
        openEditorPaths={[]}
        openFiles={{}}
        showPathRow={false}
        onActivateOpenFile={vi.fn()}
      />,
      {
        wrapper: wrapperFor(),
      }
    );

    expect(screen.getByRole("tab")).toHaveClass("code-editor-tab--preview");
  });

  it("opens a tab context menu with keep open for preview tabs", () => {
    const keepOpen = vi.fn();
    const { container } = render(
      <CodeEditorTabsHeader
        activeFilePath="src/preview.ts"
        activeFullPath="/workspace/src/preview.ts"
        activeEditorTab={{ kind: "file", path: "src/preview.ts", pinned: false }}
        openEditorTabs={[{ kind: "file", path: "src/preview.ts", pinned: false }]}
        openEditorPaths={[]}
        openFiles={{}}
        showPathRow={false}
        onActivateOpenFile={vi.fn()}
        onKeepOpenEditorTab={keepOpen}
      />,
      {
        wrapper: wrapperFor(),
      }
    );

    fireEvent.contextMenu(screen.getByRole("tab"));
    const menuLayer = document.body.querySelector(".file-context-menu-layer");

    expect(menuLayer).toBeInTheDocument();
    expect(menuLayer?.parentElement).toBe(document.body);
    expect(container.querySelector("header")?.contains(menuLayer as Node)).toBe(false);

    fireEvent.click(screen.getByRole("menuitem", { name: "Keep Open" }));

    expect(keepOpen).toHaveBeenCalledWith({
      kind: "file",
      path: "src/preview.ts",
      pinned: false,
    });
  });

  it("keeps a preview tab open when the tab is double-clicked", () => {
    const keepOpen = vi.fn();
    render(
      <CodeEditorTabsHeader
        activeFilePath="src/preview.ts"
        activeFullPath="/workspace/src/preview.ts"
        activeEditorTab={{ kind: "file", path: "src/preview.ts", pinned: false }}
        openEditorTabs={[{ kind: "file", path: "src/preview.ts", pinned: false }]}
        openEditorPaths={[]}
        openFiles={{}}
        showPathRow={false}
        onActivateOpenFile={vi.fn()}
        onKeepOpenEditorTab={keepOpen}
      />,
      {
        wrapper: wrapperFor(),
      }
    );

    fireEvent.doubleClick(screen.getByRole("tab"));

    expect(keepOpen).toHaveBeenCalledWith({
      kind: "file",
      path: "src/preview.ts",
      pinned: false,
    });
  });

  it("does not mislabel canvas tabs without an artifact type as report canvases", () => {
    render(
      <CodeEditorTabsHeader
        activeFilePath={null}
        activeFullPath=".coder-studio/canvases/auth-gate.csc"
        activeEditorTab={{
          kind: "canvas",
          id: "canvas:.coder-studio/canvases/auth-gate.csc",
          title: "auth-gate",
          sourcePath: ".coder-studio/canvases/auth-gate.csc",
          canvasId: ".coder-studio/canvases/auth-gate.csc",
        }}
        openEditorTabs={[
          {
            kind: "canvas",
            id: "canvas:.coder-studio/canvases/auth-gate.csc",
            title: "auth-gate",
            sourcePath: ".coder-studio/canvases/auth-gate.csc",
            canvasId: ".coder-studio/canvases/auth-gate.csc",
          },
        ]}
        openEditorPaths={[]}
        openFiles={{}}
        showPathRow={false}
        onActivateOpenFile={vi.fn()}
      />,
      {
        wrapper: wrapperFor(),
      }
    );

    const tab = screen.getByRole("tab", { selected: true });
    expect(within(tab).getByText("auth-gate")).toBeInTheDocument();
    expect(within(tab).queryByText("REPORT")).not.toBeInTheDocument();
  });

  it("keeps source-path-first canvas tabs distinct when canvasId is absent", () => {
    render(
      <CodeEditorTabsHeader
        activeFilePath={null}
        activeFullPath=".coder-studio/canvases/auth-gate.csc"
        activeEditorTab={{
          kind: "canvas",
          id: "canvas:.coder-studio/canvases/auth-gate.csc",
          title: "auth-gate",
          sourcePath: ".coder-studio/canvases/auth-gate.csc",
        }}
        openEditorTabs={[
          {
            kind: "canvas",
            id: "canvas:.coder-studio/canvases/auth-gate.csc",
            title: "auth-gate",
            sourcePath: ".coder-studio/canvases/auth-gate.csc",
          },
          {
            kind: "canvas",
            id: "canvas:.coder-studio/canvases/billing.csc",
            title: "billing",
            sourcePath: ".coder-studio/canvases/billing.csc",
          },
        ]}
        openEditorPaths={[]}
        openFiles={{}}
        showPathRow={false}
        onActivateOpenFile={vi.fn()}
      />,
      {
        wrapper: wrapperFor(),
      }
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(within(tabs[0]).getByText("auth-gate")).toBeInTheDocument();
    expect(within(tabs[1]).getByText("billing")).toBeInTheDocument();
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
  });
});
