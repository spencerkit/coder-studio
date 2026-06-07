// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspacesAtom } from "../../../../atoms/workspaces";
import { WORKSPACE_PATH_DRAG_MIME } from "../../../../lib/workspace-path-drag";
import {
  activeEditorPaneIdAtomFamily,
  focusedEditorPaneIdAtomFamily,
} from "../../../agent-panes/atoms/editor-panes";
import { paneLayoutAtomFamily } from "../../../agent-panes/atoms/pane-layout";
import {
  __resetPendingEditorLoadsForTests,
  beginPendingEditorLoad,
} from "../../../code-editor/actions/pending-editor-loads";
import {
  activeFilePathAtomFamily,
  type OpenFile,
  type OpenTextFile,
  openEditorPathsAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";
import { OpenEditorsSection } from "./open-editors-section";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    if (key === "common.cancel") return "Cancel";
    if (key === "workspace.sidebar.open_editors") return "Open Files";
    if (key === "action.close") return "Close";
    if (key === "action.close_all") return "Close all";
    if (key === "code_editor.unsaved_changes") return "Unsaved changes";
    if (key === "code_editor.close_unsaved_title") return "Discard unsaved changes?";
    if (key === "code_editor.close_unsaved_description") {
      return `${params?.name ?? "File"} has unsaved changes.`;
    }
    if (key === "code_editor.discard_and_close") return "Discard and Close";
    if (key === "workspace.open_editors.close_all_unsaved_description") {
      return `${params?.count ?? 0} open files have unsaved changes.`;
    }
    if (key === "workspace.open_editors.title_with_count") {
      return `${params?.title ?? "Open Files"} (${params?.count ?? 0})`;
    }
    if (key === "workspace.open_editors.expand_label") return "Expand Open Files";
    if (key === "workspace.open_editors.collapse_label") return "Collapse Open Files";
    if (key === "workspace.open_editors.close_path") {
      return `Close ${params?.path ?? ""}`;
    }
    return key;
  },
}));

function createFile(path: string): OpenTextFile {
  return {
    kind: "text",
    path,
    content: "",
    savedContent: "",
    baseHash: `hash:${path}`,
    isDirty: false,
  };
}

function createDirtyFile(path: string): OpenTextFile {
  return {
    ...createFile(path),
    content: "changed",
    savedContent: "saved",
    isDirty: true,
  };
}

function createDragDataTransfer() {
  const values = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: "none",
    setData: vi.fn((type: string, value: string) => {
      values.set(type, value);
    }),
  } as unknown as DataTransfer;

  return { dataTransfer, values };
}

function renderSection(
  openFiles?: Record<string, OpenFile>,
  activePath?: string | null,
  seedStore?: (store: ReturnType<typeof createStore>) => void
) {
  const store = createStore();
  store.set(workspacesAtom, {
    "ws-test": {
      id: "ws-test",
      path: "/workspace",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
    },
  } as never);
  const files = openFiles ?? {
    "src/zeta.ts": createFile("src/zeta.ts"),
    "src/beta.ts": createFile("src/beta.ts"),
    "README.md": createFile("README.md"),
  };
  store.set(
    activeFilePathAtomFamily("ws-test"),
    activePath ?? (files["src/beta.ts"] ? "src/beta.ts" : (Object.keys(files)[0] ?? null))
  );
  store.set(openFilesAtomFamily("ws-test"), files);
  seedStore?.(store);

  render(
    <Provider store={store}>
      <OpenEditorsSection workspaceId="ws-test" />
    </Provider>
  );

  return { store };
}

