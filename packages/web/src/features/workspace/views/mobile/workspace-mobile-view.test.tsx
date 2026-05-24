// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionStatusAtom, wsClientAtom } from "../../../../atoms/connection";
import { activeWorkspaceIdAtom } from "../../../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../../../test-utils/workspace-state";
import {
  activeFilePathAtomFamily,
  gitDiffPreviewAtomFamily,
  type OpenFile,
  openFilesAtomFamily,
} from "../../atoms";
import { OpenEditorsSection } from "../shared/open-editors-section";
import { WorkspaceMobileView } from "./workspace-mobile-view";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string>) => {
    const translations: Record<string, string> = {
      "action.back": "Back",
      "action.close": "Close",
      "action.create_session": "Create session",
      "action.save_file": "Save File",
      "code_editor.mode_diff": "Diff",
      "code_editor.mode_edit": "Edit",
      "code_editor.mode_preview": "Preview",
      "code_editor.edit_as_text": "Edit as text",
      "code_editor.preview_as_image": "Preview as image",
      "code_editor.saving": "Saving",
      "file.title": "File",
      "mobile.empty.files_terminal_hint": "Use files or terminal to get started.",
      "mobile.empty.start_session": "Start session",
      "mobile.files.editor_fallback": "Editor",
      "mobile.sheet.dismiss": "Dismiss sheet",
      "action.close_all": "Close all",
      "workspace.sidebar.explorer": "Explorer",
      "workspace.sidebar.open_editors": "Open Editors",
      "workspace.open_editors.collapse_label": "Collapse Open Editors",
      "workspace.open_editors.expand_label": "Expand Open Editors",
      "workspace.sidebar.search": "Search",
      "workspace.sidebar.source_control": "Source Control",
    };

    if (key === "mobile.sheet.region") {
      return `Sheet ${params?.title ?? ""}`.trim();
    }

    if (key === "workspace.open_editors.title_with_count") {
      return `${params?.title ?? "Open Editors"} (${params?.count ?? "0"})`;
    }

    if (key === "workspace.open_editors.close_path") {
      return `Close ${params?.path ?? ""}`.trim();
    }

    return translations[key] ?? key;
  },
}));

vi.mock("../../../agent-panes/views/shared/session-card", () => ({
  SessionCard: () => <div data-testid="session-card" />,
}));

vi.mock("../../../supervisor/views/mobile/mobile-supervisor-sheet", () => ({
  MobileSupervisorSheet: () => <div data-testid="mobile-supervisor-sheet" />,
}));

