// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspacesAtom } from "../../../../atoms/workspaces";
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
  openEditorPathsAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";
import { OpenEditorsSection } from "./open-editors-section";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    if (key === "workspace.sidebar.open_editors") return "Open Editors";
    if (key === "action.close") return "Close";
    if (key === "action.close_all") return "Close all";
    if (key === "workspace.open_editors.title_with_count") {
      return `${params?.title ?? "Open Editors"} (${params?.count ?? 0})`;
    }
    if (key === "workspace.open_editors.expand_label") return "Expand Open Editors";
    if (key === "workspace.open_editors.collapse_label") return "Collapse Open Editors";
    if (key === "workspace.open_editors.close_path") {
      return `Close ${params?.path ?? ""}`;
    }
    return key;
  },
}));

function createFile(path: string): OpenFile {
  return {
    kind: "text",
    path,
    content: "",
    savedContent: "",
    baseHash: `hash:${path}`,
    isDirty: false,
  };
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

    const heading = screen.getByRole("heading", { level: 2, name: "Open Editors (3)" });
    expect(heading).toHaveTextContent("Open Editors");

    const section = heading.closest("section") as HTMLElement;
    expect(within(section).getByText("3")).toHaveClass("workspace-open-editors__count");
    const toggle = within(section).getByRole("button", { name: /collapse open editors/i });

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
    expect(within(section).getByRole("button", { name: "Expand Open Editors" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(
      within(section).queryByRole("button", {
        name: "README.md",
      })
    ).toBeNull();

    fireEvent.click(within(section).getByRole("button", { name: /expand open editors/i }));

    const readmeRow = within(section)
      .getByRole("button", { name: "README.md" })
      .closest(".workspace-open-editors__row") as HTMLElement;
    fireEvent.click(within(readmeRow).getByRole("button", { name: "Close README.md" }));

    expect(Object.keys(store.get(openFilesAtomFamily("ws-test")))).toEqual([
      "src/zeta.ts",
      "src/beta.ts",
    ]);
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/beta.ts");

    fireEvent.click(within(section).getByRole("button", { name: "Close all" }));

    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({});
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
  });

  it("keeps the header visible but hides the body when there are no open editors", () => {
    renderSection({});

    const heading = screen.getByRole("heading", { level: 2, name: "Open Editors (0)" });
    expect(heading).toHaveTextContent("Open Editors");

    const section = heading.closest("section") as HTMLElement;
    expect(within(section).getByText("0")).toHaveClass("workspace-open-editors__count");
    const toggle = within(section).getByRole("button", { name: "Expand Open Editors" });

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

    const heading = screen.getByRole("heading", { level: 2, name: "Open Editors (1)" });
    expect(heading).toHaveTextContent("Open Editors");

    const section = heading.closest("section") as HTMLElement;
    expect(within(section).getByText("1")).toHaveClass("workspace-open-editors__count");

    expect(within(section).getByRole("button", { name: "Collapse Open Editors" })).toHaveAttribute(
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

    const heading = screen.getByRole("heading", { level: 2, name: "Open Editors (2)" });
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

  it("routes open-editor clicks into the focused editor pane", () => {
    const { store } = renderSection(undefined, undefined, (draftStore) => {
      draftStore.set(paneLayoutAtomFamily("ws-test"), {
        id: "root",
        type: "leaf",
        leafKind: "editor",
      });
      draftStore.set(focusedEditorPaneIdAtomFamily("ws-test"), "root");
    });

    fireEvent.click(screen.getByRole("button", { name: "README.md" }));

    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBe("root");
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("README.md");
  });
});