describe("OpenEditorsSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetPendingEditorLoadsForTests();
  });

  it("shows file count, toggles collapse, closes a non-active row, and closes all", () => {
    const { store } = renderSection();

    const heading = screen.getByRole("heading", { level: 2, name: "Open Files (3)" });
    expect(heading).toHaveTextContent("Open Files");

    const section = heading.closest("section") as HTMLElement;
    expect(within(section).getByText("3")).toHaveClass("workspace-open-editors__count");
    const toggle = within(section).getByRole("button", { name: /collapse open files/i });

    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const rowButtonsBeforeCollapse = Array.from(
      section.querySelectorAll<HTMLButtonElement>(".workspace-open-editors__item")
    );
    expect(rowButtonsBeforeCollapse.map((button) => button.getAttribute("aria-label"))).toEqual([
      "README.md",
      "src/beta.ts",
      "src/zeta.ts",
    ]);
    expect(rowButtonsBeforeCollapse.map((button) => button.getAttribute("aria-current"))).toEqual([
      null,
      "true",
      null,
    ]);
    expect(rowButtonsBeforeCollapse.map((button) => button.getAttribute("title"))).toEqual([
      "README.md",
      "src/beta.ts",
      "src/zeta.ts",
    ]);

    fireEvent.click(toggle);
    expect(within(section).getByRole("button", { name: "Expand Open Files" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(
      within(section).queryByRole("button", {
        name: "README.md",
      })
    ).toBeNull();

    fireEvent.click(within(section).getByRole("button", { name: /expand open files/i }));

    const readmeRow = within(section)
      .getByRole("button", { name: "README.md" })
      .closest(".workspace-open-editors__row") as HTMLElement;
    fireEvent.click(within(readmeRow).getByRole("button", { name: "Close README.md" }));

    expect(Object.keys(store.get(openFilesAtomFamily("ws-test")))).toEqual([
      "src/zeta.ts",
      "src/beta.ts",
    ]);
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/beta.ts");

    const closeAllButton = within(section).getByRole("button", { name: "Close all" });
    expect(closeAllButton).toHaveTextContent(/^$/);
    expect(closeAllButton.querySelector("svg")).toBeTruthy();

    fireEvent.click(closeAllButton);

    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({});
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
  });

  it("keeps the header visible but hides the body when there are no open files", () => {
    renderSection({});

    const heading = screen.getByRole("heading", { level: 2, name: "Open Files (0)" });
    expect(heading).toHaveTextContent("Open Files");

    const section = heading.closest("section") as HTMLElement;
    expect(within(section).getByText("0")).toHaveClass("workspace-open-editors__count");
    const toggle = within(section).getByRole("button", { name: "Expand Open Files" });

    expect(toggle).toBeDisabled();
    expect(toggle).not.toHaveAttribute("aria-expanded");
    expect(toggle.querySelector("svg")).toHaveClass("lucide-chevron-right");
    expect(within(section).getByRole("button", { name: "Close all" })).toBeDisabled();
    expect(section.querySelector(".workspace-open-editors")).toBeNull();
    expect(section.querySelector(".workspace-open-editors__row")).toBeNull();
  });

  it("counts a pending-only active editor and keeps close all enabled", () => {
    beginPendingEditorLoad("ws-test", "src/pending.ts");

    renderSection({}, "src/pending.ts");

    const heading = screen.getByRole("heading", { level: 2, name: "Open Files (1)" });
    expect(heading).toHaveTextContent("Open Files");

    const section = heading.closest("section") as HTMLElement;
    expect(within(section).getByText("1")).toHaveClass("workspace-open-editors__count");

    expect(within(section).getByRole("button", { name: "Collapse Open Files" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(within(section).getByRole("button", { name: "Close all" })).toBeEnabled();
    expect(within(section).getByRole("button", { name: "src/pending.ts" })).toHaveClass(
      "workspace-open-editors__item--active"
    );
  });

  it("renders persisted editor paths when buffers have not loaded yet", () => {
    const { store } = renderSection({}, "src/app.tsx", (draftStore) => {
      draftStore.set(openEditorPathsAtomFamily("ws-test"), ["src/app.tsx", "README.md"]);
    });

    const heading = screen.getByRole("heading", { level: 2, name: "Open Files (2)" });
    const section = heading.closest("section") as HTMLElement;
    const rowButtons = Array.from(
      section.querySelectorAll<HTMLButtonElement>(".workspace-open-editors__item")
    );

    expect(rowButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "README.md",
      "src/app.tsx",
    ]);
    expect(within(section).getByRole("button", { name: "src/app.tsx" })).toHaveClass(
      "workspace-open-editors__item--active"
    );

    const readmeRow = within(section)
      .getByRole("button", { name: "README.md" })
      .closest(".workspace-open-editors__row") as HTMLElement;
    fireEvent.click(within(readmeRow).getByRole("button", { name: "Close README.md" }));

    expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual(["src/app.tsx"]);
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
  });

  it("opens open-editor clicks in the standalone editor when an editor pane is focused", () => {
    const { store } = renderSection(undefined, undefined, (draftStore) => {
      draftStore.set(paneLayoutAtomFamily("ws-test"), {
        id: "root",
        type: "leaf",
        leafKind: "editor",
      });
      draftStore.set(focusedEditorPaneIdAtomFamily("ws-test"), "root");
    });

    fireEvent.click(screen.getByRole("button", { name: "README.md" }));

    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBeNull();
    expect(store.get(focusedEditorPaneIdAtomFamily("ws-test"))).toBeNull();
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("README.md");
  });

  it("writes workspace drag data for open editor rows", () => {
    renderSection();

    const readmeButton = screen.getByRole("button", { name: "README.md" });
    expect(readmeButton).toHaveAttribute("draggable", "true");

    const { dataTransfer, values } = createDragDataTransfer();
    fireEvent.dragStart(readmeButton, { dataTransfer });

    expect(values.get(WORKSPACE_PATH_DRAG_MIME)).toBe(
      JSON.stringify({
        workspaceId: "ws-test",
        path: "README.md",
        kind: "file",
      })
    );
    expect(values.get("text/plain")).toBe("README.md");
  });

  it("marks dirty open files and confirms before closing a dirty row", () => {
    const { store } = renderSection(
      {
        "biome.jsonc": createDirtyFile("biome.jsonc"),
      },
      "biome.jsonc"
    );

    const row = screen
      .getByRole("button", { name: "biome.jsonc" })
      .closest(".workspace-open-editors__row") as HTMLElement;

    expect(row.querySelector(".workspace-open-editors__dirty-indicator")).toBeTruthy();

    fireEvent.click(within(row).getByRole("button", { name: "Close biome.jsonc" }));

    expect(store.get(openFilesAtomFamily("ws-test"))["biome.jsonc"]).toBeDefined();
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.get(openFilesAtomFamily("ws-test"))["biome.jsonc"]).toBeDefined();

    fireEvent.click(within(row).getByRole("button", { name: "Close biome.jsonc" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and Close" }));

    expect(store.get(openFilesAtomFamily("ws-test"))["biome.jsonc"]).toBeUndefined();
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
  });

  it("confirms before closing all when open files include dirty files", () => {
    const { store } = renderSection(
      {
        "src/clean.ts": createFile("src/clean.ts"),
        "src/dirty.ts": createDirtyFile("src/dirty.ts"),
      },
      "src/clean.ts"
    );

    fireEvent.click(screen.getByRole("button", { name: "Close all" }));

    expect(Object.keys(store.get(openFilesAtomFamily("ws-test")))).toEqual([
      "src/clean.ts",
      "src/dirty.ts",
    ]);
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    expect(screen.getByText("1 open files have unsaved changes.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard and Close" }));

    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({});
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
  });
});