vi.mock("../../../terminal-panel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

vi.mock("../shared/workspace-launch-modal", () => ({
  WorkspaceLaunchModal: () => <div data-testid="workspace-launch-modal" />,
}));

vi.mock("../shared/workspace-status-bar", () => ({
  WorkspaceStatusBar: () => <div data-testid="workspace-status-bar" />,
}));

vi.mock("./hooks/use-mobile-layout-mode", () => ({
  useMobileLayoutMode: () => "compact",
}));

vi.mock("./hooks/use-mobile-motion-mode", () => ({
  useMobileMotionMode: () => "full",
}));

vi.mock("./hooks/use-visual-viewport-inset", () => ({
  useVisualViewportInset: () => 0,
}));

vi.mock("../../actions/use-workspace-fullscreen", () => ({
  useWorkspaceFullscreen: () => ({
    isSupported: false,
    isFullscreen: false,
    enter: vi.fn(),
    exit: vi.fn(),
    toggle: vi.fn(),
  }),
}));

vi.mock("../../actions/use-workspace-ui-state-persistence", () => ({
  useWorkspaceUiStatePersistence: () => ({
    persistUiState: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock("./mobile-agent-sheet", () => ({
  MobileAgentSheet: () => <div data-testid="mobile-agent-sheet" />,
}));

vi.mock("./mobile-dock", () => ({
  MobileDock: ({
    onSelectItem,
  }: {
    onSelectItem: (item: "agent" | "files" | "terminal") => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSelectItem("files")}>
        Files
      </button>
    </div>
  ),
}));

vi.mock("./mobile-files-sheet", () => ({
  MobileFilesSheet: ({
    workspaceId,
    route,
    onRouteChange,
  }: {
    workspaceId: string;
    route: { kind: "root" } | { kind: "detail"; path?: string; title?: string };
    onRouteChange?: (
      route: { kind: "root" } | { kind: "detail"; path?: string; title?: string }
    ) => void;
  }) =>
    route.kind === "root" ? (
      <div data-testid="mobile-files-sheet-root">
        <button
          type="button"
          onClick={() =>
            onRouteChange?.({
              kind: "detail",
              path: "src/a.ts",
              title: "a.ts",
            })
          }
        >
          Open a.ts
        </button>
        <button
          type="button"
          onClick={() =>
            onRouteChange?.({
              kind: "detail",
              path: "abc123",
              title: "abc123 · commit subject",
            })
          }
        >
          Open commit preview
        </button>
        <OpenEditorsSection workspaceId={workspaceId} />
      </div>
    ) : (
      <div data-testid="mobile-files-sheet-detail">{route.title ?? route.path}</div>
    ),
}));

vi.mock("./mobile-topbar", () => ({
  MobileTopBar: () => <div data-testid="mobile-topbar" />,
}));

vi.mock("./mobile-workspace-drawer", () => ({
  MobileWorkspaceDrawer: () => null,
}));

function createSendCommandMock() {
  return vi.fn().mockImplementation(async (op: string) => {
    if (op === "git.status") {
      return {
        branch: "main",
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        deleted: [],
        untracked: [],
      };
    }

    if (op === "session.list") {
      return [];
    }

    return null;
  });
}

function renderMobileView(options: {
  activePath: string | null;
  openFiles: Record<string, OpenFile>;
  diffPreview?: {
    path: string;
    title?: string;
    diff: string;
    source: "commit";
  } | null;
}) {
  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, { sendCommand: createSendCommandMock() } as never);
  seedReadyWorkspaceState(store, {
    "ws-test": {
      id: "ws-test",
      path: "/tmp/ws-test",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  });
  store.set(activeWorkspaceIdAtom, "ws-test");
  store.set(activeFilePathAtomFamily("ws-test"), options.activePath);
  store.set(openFilesAtomFamily("ws-test"), options.openFiles as never);
  if (options.diffPreview !== undefined) {
    store.set(gitDiffPreviewAtomFamily("ws-test"), options.diffPreview as never);
  }

  render(
    <Provider store={store}>
      <MemoryRouter>
        <WorkspaceMobileView />
      </MemoryRouter>
    </Provider>
  );

  return store;
}

describe("WorkspaceMobileView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes the mobile files sheet when the mobile header closes the current file", async () => {
    const store = renderMobileView({
      activePath: "src/a.ts",
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "alpha",
          savedContent: "alpha",
          baseHash: "hash-a",
          isDirty: false,
        },
        "src/b.ts": {
          kind: "text",
          path: "src/b.ts",
          content: "beta",
          savedContent: "beta",
          baseHash: "hash-b",
          isDirty: false,
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Open a.ts" }));

    expect(screen.getByRole("heading", { level: 2, name: "a.ts" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
      expect(screen.queryByTestId("mobile-files-sheet-root")).not.toBeInTheDocument();
      expect(screen.queryByTestId("mobile-files-sheet-detail")).not.toBeInTheDocument();
    });
  });

  it("closes the mobile files sheet when the mobile header closes the final open editor", async () => {
    const store = renderMobileView({
      activePath: "src/a.ts",
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "alpha",
          savedContent: "alpha",
          baseHash: "hash-a",
          isDirty: false,
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Open a.ts" }));

    expect(screen.getByRole("heading", { level: 2, name: "a.ts" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
      expect(screen.queryByTestId("mobile-files-sheet-root")).not.toBeInTheDocument();
      expect(screen.queryByTestId("mobile-files-sheet-detail")).not.toBeInTheDocument();
    });
  });

  it("keeps commit preview detail bound to the commit route and closes the preview without closing the background file", async () => {
    const store = renderMobileView({
      activePath: "src/a.ts",
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "alpha",
          savedContent: "alpha",
          baseHash: "hash-a",
          isDirty: false,
        },
      },
      diffPreview: {
        path: "abc123",
        title: "abc123 · commit subject",
        diff: "diff --git a/src/app.tsx b/src/app.tsx",
        source: "commit",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Open commit preview" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 2, name: "abc123 · commit subject" })
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Diff" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save File" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/a.ts");
      expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "a.ts" })).toBeInTheDocument();
    });
  });

  it("preserves an active commit preview when close all clears open editors", async () => {
    const diffPreview = {
      path: "abc123",
      title: "abc123 · commit subject",
      diff: "diff --git a/src/app.tsx b/src/app.tsx",
      source: "commit" as const,
    };
    const store = renderMobileView({
      activePath: "src/a.ts",
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "alpha",
          savedContent: "alpha",
          baseHash: "hash-a",
          isDirty: false,
        },
      },
      diffPreview,
    });

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Open commit preview" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 2, name: "abc123 · commit subject" })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    const openEditorsSection = screen
      .getByRole("heading", { level: 2, name: "Open Editors (1)" })
      .closest("section") as HTMLElement;
    fireEvent.click(within(openEditorsSection).getByRole("button", { name: "Close all" }));

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({});
      expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
      expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual(diffPreview);
    });
  });
});
