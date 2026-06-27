import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../atoms/app-ui";
import { wsClientAtom } from "../../atoms/connection";
import { activeWorkspaceIdAtom } from "../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../test-utils/workspace-state";
import { CommandResultError } from "../../ws/client";
import {
  editorPaneActiveFilePathAtomFamily,
  editorPaneModeAtomFamily,
  editorPaneOpenEditorPathsAtomFamily,
  editorPanePendingNavigationAtomFamily,
  getEditorPaneStateKey,
} from "../agent-panes/atoms/editor-panes";
import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  editorModeAtomFamily,
  editorRefreshTokenAtomFamily,
  editorViewVisibleAtomFamily,
  gitDiffPreviewAtomFamily,
  gitDiffPreviewDismissedAtomFamily,
  gitStateAtomFamily,
  type OpenFile,
  openEditorPathsAtomFamily,
  openEditorTabsAtomFamily,
  openFilesAtomFamily,
} from "../workspace/atoms";
import { OpenEditorsSection } from "../workspace/views/shared/open-editors-section";
import { useCodeEditorActions } from "./actions/use-code-editor-actions";
import { useOpenLocation } from "./actions/use-open-location";
import { CodeEditorHost } from "./views/shared/code-editor-host";

const viewportMocks = vi.hoisted(() => ({
  value: "desktop" as "desktop" | "mobile",
}));

const { mockRegistryUpdateFromDisk, mockRegistryDisposeFile } = vi.hoisted(() => ({
  mockRegistryUpdateFromDisk: vi.fn(),
  mockRegistryDisposeFile: vi.fn(),
}));

vi.mock("../../components/ui/_internal/use-viewport", () => ({
  useViewport: () => viewportMocks.value,
}));

vi.mock("./monaco/model-registry", () => ({
  monacoModelRegistry: {
    getOrCreate: vi.fn(),
    updateFromDisk: mockRegistryUpdateFromDisk,
    disposeFile: mockRegistryDisposeFile,
    disposeWorkspace: vi.fn(),
  },
}));

// Monaco is not happy in jsdom; stub it so we only assert our own chrome.
vi.mock("./components/monaco-host", () => ({
  MonacoHost: ({
    content,
    onContentChange,
  }: {
    content: string;
    onContentChange?: (value: string) => void;
  }) => (
    <div>
      <textarea
        aria-label="Editor content"
        onChange={(event) => onContentChange?.(event.target.value)}
        value={content}
      />
      <div data-testid="monaco-host">{content}</div>
    </div>
  ),
}));

vi.mock("./components/monaco-diff-host", () => ({
  MonacoDiffHost: ({
    originalContent,
    modifiedContent,
  }: {
    originalContent: string;
    modifiedContent: string;
  }) => (
    <div
      data-testid="monaco-diff-host"
      data-original={originalContent}
      data-modified={modifiedContent}
    />
  ),
}));

// ImagePreview mount would try to decode the <img>; in jsdom the load event
// never fires for data: URLs, so we stub it to assert routing only.
vi.mock("./components/image-preview", () => ({
  ImagePreview: ({ url, mime, version }: { url: string; mime: string; version: string }) => (
    <div data-testid="image-preview" data-url={url} data-mime={mime} data-version={version} />
  ),
}));

function setupStore(options?: {
  activePath?: string | null;
  openEditorPaths?: string[];
  openFiles?: Record<string, OpenFile>;
  sendCommand?: ReturnType<typeof vi.fn>;
}) {
  const store = createStore();
  const sendCommand =
    options?.sendCommand ??
    vi.fn().mockImplementation(async (op: string) => {
      if (op === "file.read") {
        return {
          kind: "text",
          content: "hello world",
          baseHash: "abc123",
          encoding: "utf-8",
        };
      }
      return null;
    });

  store.set(wsClientAtom, { sendCommand } as never);
  seedReadyWorkspaceState(store, {
    "ws-1": {
      id: "ws-1",
      path: "/tmp/ws",
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
  store.set(activeWorkspaceIdAtom, "ws-1");
  store.set(localeAtom, "en");

  if (options?.activePath !== undefined) {
    store.set(activeFilePathAtomFamily("ws-1"), options.activePath);
  }
  if (options?.openFiles) {
    store.set(openFilesAtomFamily("ws-1"), options.openFiles);
  }
  if (options?.openEditorPaths) {
    store.set(openEditorPathsAtomFamily("ws-1"), options.openEditorPaths);
  }

  return { store, sendCommand };
}

function expectCurrentFilePathTitle(path: string) {
  expect(screen.getByRole("navigation", { name: "Current file path" })).toHaveAttribute(
    "title",
    path
  );
}

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function pressSaveShortcut() {
  fireEvent.keyDown(window, {
    key: "s",
    code: "KeyS",
    ctrlKey: true,
  });
}

describe("CodeEditorHost", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockRegistryUpdateFromDisk.mockClear();
    mockRegistryDisposeFile.mockClear();
    viewportMocks.value = "desktop";
  });

  it("fetches file contents via file.read when activeFile has no cached buffer", async () => {
    const { store, sendCommand } = setupStore({ activePath: "src/a.ts" });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.read",
        {
          workspaceId: "ws-1",
          path: "src/a.ts",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("hello world");
    });
  });

  it("opens system agent instructions through the provider-specific read command", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "agentInstructions.system.read") {
        return {
          providerId: "codex",
          path: ".codex/AGENTS.md",
          displayPath: "~/.codex/AGENTS.md",
          exists: true,
          content: "# Codex\n",
          baseHash: "system-hash-1",
        };
      }

      if (op === "file.read") {
        throw new Error("system agent files must not use file.read");
      }

      return null;
    });
    const { store } = setupStore({ activePath: "agent-system:codex", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "agentInstructions.system.read",
        {
          workspaceId: "ws-1",
          providerId: "codex",
        },
        undefined
      );
    });

    expect(sendCommand.mock.calls.some(([op]) => op === "file.read")).toBe(false);
    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("# Codex");
    });
    expectCurrentFilePathTitle("~/.codex/AGENTS.md");
    expect(store.get(openFilesAtomFamily("ws-1"))["agent-system:codex"]).toMatchObject({
      kind: "text",
      path: "agent-system:codex",
      content: "# Codex\n",
      savedContent: "# Codex\n",
      baseHash: "system-hash-1",
      isDirty: false,
    });
    expect(mockRegistryUpdateFromDisk).not.toHaveBeenCalled();
  });

  it("opens skill files through the skill file read command", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "skills.files.read") {
        return {
          kind: "text",
          content: "# My Review Skill\n",
          baseHash: "skill-hash-1",
          encoding: "utf-8",
          displayPath: "/root/.agents/skills/my-review-skill/SKILL.md",
        };
      }

      if (op === "file.read") {
        throw new Error("skill files must not use file.read");
      }

      return null;
    });
    const { store } = setupStore({ activePath: "skill:my-review-skill/SKILL.md", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "skills.files.read",
        {
          workspaceId: "ws-1",
          skillSlug: "my-review-skill",
          path: "SKILL.md",
        },
        undefined
      );
    });

    expect(sendCommand.mock.calls.some(([op]) => op === "file.read")).toBe(false);
    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("# My Review Skill");
    });
    expectCurrentFilePathTitle("/root/.agents/skills/my-review-skill/SKILL.md");
    expect(store.get(openFilesAtomFamily("ws-1"))["skill:my-review-skill/SKILL.md"]).toMatchObject({
      kind: "text",
      path: "skill:my-review-skill/SKILL.md",
      displayPath: "/root/.agents/skills/my-review-skill/SKILL.md",
      content: "# My Review Skill\n",
      savedContent: "# My Review Skill\n",
      baseHash: "skill-hash-1",
      isDirty: false,
    });
    expect(mockRegistryUpdateFromDisk).not.toHaveBeenCalled();
  });

  it("saves system agent instructions through the provider-specific write command", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "agentInstructions.system.read") {
        return {
          providerId: "codex",
          path: ".codex/AGENTS.md",
          displayPath: "~/.codex/AGENTS.md",
          exists: true,
          content: "# Codex\n",
          baseHash: "system-hash-1",
        };
      }

      if (op === "agentInstructions.system.write") {
        return {
          providerId: "codex",
          path: ".codex/AGENTS.md",
          displayPath: "~/.codex/AGENTS.md",
          exists: true,
          content: "# Codex\n\n- Prefer focused answers.\n",
          baseHash: "system-hash-2",
        };
      }

      if (op === "file.write") {
        throw new Error("system agent files must not use file.write");
      }

      return null;
    });
    const { store } = setupStore({ activePath: "agent-system:codex", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    const editor = await screen.findByRole("textbox", { name: "Editor content" });
    fireEvent.change(editor, {
      target: { value: "# Codex\n\n- Prefer focused answers.\n" },
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["agent-system:codex"]).toMatchObject({
        isDirty: true,
      });
    });

    pressSaveShortcut();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "agentInstructions.system.write",
        {
          workspaceId: "ws-1",
          providerId: "codex",
          content: "# Codex\n\n- Prefer focused answers.\n",
          baseHash: "system-hash-1",
        },
        undefined
      );
    });

    expect(sendCommand.mock.calls.some(([op]) => op === "file.write")).toBe(false);
    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["agent-system:codex"]).toMatchObject({
        savedContent: "# Codex\n\n- Prefer focused answers.\n",
        baseHash: "system-hash-2",
        isDirty: false,
      });
    });
  });

  it("saves skill files through the skill file write command", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "skills.files.read") {
        return {
          kind: "text",
          content: "# My Review Skill\n",
          baseHash: "skill-hash-1",
          encoding: "utf-8",
          displayPath: "/root/.agents/skills/my-review-skill/SKILL.md",
        };
      }

      if (op === "skills.files.write") {
        return {
          newHash: "skill-hash-2",
        };
      }

      if (op === "file.write") {
        throw new Error("skill files must not use file.write");
      }

      return null;
    });
    const { store } = setupStore({ activePath: "skill:my-review-skill/SKILL.md", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    const editor = await screen.findByRole("textbox", { name: "Editor content" });
    fireEvent.change(editor, {
      target: { value: "# My Review Skill\n\n- Prefer focused answers.\n" },
    });

    await waitFor(() => {
      expect(
        store.get(openFilesAtomFamily("ws-1"))["skill:my-review-skill/SKILL.md"]
      ).toMatchObject({
        isDirty: true,
      });
    });

    pressSaveShortcut();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "skills.files.write",
        {
          workspaceId: "ws-1",
          skillSlug: "my-review-skill",
          path: "SKILL.md",
          content: "# My Review Skill\n\n- Prefer focused answers.\n",
          baseHash: "skill-hash-1",
        },
        undefined
      );
    });

    expect(sendCommand.mock.calls.some(([op]) => op === "file.write")).toBe(false);
    await waitFor(() => {
      expect(
        store.get(openFilesAtomFamily("ws-1"))["skill:my-review-skill/SKILL.md"]
      ).toMatchObject({
        savedContent: "# My Review Skill\n\n- Prefer focused answers.\n",
        baseHash: "skill-hash-2",
        displayPath: "/root/.agents/skills/my-review-skill/SKILL.md",
        isDirty: false,
      });
    });
  });

  it("keeps a seeded missing project agent draft in memory until save creates the file", async () => {
    const draftContent = "# Agent Instructions\n\n- Add project context here.\n";
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "file.read") {
        throw new Error("seeded missing project agent draft should not read from disk");
      }

      if (op === "file.write") {
        return {
          newHash: "draft-hash-1",
        };
      }

      return null;
    });
    const { store } = setupStore({
      activePath: ".coder-studio/agent.md",
      sendCommand,
      openFiles: {
        ".coder-studio/agent.md": {
          kind: "text",
          path: ".coder-studio/agent.md",
          content: draftContent,
          savedContent: "",
          baseHash: "",
          isDirty: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Editor content" });
    expect(editor).toHaveValue(draftContent);
    expect(sendCommand.mock.calls.some(([op]) => op === "file.read")).toBe(false);

    await act(async () => {
      pressSaveShortcut();
    });

    await waitFor(() => {
      const writeCall = sendCommand.mock.calls.find(([op]) => op === "file.write");
      expect(writeCall).toBeDefined();
      expect(writeCall?.[1]).toEqual({
        workspaceId: "ws-1",
        path: ".coder-studio/agent.md",
        content: draftContent,
        baseHash: undefined,
      });
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))[".coder-studio/agent.md"]).toMatchObject({
        savedContent: draftContent,
        baseHash: "draft-hash-1",
        isDirty: false,
      });
    });
  });

  it("keeps a seeded missing system agent draft in memory until save creates the file", async () => {
    const draftContent = "# Codex\n\n- Prefer focused answers.\n";
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "agentInstructions.system.read") {
        throw new Error("seeded missing system agent draft should not read from disk");
      }

      if (op === "agentInstructions.system.write") {
        return {
          providerId: "codex",
          path: ".codex/AGENTS.md",
          displayPath: "~/.codex/AGENTS.md",
          exists: true,
          content: draftContent,
          baseHash: "system-hash-created",
        };
      }

      if (op === "file.write") {
        throw new Error("system agent drafts must not use file.write");
      }

      return null;
    });
    const { store } = setupStore({
      activePath: "agent-system:codex",
      sendCommand,
      openFiles: {
        "agent-system:codex": {
          kind: "text",
          path: "agent-system:codex",
          displayPath: "~/.codex/AGENTS.md",
          content: draftContent,
          savedContent: "",
          baseHash: "",
          isDirty: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    const editor = await screen.findByRole("textbox", { name: "Editor content" });
    expect(editor).toHaveValue(draftContent);
    expectCurrentFilePathTitle("~/.codex/AGENTS.md");
    expect(sendCommand.mock.calls.some(([op]) => op === "agentInstructions.system.read")).toBe(
      false
    );

    await act(async () => {
      pressSaveShortcut();
    });

    await waitFor(() => {
      const writeCall = sendCommand.mock.calls.find(
        ([op]) => op === "agentInstructions.system.write"
      );
      expect(writeCall).toBeDefined();
      expect(writeCall?.[1]).toEqual({
        workspaceId: "ws-1",
        providerId: "codex",
        content: draftContent,
        baseHash: undefined,
      });
    });

    expect(sendCommand.mock.calls.some(([op]) => op === "file.write")).toBe(false);
    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["agent-system:codex"]).toMatchObject({
        savedContent: draftContent,
        baseHash: "system-hash-created",
        displayPath: "~/.codex/AGENTS.md",
        isDirty: false,
      });
    });
  });

  it("refreshes a clean system agent buffer through the virtual path and keeps the display path", async () => {
    let readCount = 0;
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "agentInstructions.system.read") {
        readCount += 1;
        return {
          providerId: "codex",
          path: ".codex/AGENTS.md",
          displayPath: "~/.codex/AGENTS.md",
          exists: true,
          content: readCount === 1 ? "# Codex\n" : "# Codex\n\nUpdated on disk\n",
          baseHash: readCount === 1 ? "system-hash-1" : "system-hash-2",
        };
      }

      if (op === "file.read") {
        throw new Error("system agent files must not use file.read");
      }

      return null;
    });
    const { store } = setupStore({ activePath: "agent-system:codex", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("# Codex");
    });

    act(() => {
      store.set(editorRefreshTokenAtomFamily("ws-1"), 1);
    });

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("Updated on disk");
    });
    expectCurrentFilePathTitle("~/.codex/AGENTS.md");
    expect(store.get(openFilesAtomFamily("ws-1"))["agent-system:codex"]).toMatchObject({
      path: "agent-system:codex",
      savedContent: "# Codex\n\nUpdated on disk\n",
      baseHash: "system-hash-2",
      isDirty: false,
    });
    expect(mockRegistryUpdateFromDisk).not.toHaveBeenCalled();
  });

  it("refreshes a clean skill buffer through the virtual path and keeps the display path", async () => {
    let readCount = 0;
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "skills.files.read") {
        readCount += 1;
        return {
          kind: "text",
          content:
            readCount === 1 ? "# My Review Skill\n" : "# My Review Skill\n\nUpdated on disk\n",
          baseHash: readCount === 1 ? "skill-hash-1" : "skill-hash-2",
          encoding: "utf-8",
          displayPath: "/root/.agents/skills/my-review-skill/SKILL.md",
        };
      }

      if (op === "file.read") {
        throw new Error("skill files must not use file.read");
      }

      return null;
    });
    const { store } = setupStore({ activePath: "skill:my-review-skill/SKILL.md", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("# My Review Skill");
    });

    act(() => {
      store.set(editorRefreshTokenAtomFamily("ws-1"), 1);
    });

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("Updated on disk");
    });
    expectCurrentFilePathTitle("/root/.agents/skills/my-review-skill/SKILL.md");
    expect(store.get(openFilesAtomFamily("ws-1"))["skill:my-review-skill/SKILL.md"]).toMatchObject({
      path: "skill:my-review-skill/SKILL.md",
      displayPath: "/root/.agents/skills/my-review-skill/SKILL.md",
      savedContent: "# My Review Skill\n\nUpdated on disk\n",
      baseHash: "skill-hash-2",
      isDirty: false,
    });
    expect(mockRegistryUpdateFromDisk).not.toHaveBeenCalled();
  });

  it("shows an error instead of staying in loading when file.read fails", async () => {
    const sendCommand = vi.fn().mockRejectedValue(new Error("File not found"));
    const { store } = setupStore({ activePath: "src/missing.ts", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("File not found");
    expect(document.querySelector(".git-diff-empty")).toBeTruthy();
    expect(screen.getByText("Failed to open file")).toHaveClass("git-diff-empty-title");
    expect(screen.queryByText(/connecting/i)).not.toBeInTheDocument();
  });

  it("hides the editor view from the header when file.read fails before a buffer opens", async () => {
    const sendCommand = vi.fn().mockRejectedValue(new Error("File not found"));
    const { store } = setupStore({ activePath: "src/missing.ts", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("File not found");
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/missing.ts");

    fireEvent.click(screen.getByRole("button", { name: "Close editor view" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    });
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toContain("src/missing.ts");
  });

  it("hides a pending editor view without dropping the open editor record", async () => {
    let resolveRead:
      | ((value: { kind: "text"; content: string; baseHash: string; encoding: "utf-8" }) => void)
      | null = null;
    const sendCommand = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        })
    );
    const { store } = setupStore({ activePath: "src/pending.ts", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.read",
        {
          workspaceId: "ws-1",
          path: "src/pending.ts",
        },
        undefined
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Close editor view" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    });
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toContain("src/pending.ts");

    await act(async () => {
      resolveRead?.({
        kind: "text",
        content: "late content",
        baseHash: "late-hash",
        encoding: "utf-8",
      });
    });

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
      expect(store.get(openFilesAtomFamily("ws-1"))["src/pending.ts"]).toBeUndefined();
      expect(store.get(openEditorPathsAtomFamily("ws-1"))).toContain("src/pending.ts");
    });
  });

  it("hides a loaded editor view while preserving open files and tab records", async () => {
    const openFiles: Record<string, OpenFile> = {
      "src/app.ts": {
        kind: "text",
        path: "src/app.ts",
        content: "changed",
        savedContent: "saved",
        baseHash: "hash-app",
        isDirty: true,
      },
    };
    const { store } = setupStore({
      activePath: "src/app.ts",
      openEditorPaths: ["src/app.ts", "src/other.ts"],
      openFiles,
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("changed");

    fireEvent.click(screen.getByRole("button", { name: "Close editor view" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    });
    expect(store.get(openFilesAtomFamily("ws-1"))).toEqual(openFiles);
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/app.ts", "src/other.ts"]);
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
  });

  it("reopens the same path with a fresh load after closing an older pending load", async () => {
    const firstRead = createDeferred<{
      kind: "text";
      content: string;
      baseHash: string;
      encoding: "utf-8";
    }>();
    const secondRead = createDeferred<{
      kind: "text";
      content: string;
      baseHash: string;
      encoding: "utf-8";
    }>();
    let fileReadCount = 0;
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "file.read") {
        fileReadCount += 1;
        return fileReadCount === 1 ? firstRead.promise : secondRead.promise;
      }

      return null;
    });
    const { store } = setupStore({ activePath: "src/foo.ts", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        1,
        "file.read",
        {
          workspaceId: "ws-1",
          path: "src/foo.ts",
        },
        undefined
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Close editor view" }));
    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    });

    act(() => {
      store.set(activeFilePathAtomFamily("ws-1"), "src/foo.ts");
    });

    await waitFor(() => {
      const fileReadCalls = sendCommand.mock.calls.filter(([op]) => op === "file.read");
      expect(fileReadCalls).toHaveLength(2);
      expect(fileReadCalls[1]).toEqual([
        "file.read",
        {
          workspaceId: "ws-1",
          path: "src/foo.ts",
        },
        undefined,
      ]);
    });

    await act(async () => {
      firstRead.resolve({
        kind: "text",
        content: "stale content",
        baseHash: "stale-hash",
        encoding: "utf-8",
      });
    });

    await act(async () => {
      secondRead.resolve({
        kind: "text",
        content: "fresh content",
        baseHash: "fresh-hash",
        encoding: "utf-8",
      });
    });

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/foo.ts");
      expect(store.get(openFilesAtomFamily("ws-1"))["src/foo.ts"]).toMatchObject({
        content: "fresh content",
        savedContent: "fresh content",
        baseHash: "fresh-hash",
      });
    });
  });

  it("ignores a late file.read success after close all clears a different open editor", async () => {
    const pendingRead = createDeferred<{
      kind: "text";
      content: string;
      baseHash: string;
      encoding: "utf-8";
    }>();
    const sendCommand = vi.fn().mockImplementation(() => pendingRead.promise);
    const { store } = setupStore({
      activePath: "src/pending.ts",
      openEditorPaths: ["src/open.ts"],
      openFiles: {
        "src/open.ts": {
          kind: "text",
          path: "src/open.ts",
          content: "already open",
          savedContent: "already open",
          baseHash: "open-hash",
          isDirty: false,
        },
      },
      sendCommand,
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
        <OpenEditorsSection workspaceId="ws-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.read",
        {
          workspaceId: "ws-1",
          path: "src/pending.ts",
        },
        undefined
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Close all" }));

    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    expect(store.get(openFilesAtomFamily("ws-1"))).toEqual({});

    await act(async () => {
      pendingRead.resolve({
        kind: "text",
        content: "late content",
        baseHash: "late-hash",
        encoding: "utf-8",
      });
    });

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
      expect(store.get(openFilesAtomFamily("ws-1"))).toEqual({});
    });
  });

  it("keeps pending-only active editors closable through shared close all and ignores the late load", async () => {
    const pendingRead = createDeferred<{
      kind: "text";
      content: string;
      baseHash: string;
      encoding: "utf-8";
    }>();
    const sendCommand = vi.fn().mockImplementation(() => pendingRead.promise);
    const { store } = setupStore({
      activePath: "src/pending-only.ts",
      openFiles: {},
      sendCommand,
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
        <OpenEditorsSection workspaceId="ws-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.read",
        {
          workspaceId: "ws-1",
          path: "src/pending-only.ts",
        },
        undefined
      );
    });

    const heading = screen.getByRole("heading", { level: 2, name: "Open Files (1)" });
    const section = heading.closest("section") as HTMLElement;
    const closeAll = within(section).getByRole("button", { name: "Close all" });
    expect(closeAll).toBeEnabled();

    fireEvent.click(closeAll);

    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    expect(store.get(openFilesAtomFamily("ws-1"))).toEqual({});

    await act(async () => {
      pendingRead.resolve({
        kind: "text",
        content: "late content",
        baseHash: "late-hash",
        encoding: "utf-8",
      });
    });

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
      expect(store.get(openFilesAtomFamily("ws-1"))).toEqual({});
    });
  });

  it("hiding a pending active file from the header keeps it inactive after the late load", async () => {
    const pendingRead = createDeferred<{
      kind: "text";
      content: string;
      baseHash: string;
      encoding: "utf-8";
    }>();
    const sendCommand = vi.fn().mockImplementation(() => pendingRead.promise);
    const { store } = setupStore({
      activePath: "src/b.ts",
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
      sendCommand,
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.read",
        {
          workspaceId: "ws-1",
          path: "src/b.ts",
        },
        undefined
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Close editor view" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    });
    expect(store.get(openFilesAtomFamily("ws-1"))).toMatchObject({
      "src/a.ts": expect.objectContaining({ content: "alpha" }),
    });
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toContain("src/b.ts");

    await act(async () => {
      pendingRead.resolve({
        kind: "text",
        content: "late content",
        baseHash: "late-hash",
        encoding: "utf-8",
      });
    });

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
      expect(store.get(openFilesAtomFamily("ws-1"))["src/b.ts"]).toBeUndefined();
      expect(store.get(openEditorPathsAtomFamily("ws-1"))).toContain("src/b.ts");
    });
  });

  it("closing a pending active file from the shared open editors list exits the editor", async () => {
    const pendingRead = createDeferred<{
      kind: "text";
      content: string;
      baseHash: string;
      encoding: "utf-8";
    }>();
    const sendCommand = vi.fn().mockImplementation(() => pendingRead.promise);
    const { store } = setupStore({
      activePath: "src/b.ts",
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
      sendCommand,
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
        <OpenEditorsSection workspaceId="ws-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.read",
        {
          workspaceId: "ws-1",
          path: "src/b.ts",
        },
        undefined
      );
    });

    const activeRow = screen
      .getByRole("button", { name: "src/b.ts" })
      .closest(".workspace-open-editors__row") as HTMLElement;
    fireEvent.click(within(activeRow).getByRole("button", { name: "Close src/b.ts" }));

    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();

    await act(async () => {
      pendingRead.resolve({
        kind: "text",
        content: "late content",
        baseHash: "late-hash",
        encoding: "utf-8",
      });
    });

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
      expect(store.get(openFilesAtomFamily("ws-1"))["src/b.ts"]).toBeUndefined();
    });
  });

  it("closing the active editor tab keeps the editor open and reactivates the previous file", async () => {
    const { store } = setupStore({
      activePath: "src/c.ts",
      openEditorPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
      openFiles: {
        "src/b.ts": {
          kind: "text",
          path: "src/b.ts",
          content: "beta",
          savedContent: "beta",
          baseHash: "hash-b",
          isDirty: false,
        },
        "src/c.ts": {
          kind: "text",
          path: "src/c.ts",
          content: "gamma",
          savedContent: "gamma",
          baseHash: "hash-c",
          isDirty: false,
        },
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

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("gamma");

    fireEvent.click(screen.getByRole("tab", { name: "b.ts" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/b.ts");
    });
    expect(screen.getByTestId("monaco-host")).toHaveTextContent("beta");

    fireEvent.click(screen.getByRole("button", { name: "Close file b.ts" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/c.ts");
    });
    expect(store.get(editorViewVisibleAtomFamily("ws-1"))).toBe(true);
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/a.ts", "src/c.ts"]);
    expect(store.get(openFilesAtomFamily("ws-1"))["src/b.ts"]).toBeUndefined();
    expect(screen.getByTestId("monaco-host")).toHaveTextContent("gamma");
    expect(screen.getByRole("button", { name: "Close editor view" })).toBeInTheDocument();
  });

  it("cancels an older pending load when switching to a different path so it cannot resurrect after the newer path closes", async () => {
    const firstRead = createDeferred<{
      kind: "text";
      content: string;
      baseHash: string;
      encoding: "utf-8";
    }>();
    const secondRead = createDeferred<{
      kind: "text";
      content: string;
      baseHash: string;
      encoding: "utf-8";
    }>();
    const sendCommand = vi
      .fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => secondRead.promise);
    const { store } = setupStore({ activePath: "src/a.ts", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        1,
        "file.read",
        {
          workspaceId: "ws-1",
          path: "src/a.ts",
        },
        undefined
      );
    });

    act(() => {
      store.set(activeFilePathAtomFamily("ws-1"), "src/b.ts");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        2,
        "file.read",
        {
          workspaceId: "ws-1",
          path: "src/b.ts",
        },
        undefined
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Close editor view" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    });
    expect(store.get(openFilesAtomFamily("ws-1"))).toEqual({});

    await act(async () => {
      firstRead.resolve({
        kind: "text",
        content: "late alpha",
        baseHash: "hash-a",
        encoding: "utf-8",
      });
    });

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
      expect(store.get(openFilesAtomFamily("ws-1"))).toEqual({});
    });
  });

  it("does not re-fetch a file that is already open", async () => {
    const { store, sendCommand } = setupStore({
      activePath: "src/b.ts",
      openFiles: {
        "src/b.ts": {
          kind: "text",
          path: "src/b.ts",
          content: "cached",
          savedContent: "cached",
          baseHash: "h",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("cached");
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("hiding the active editor from the header preserves open buffers and diff preview state", async () => {
    const { store } = setupStore({
      activePath: "src/c.ts",
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "alpha",
          savedContent: "alpha",
          baseHash: "a",
          isDirty: false,
        },
        "src/c.ts": {
          kind: "text",
          path: "src/c.ts",
          content: "content",
          savedContent: "content",
          baseHash: "h",
          isDirty: false,
        },
        "src/d.ts": {
          kind: "text",
          path: "src/d.ts",
          content: "delta",
          savedContent: "delta",
          baseHash: "d",
          isDirty: false,
        },
      },
    });
    store.set(editorModeAtomFamily("ws-1"), "diff");
    store.set(gitDiffPreviewAtomFamily("ws-1"), {
      kind: "worktree-file-diff",
      path: "src/unrelated.ts",
      diff: "diff --git a/src/unrelated.ts b/src/unrelated.ts",
      renderAs: "text",
      status: "modified",
      staged: false,
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/c.ts");

    const closeBtn = screen.getByRole("button", { name: "Close editor view" });
    expect(closeBtn).not.toHaveAttribute("title");

    fireEvent.mouseEnter(closeBtn);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Close editor view");

    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    });
    expect(store.get(openFilesAtomFamily("ws-1"))["src/c.ts"]).toBeDefined();
    expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
    expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toMatchObject({
      kind: "worktree-file-diff",
      path: "src/unrelated.ts",
    });
    expect(mockRegistryDisposeFile).not.toHaveBeenCalledWith("/tmp/ws", "src/c.ts");
  });

  it("hiding the final remaining file from the header keeps its open editor record", async () => {
    const { store } = setupStore({
      activePath: "src/final.ts",
      openFiles: {
        "src/final.ts": {
          kind: "text",
          path: "src/final.ts",
          content: "final",
          savedContent: "final",
          baseHash: "final-hash",
          isDirty: false,
        },
      },
    });
    store.set(editorModeAtomFamily("ws-1"), "diff");
    store.set(gitDiffPreviewAtomFamily("ws-1"), {
      kind: "worktree-file-diff",
      path: "src/final.ts",
      diff: "diff --git a/src/final.ts b/src/final.ts",
      renderAs: "text",
      status: "modified",
      staged: false,
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Close editor view" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    });
    expect(store.get(openFilesAtomFamily("ws-1"))["src/final.ts"]).toBeDefined();
    expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
    expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toMatchObject({
      kind: "worktree-file-diff",
      path: "src/final.ts",
    });
    expect(mockRegistryDisposeFile).not.toHaveBeenCalledWith("/tmp/ws", "src/final.ts");
  });

  it("can render without the editor header for mobile content-only chrome", async () => {
    const { store } = setupStore({
      activePath: "src/mobile.ts",
      openFiles: {
        "src/mobile.ts": {
          kind: "text",
          path: "src/mobile.ts",
          content: "content",
          savedContent: "content",
          baseHash: "h",
          isDirty: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost chrome="content-only" />
      </Provider>
    );

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("content");
    expect(screen.queryByText("src/mobile.ts")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save File" })).not.toBeInTheDocument();
  });

  it("renders ImagePreview when file.read returns an image descriptor", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "file.read") {
        return {
          kind: "image",
          mime: "image/png",
          url: "/api/file?workspaceId=ws-1&path=assets%2Flogo.png",
          size: 1234,
          isTextBacked: false,
          version: "1",
        };
      }
      return null;
    });

    const { store } = setupStore({ activePath: "assets/logo.png", sendCommand });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("image-preview")).toBeInTheDocument();
    });

    const preview = screen.getByTestId("image-preview");
    expect(preview.getAttribute("data-mime")).toBe("image/png");
    expect(preview.getAttribute("data-url")).toContain("/api/file?");
    expect(preview.getAttribute("data-version")).toBe("1");
    expect(screen.queryByTestId("monaco-host")).not.toBeInTheDocument();

    // Save button must be disabled for images (nothing to write back).
    expect(screen.queryByRole("button", { name: "Save File" })).not.toBeInTheDocument();
  });

  it("defaults text files into edit mode and shows the text editor", async () => {
    const { store } = setupStore({
      activePath: "src/app.ts",
      openFiles: {
        "src/app.ts": {
          kind: "text",
          path: "src/app.ts",
          content: "export const x = 1;",
          savedContent: "export const x = 1;",
          baseHash: "hash-text",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("export const x = 1;");
    expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
  });

  it("keeps text files in preview mode after the user switches from edit to preview", async () => {
    const { store } = setupStore({
      activePath: "src/preview.ts",
      openFiles: {
        "src/preview.ts": {
          kind: "text",
          path: "src/preview.ts",
          content: "export const preview = true;",
          savedContent: "export const preview = true;",
          baseHash: "preview-hash",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(store.get(editorModeAtomFamily("ws-1"))).toBe("preview");
    });
  });

  it("switches .csc files between source edit and canvas preview from the mode buttons", async () => {
    const { store } = setupStore({
      activePath: ".coder-studio/canvases/auth-gate.csc",
      openEditorPaths: [".coder-studio/canvases/auth-gate.csc"],
      openFiles: {
        ".coder-studio/canvases/auth-gate.csc": {
          kind: "text",
          path: ".coder-studio/canvases/auth-gate.csc",
          content: '{"kind":"architecture_canvas"}',
          savedContent: '{"kind":"architecture_canvas"}',
          baseHash: "canvas-hash",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("architecture_canvas");

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      const previewTab = screen.getByRole("tab", { selected: true });
      expect(previewTab).toHaveAttribute("title", ".coder-studio/canvases/auth-gate.csc");
      expect(within(previewTab).getByText("auth-gate")).toBeInTheDocument();
      expect(within(previewTab).getByText("ARCH")).toBeInTheDocument();
    });

    expect(store.get(editorModeAtomFamily("ws-1"))).toBe("preview");
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "canvas",
      id: "canvas:.coder-studio/canvases/auth-gate.csc",
      title: "auth-gate",
      sourcePath: ".coder-studio/canvases/auth-gate.csc",
      artifactType: "architecture_canvas",
      canvasId: ".coder-studio/canvases/auth-gate.csc",
    });
    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/auth-gate.csc",
        title: "auth-gate",
        sourcePath: ".coder-studio/canvases/auth-gate.csc",
        artifactType: "architecture_canvas",
        canvasId: ".coder-studio/canvases/auth-gate.csc",
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("architecture_canvas");
    });

    expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
      kind: "file",
      path: ".coder-studio/canvases/auth-gate.csc",
      pinned: true,
    });
  });

  it("switches pane-local .csc files between source edit and canvas preview from the mode buttons", async () => {
    const { store } = setupStore({
      activePath: null,
      openEditorPaths: [],
      openFiles: {
        ".coder-studio/canvases/auth-gate.csc": {
          kind: "text",
          path: ".coder-studio/canvases/auth-gate.csc",
          content: '{"kind":"architecture_canvas"}',
          savedContent: '{"kind":"architecture_canvas"}',
          baseHash: "canvas-hash",
          isDirty: false,
        },
      },
    });
    const paneStateKey = getEditorPaneStateKey("ws-1", "pane-1");
    store.set(
      editorPaneActiveFilePathAtomFamily(paneStateKey),
      ".coder-studio/canvases/auth-gate.csc"
    );
    store.set(editorPaneOpenEditorPathsAtomFamily(paneStateKey), [
      ".coder-studio/canvases/auth-gate.csc",
    ]);

    function PaneCodeEditorHost() {
      const editorState = useCodeEditorActions({
        activeFilePathAtom: editorPaneActiveFilePathAtomFamily(paneStateKey),
        editorModeAtom: editorPaneModeAtomFamily(paneStateKey),
        openEditorPathsAtom: editorPaneOpenEditorPathsAtomFamily(paneStateKey),
        pendingNavigationAtom: editorPanePendingNavigationAtomFamily(paneStateKey),
        persistEditorUiState: false,
      });

      return <CodeEditorHost editorState={editorState} />;
    }

    render(
      <Provider store={store}>
        <PaneCodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("architecture_canvas");

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      const previewTab = screen.getByRole("tab", { selected: true });
      expect(previewTab).toHaveAttribute("title", ".coder-studio/canvases/auth-gate.csc");
      expect(within(previewTab).getByText("auth-gate")).toBeInTheDocument();
      expect(within(previewTab).getByText("ARCH")).toBeInTheDocument();
    });

    expect(store.get(editorPaneModeAtomFamily(paneStateKey))).toBe("preview");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("architecture_canvas");
    });

    expect(store.get(editorPaneModeAtomFamily(paneStateKey))).toBe("edit");
  });

  it("defaults markdown files into preview mode after load", async () => {
    const { store } = setupStore({
      activePath: "README.md",
      openFiles: {
        "README.md": {
          kind: "text",
          path: "README.md",
          content: "# Docs",
          savedContent: "# Docs",
          baseHash: "markdown-hash",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(store.get(editorModeAtomFamily("ws-1"))).toBe("preview");
    });
  });

  it("defaults image files into preview mode and keeps text-backed images editable as text when requested", async () => {
    const { store } = setupStore({
      activePath: "assets/logo.svg",
      openFiles: {
        "assets/logo.svg": {
          kind: "image",
          path: "assets/logo.svg",
          mime: "image/svg+xml",
          url: "/api/file?workspaceId=ws-1&path=assets%2Flogo.svg",
          size: 42,
          version: "v1",
          isTextBacked: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId("image-preview")).toBeInTheDocument();
    expect(store.get(editorModeAtomFamily("ws-1"))).toBe("preview");
  });

  it("keeps a text-backed image in edit mode when it is opened as text", async () => {
    const { store } = setupStore({
      activePath: "assets/logo.svg",
      openFiles: {
        "assets/logo.svg": {
          kind: "text",
          path: "assets/logo.svg",
          content: "<svg />",
          savedContent: "<svg />",
          baseHash: "",
          isDirty: false,
          viewingTextBackedImageAsText: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("<svg />");
    expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
  });

  it("preserves diff preview as payload state while active file mode stays independent", async () => {
    const { store } = setupStore({
      activePath: "src/dirty.ts",
      openFiles: {
        "src/dirty.ts": {
          kind: "text",
          path: "src/dirty.ts",
          content: "changed",
          savedContent: "original",
          baseHash: "dirty-hash",
          isDirty: true,
        },
      },
    });
    store.set(gitDiffPreviewAtomFamily("ws-1"), {
      kind: "worktree-file-diff",
      path: "src/dirty.ts",
      diff: "diff --git a/src/dirty.ts b/src/dirty.ts",
      renderAs: "text",
      status: "modified",
      staged: false,
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
    expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toEqual({
      kind: "worktree-file-diff",
      path: "src/dirty.ts",
      diff: "diff --git a/src/dirty.ts b/src/dirty.ts",
      renderAs: "text",
      status: "modified",
      staged: false,
    });
  });

  it("keeps search replace diff previews as active diff state for the matching file", async () => {
    const { store } = setupStore({
      activePath: "src/dirty.ts",
      openFiles: {
        "src/dirty.ts": {
          kind: "text",
          path: "src/dirty.ts",
          content: "changed",
          savedContent: "original",
          baseHash: "dirty-hash",
          isDirty: false,
        },
      },
    });
    store.set(editorModeAtomFamily("ws-1"), "diff");
    store.set(gitDiffPreviewAtomFamily("ws-1"), {
      kind: "search-replace-file-diff",
      path: "src/dirty.ts",
      title: "src/dirty.ts",
      sessionId: "session-1",
      baseHash: "dirty-hash",
      originalContent: "original",
      modifiedContent: "changed",
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: wrapperFor(store),
    });

    expect(result.current.mode).toBe("diff");
    expect(result.current.activeDiffChange).toEqual({
      kind: "search-replace-file-diff",
      path: "src/dirty.ts",
      title: "src/dirty.ts",
      sessionId: "session-1",
      baseHash: "dirty-hash",
      originalContent: "original",
      modifiedContent: "changed",
    });
  });

  it("renders commit diff preview in the mobile content-only editor surface without an active file", () => {
    const { store } = setupStore();
    store.set(gitDiffPreviewAtomFamily("ws-1"), {
      kind: "commit-file-diff",
      path: "src/app.tsx",
      title: "src/app.tsx",
      diff: "diff --git a/src/app.tsx b/src/app.tsx",
      renderAs: "text",
      status: "modified",
      originalContent: "const app = 0;",
      modifiedContent: "const app = 1;",
      commit: {
        sha: "abc123",
        shortSha: "abc123",
        subject: "commit subject",
        authorName: "Spencer",
        authoredAt: 1,
      },
      file: {
        path: "src/app.tsx",
        status: "modified",
        renderAs: "text",
      },
      parentList: {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.tsx",
            status: "modified",
            renderAs: "text",
          },
        ],
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost chrome="content-only" />
      </Provider>
    );

    expect(screen.getByTestId("monaco-diff-host")).toHaveAttribute(
      "data-original",
      "const app = 0;"
    );
    expect(screen.getByTestId("monaco-diff-host")).toHaveAttribute(
      "data-modified",
      "const app = 1;"
    );
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("opens a normal file over an active commit-history preview", async () => {
    const { store } = setupStore({
      activePath: "src/background.ts",
      openFiles: {
        "src/background.ts": {
          kind: "text",
          path: "src/background.ts",
          content: "background",
          savedContent: "background",
          baseHash: "hash-bg",
          isDirty: false,
        },
        "src/target.ts": {
          kind: "text",
          path: "src/target.ts",
          content: "target content",
          savedContent: "target content",
          baseHash: "hash-target",
          isDirty: false,
        },
      },
    });
    store.set(gitDiffPreviewAtomFamily("ws-1"), {
      kind: "commit-file-diff",
      path: "src/app.tsx",
      title: "src/app.tsx",
      diff: "diff --git a/src/app.tsx b/src/app.tsx",
      renderAs: "text",
      status: "modified",
      originalContent: "const app = 0;",
      modifiedContent: "const app = 1;",
      commit: {
        sha: "abc123",
        shortSha: "abc123",
        subject: "commit subject",
        authorName: "Spencer",
        authoredAt: 1,
      },
      file: {
        path: "src/app.tsx",
        status: "modified",
        renderAs: "text",
      },
      parentList: {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.tsx",
            status: "modified",
            renderAs: "text",
          },
        ],
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId("monaco-diff-host")).toBeInTheDocument();

    const { result } = renderHook(() => useOpenLocation("ws-1"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.openLocation({
        workspaceId: "ws-1",
        path: "src/target.ts",
        source: "manual",
      });
    });

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/target.ts");
      expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toBeNull();
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("target content");
      expect(screen.queryByTestId("monaco-diff-host")).not.toBeInTheDocument();
    });
  });

  it("closing a commit file diff returns to its parent commit file list before restoring the background file", async () => {
    const { store } = setupStore({
      activePath: "src/background.ts",
      openFiles: {
        "src/background.ts": {
          kind: "text",
          path: "src/background.ts",
          content: "background",
          savedContent: "background",
          baseHash: "hash-bg",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("background");
    });

    act(() => {
      store.set(editorModeAtomFamily("ws-1"), "diff");
      store.set(gitDiffPreviewAtomFamily("ws-1"), {
        kind: "commit-file-diff",
        path: "src/app.tsx",
        title: "src/app.tsx",
        diff: "diff --git a/src/app.tsx b/src/app.tsx",
        renderAs: "text",
        status: "modified",
        originalContent: "const app = 0;",
        modifiedContent: "const app = 1;",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        file: {
          path: "src/app.tsx",
          status: "modified",
          renderAs: "text",
        },
        parentList: {
          kind: "commit-file-list",
          path: "abc123",
          title: "abc123 · commit subject",
          commit: {
            sha: "abc123",
            shortSha: "abc123",
            subject: "commit subject",
            authorName: "Spencer",
            authoredAt: 1,
          },
          files: [
            {
              path: "src/app.tsx",
              status: "modified",
              renderAs: "text",
            },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("monaco-diff-host")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toEqual({
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.tsx",
            status: "modified",
            renderAs: "text",
          },
        ],
      });
    });

    const sendCommand = (
      store.get(wsClientAtom) as unknown as {
        sendCommand: ReturnType<typeof vi.fn>;
      }
    ).sendCommand;
    expect(sendCommand).not.toHaveBeenCalledWith(
      "git.commitDetail",
      expect.objectContaining({
        workspaceId: "ws-1",
        sha: "abc123",
      }),
      undefined
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toBeNull();
      expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("background");
      expect(screen.queryByTestId("monaco-diff-host")).not.toBeInTheDocument();
    });
  });

  it("ignores a stale commit file diff response after the user switches to another commit list", async () => {
    const diffDeferred = createDeferred<{
      diff: string;
      renderAs: "text";
      status: "modified";
      originalContent: string;
      modifiedContent: string;
    }>();
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.commitFileDiff") {
        return diffDeferred.promise;
      }

      if (op === "file.read") {
        return {
          kind: "text",
          content: "hello world",
          baseHash: "abc123",
          encoding: "utf-8",
        };
      }

      return null;
    });
    const { store } = setupStore({ sendCommand });

    const parentListA = {
      kind: "commit-file-list" as const,
      path: "abc123",
      title: "abc123 · commit subject",
      commit: {
        sha: "abc123",
        shortSha: "abc123",
        subject: "commit subject",
        authorName: "Spencer",
        authoredAt: 1,
      },
      files: [
        {
          path: "src/app.tsx",
          status: "modified" as const,
          renderAs: "text" as const,
        },
      ],
    };
    const parentListB = {
      kind: "commit-file-list" as const,
      path: "def456",
      title: "def456 · other commit",
      commit: {
        sha: "def456",
        shortSha: "def456",
        subject: "other commit",
        authorName: "Spencer",
        authoredAt: 2,
      },
      files: [
        {
          path: "src/other.tsx",
          status: "modified" as const,
          renderAs: "text" as const,
        },
      ],
    };

    act(() => {
      store.set(gitDiffPreviewAtomFamily("ws-1"), parentListA);
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: wrapperFor(store),
    });

    const openPromise = result.current.openCommitFileDiff(parentListA.files[0]!);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.commitFileDiff",
        {
          workspaceId: "ws-1",
          sha: "abc123",
          path: "src/app.tsx",
        },
        undefined
      );
    });

    act(() => {
      store.set(gitDiffPreviewAtomFamily("ws-1"), parentListB);
    });

    let applied = true;
    await act(async () => {
      diffDeferred.resolve({
        diff: "diff --git a/src/app.tsx b/src/app.tsx",
        renderAs: "text",
        status: "modified",
        originalContent: "const app = 0;\n",
        modifiedContent: "const app = 1;\n",
      });
      applied = await openPromise;
    });

    expect(applied).toBe(false);
    expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toEqual(parentListB);
  });

  it("ignores a stale commit file diff response after the same commit list is reopened", async () => {
    const diffDeferred = createDeferred<{
      diff: string;
      renderAs: "text";
      status: "modified";
      originalContent: string;
      modifiedContent: string;
    }>();
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.commitFileDiff") {
        return diffDeferred.promise;
      }

      if (op === "file.read") {
        return {
          kind: "text",
          content: "hello world",
          baseHash: "abc123",
          encoding: "utf-8",
        };
      }

      return null;
    });
    const { store } = setupStore({ sendCommand });

    const parentListA = {
      kind: "commit-file-list" as const,
      path: "abc123",
      title: "abc123 · commit subject",
      commit: {
        sha: "abc123",
        shortSha: "abc123",
        subject: "commit subject",
        authorName: "Spencer",
        authoredAt: 1,
      },
      files: [
        {
          path: "src/app.tsx",
          status: "modified" as const,
          renderAs: "text" as const,
        },
      ],
    };
    const reopenedParentList = {
      ...parentListA,
      files: [...parentListA.files],
    };

    act(() => {
      store.set(gitDiffPreviewAtomFamily("ws-1"), parentListA);
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: wrapperFor(store),
    });

    const openPromise = result.current.openCommitFileDiff(parentListA.files[0]!);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.commitFileDiff",
        {
          workspaceId: "ws-1",
          sha: "abc123",
          path: "src/app.tsx",
        },
        undefined
      );
    });

    act(() => {
      store.set(gitDiffPreviewAtomFamily("ws-1"), null);
      store.set(gitDiffPreviewAtomFamily("ws-1"), reopenedParentList);
    });

    let applied = true;
    await act(async () => {
      diffDeferred.resolve({
        diff: "diff --git a/src/app.tsx b/src/app.tsx",
        renderAs: "text",
        status: "modified",
        originalContent: "const app = 0;\n",
        modifiedContent: "const app = 1;\n",
      });
      applied = await openPromise;
    });

    expect(applied).toBe(false);
    expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toEqual(reopenedParentList);
  });

  it("closing a commit-history preview restores the background file save error", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
      if (op === "file.write" && args?.path === "src/background.ts") {
        throw new Error("Save failed on background");
      }

      if (op === "file.read") {
        return {
          kind: "text",
          content: "hello world",
          baseHash: "abc123",
          encoding: "utf-8",
        };
      }

      return null;
    });
    const { store } = setupStore({
      activePath: "src/background.ts",
      sendCommand,
      openFiles: {
        "src/background.ts": {
          kind: "text",
          path: "src/background.ts",
          content: "changed background",
          savedContent: "saved background",
          baseHash: "hash-bg",
          isDirty: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    pressSaveShortcut();

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed on background");

    act(() => {
      store.set(gitDiffPreviewAtomFamily("ws-1"), {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.tsx",
            status: "modified",
            renderAs: "text",
          },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("commit-file-list-preview")).toBeInTheDocument();
      expect(screen.queryByText("Save failed on background")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toBeNull();
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("changed background");
      expect(screen.getByRole("alert")).toHaveTextContent("Save failed on background");
    });
  });

  it("openLocation normalizes editor mode when exiting a commit file list preview over a file-diff background", async () => {
    const { store } = setupStore({
      activePath: "src/background.ts",
      openFiles: {
        "src/background.ts": {
          kind: "text",
          path: "src/background.ts",
          content: "background",
          savedContent: "background",
          baseHash: "hash-bg",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("background");
    });

    act(() => {
      store.set(editorModeAtomFamily("ws-1"), "diff");
      store.set(gitDiffPreviewAtomFamily("ws-1"), {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.tsx",
            status: "modified",
            renderAs: "text",
          },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("commit-file-list-preview")).toBeInTheDocument();
      expect(store.get(editorModeAtomFamily("ws-1"))).toBe("diff");
    });

    const { result } = renderHook(() => useOpenLocation("ws-1"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.openLocation({
        workspaceId: "ws-1",
        path: "src/background.ts",
        source: "manual",
      });
    });

    await waitFor(() => {
      expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toBeNull();
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/background.ts");
      expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("background");
      expect(screen.queryByTestId("commit-file-list-preview")).not.toBeInTheDocument();
    });
  });

  it("shows the commit file list preview while a background save error remains hidden", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
      if (op === "file.write" && args?.path === "src/background.ts") {
        throw new Error("Save failed on background");
      }

      if (op === "file.read") {
        return {
          kind: "text",
          content: "hello world",
          baseHash: "abc123",
          encoding: "utf-8",
        };
      }

      return null;
    });
    const { store } = setupStore({
      activePath: "src/background.ts",
      sendCommand,
      openFiles: {
        "src/background.ts": {
          kind: "text",
          path: "src/background.ts",
          content: "changed background",
          savedContent: "saved background",
          baseHash: "hash-bg",
          isDirty: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    pressSaveShortcut();

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed on background");

    act(() => {
      store.set(gitDiffPreviewAtomFamily("ws-1"), {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.tsx",
            status: "modified",
            renderAs: "text",
          },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("commit-file-list-preview")).toBeInTheDocument();
      expect(screen.queryByText("Save failed on background")).not.toBeInTheDocument();
    });
  });

  it("openLocation normalizes editor mode when exiting a commit-history preview over a file-diff background", async () => {
    const { store } = setupStore({
      activePath: "src/background.ts",
      openFiles: {
        "src/background.ts": {
          kind: "text",
          path: "src/background.ts",
          content: "background",
          savedContent: "background",
          baseHash: "hash-bg",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("background");
    });

    act(() => {
      store.set(editorModeAtomFamily("ws-1"), "diff");
      store.set(gitDiffPreviewAtomFamily("ws-1"), {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.tsx",
            status: "modified",
            renderAs: "text",
          },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("commit-file-list-preview")).toBeInTheDocument();
      expect(store.get(editorModeAtomFamily("ws-1"))).toBe("diff");
    });

    const { result } = renderHook(() => useOpenLocation("ws-1"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.openLocation({
        workspaceId: "ws-1",
        path: "src/background.ts",
        source: "manual",
      });
    });

    await waitFor(() => {
      expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toBeNull();
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/background.ts");
      expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("background");
      expect(screen.queryByTestId("commit-file-list-preview")).not.toBeInTheDocument();
    });
  });

  it("derives diff enablement from git status for the active file", () => {
    const { store } = setupStore({
      activePath: "src/app.ts",
      openFiles: {
        "src/app.ts": {
          kind: "text",
          path: "src/app.ts",
          content: "export const app = 1;",
          savedContent: "export const app = 1;",
          baseHash: "hash-app",
          isDirty: false,
        },
      },
    });
    store.set(gitStateAtomFamily("ws-1"), {
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [{ path: "src/app.ts", status: "modified" }],
      deleted: [],
      untracked: [],
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: wrapperFor(store),
    });

    expect(result.current.canDiff).toBe(true);
    expect(result.current.activeDiffChange).toBeNull();
  });

  it("keeps diff enablement when the active file already has a worktree diff preview", () => {
    const { store } = setupStore({
      activePath: "src/app.ts",
      openFiles: {
        "src/app.ts": {
          kind: "text",
          path: "src/app.ts",
          content: "export const app = 1;",
          savedContent: "export const app = 1;",
          baseHash: "hash-app",
          isDirty: false,
        },
      },
    });
    store.set(gitDiffPreviewAtomFamily("ws-1"), {
      kind: "worktree-file-diff",
      path: "src/app.ts",
      diff: "diff --git a/src/app.ts b/src/app.ts",
      staged: false,
      renderAs: "text",
      status: "modified",
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: wrapperFor(store),
    });

    expect(result.current.canDiff).toBe(true);
    expect(result.current.activeDiffChange).toMatchObject({
      kind: "worktree-file-diff",
      path: "src/app.ts",
    });
  });

  it("derives diff enablement from git rename old paths for the active file", () => {
    const { store } = setupStore({
      activePath: "src/old-name.ts",
      openFiles: {
        "src/old-name.ts": {
          kind: "text",
          path: "src/old-name.ts",
          content: "export const app = 1;",
          savedContent: "export const app = 1;",
          baseHash: "hash-app",
          isDirty: false,
        },
      },
    });
    store.set(gitStateAtomFamily("ws-1"), {
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [{ path: "src/new-name.ts", oldPath: "src/old-name.ts", status: "renamed" }],
      modified: [],
      deleted: [],
      untracked: [],
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: wrapperFor(store),
    });

    expect(result.current.canDiff).toBe(true);
  });

  it("shows the unsaved diff warning only when the active file is dirty in diff mode", () => {
    const { store } = setupStore({
      activePath: "src/app.ts",
      openFiles: {
        "src/app.ts": {
          kind: "text",
          path: "src/app.ts",
          content: "changed",
          savedContent: "original",
          baseHash: "hash-app",
          isDirty: true,
        },
      },
    });
    store.set(editorModeAtomFamily("ws-1"), "diff");
    store.set(gitStateAtomFamily("ws-1"), {
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [{ path: "src/app.ts", status: "modified" }],
      deleted: [],
      untracked: [],
    });
    store.set(gitDiffPreviewAtomFamily("ws-1"), {
      kind: "worktree-file-diff",
      path: "src/app.ts",
      diff: "diff --git a/src/app.ts b/src/app.ts",
      renderAs: "text",
      status: "modified",
      staged: false,
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: wrapperFor(store),
    });

    expect(result.current.hasUnsavedChangesOutsideDiff).toBe(true);
  });

  it("hides the active diff editor without dismissing the diff preview", async () => {
    const { store } = setupStore({
      activePath: "src/app.ts",
      openFiles: {
        "src/app.ts": {
          kind: "text",
          path: "src/app.ts",
          content: "export const app = 2;",
          savedContent: "export const app = 1;",
          baseHash: "hash-app",
          isDirty: true,
        },
      },
    });
    store.set(editorModeAtomFamily("ws-1"), "diff");
    store.set(gitStateAtomFamily("ws-1"), {
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [{ path: "src/app.ts", status: "modified" }],
      deleted: [],
      untracked: [],
    });
    store.set(gitDiffPreviewAtomFamily("ws-1"), {
      kind: "worktree-file-diff",
      path: "src/app.ts",
      diff: "diff --git a/src/app.ts b/src/app.ts",
      staged: false,
      renderAs: "text",
      status: "modified",
      originalContent: "export const app = 1;",
      modifiedContent: "export const app = 2;",
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("monaco-diff-host")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close editor view" }));
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    });
    expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toMatchObject({
      kind: "worktree-file-diff",
      path: "src/app.ts",
    });
    expect(store.get(gitDiffPreviewDismissedAtomFamily("ws-1"))).toBe(false);
  });

  it("omits the desktop save button for a text buffer", async () => {
    const { store } = setupStore({
      activePath: "src/save.ts",
      openFiles: {
        "src/save.ts": {
          kind: "text",
          path: "src/save.ts",
          content: "content",
          savedContent: "content",
          baseHash: "h",
          isDirty: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: "Save File" })).not.toBeInTheDocument();
  });

  it("clears dirty state when text returns to the last saved content", async () => {
    const { store } = setupStore({ activePath: "src/revert.ts" });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("hello world");
    });

    const editor = screen.getByRole("textbox", { name: "Editor content" });

    fireEvent.change(editor, {
      target: { value: "hello world with edits" },
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["src/revert.ts"]).toMatchObject({
        content: "hello world with edits",
        isDirty: true,
      });
    });

    fireEvent.change(editor, {
      target: { value: "hello world" },
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["src/revert.ts"]).toMatchObject({
        content: "hello world",
        isDirty: false,
      });
    });

    expect(screen.queryByRole("button", { name: "Save File" })).not.toBeInTheDocument();
  });

  it("reloads a clean text buffer after an external refresh signal changes the file on disk", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "text",
        content: "original",
        baseHash: "hash-1",
        encoding: "utf-8",
      })
      .mockResolvedValueOnce({
        kind: "text",
        content: "updated on disk",
        baseHash: "hash-2",
        encoding: "utf-8",
      });

    const { store } = setupStore({
      activePath: "src/live.ts",
      sendCommand,
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("original");
    });

    act(() => {
      store.set(editorRefreshTokenAtomFamily("ws-1"), 1);
    });

    await waitFor(() => {
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("updated on disk");
    });
    expect(mockRegistryUpdateFromDisk).toHaveBeenCalledWith({
      workspaceRootPath: "/tmp/ws",
      path: "src/live.ts",
      content: "updated on disk",
    });
    expect(screen.queryByText(/changed on disk/i)).not.toBeInTheDocument();
  });

  it("clears a stale save error after closing the failed file and switches to the previous open file", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
      if (op === "file.write" && args?.path === "src/a.ts") {
        throw new Error("Save failed on A");
      }

      if (op === "file.read") {
        return {
          kind: "text",
          content: "hello world",
          baseHash: "abc123",
          encoding: "utf-8",
        };
      }

      return null;
    });
    const { store } = setupStore({
      activePath: "src/a.ts",
      openEditorPaths: ["src/a.ts", "src/b.ts"],
      sendCommand,
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "changed a",
          savedContent: "saved a",
          baseHash: "hash-a",
          isDirty: true,
        },
        "src/b.ts": {
          kind: "text",
          path: "src/b.ts",
          content: "saved b",
          savedContent: "saved b",
          baseHash: "hash-b",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
        <OpenEditorsSection workspaceId="ws-1" />
      </Provider>
    );

    pressSaveShortcut();

    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed on A");

    const activeRow = screen
      .getByRole("button", { name: "src/a.ts" })
      .closest(".workspace-open-editors__row") as HTMLElement;
    fireEvent.click(within(activeRow).getByRole("button", { name: "Close src/a.ts" }));
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard and Close" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/b.ts");
    });

    expect(screen.queryByText("Save failed on A")).not.toBeInTheDocument();
    expect(screen.getByTestId("monaco-host")).toHaveTextContent("saved b");
  });

  it("keeps save state scoped to the active file when switching during an in-flight save", async () => {
    const saveADeferred = createDeferred<{ newHash: string }>();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
      if (op === "file.write" && args?.path === "src/a.ts") {
        return saveADeferred.promise;
      }

      if (op === "file.write" && args?.path === "src/b.ts") {
        return { newHash: "hash-b-2" };
      }

      if (op === "file.read") {
        return {
          kind: "text",
          content: "hello world",
          baseHash: "abc123",
          encoding: "utf-8",
        };
      }

      return null;
    });
    const { store } = setupStore({
      activePath: "src/a.ts",
      openEditorPaths: ["src/a.ts", "src/b.ts"],
      sendCommand,
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "changed a",
          savedContent: "saved a",
          baseHash: "hash-a",
          isDirty: true,
        },
        "src/b.ts": {
          kind: "text",
          path: "src/b.ts",
          content: "changed b",
          savedContent: "saved b",
          baseHash: "hash-b",
          isDirty: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
        <OpenEditorsSection workspaceId="ws-1" />
      </Provider>
    );

    pressSaveShortcut();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.write",
        {
          workspaceId: "ws-1",
          path: "src/a.ts",
          content: "changed a",
          baseHash: "hash-a",
        },
        undefined
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "src/b.ts" }));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/b.ts");
    });

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("changed b");
    expect(screen.queryByRole("button", { name: "Saving" })).not.toBeInTheDocument();

    pressSaveShortcut();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.write",
        {
          workspaceId: "ws-1",
          path: "src/b.ts",
          content: "changed b",
          baseHash: "hash-b",
        },
        undefined
      );
    });

    await act(async () => {
      saveADeferred.resolve({ newHash: "hash-a-2" });
    });
  });

  it("deduplicates repeated save shortcut dispatches while a save is in flight", async () => {
    const saveDeferred = createDeferred<{ newHash: string }>();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
      if (op === "file.write" && args?.path === "src/a.ts") {
        return saveDeferred.promise;
      }

      if (op === "file.read") {
        return {
          kind: "text",
          content: "hello world",
          baseHash: "abc123",
          encoding: "utf-8",
        };
      }

      return null;
    });
    const { store } = setupStore({
      activePath: "src/a.ts",
      sendCommand,
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "changed a",
          savedContent: "saved a",
          baseHash: "hash-a",
          isDirty: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    pressSaveShortcut();
    pressSaveShortcut();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.write",
        {
          workspaceId: "ws-1",
          path: "src/a.ts",
          content: "changed a",
          baseHash: "hash-a",
        },
        undefined
      );
    });
    expect(sendCommand.mock.calls.filter(([op]) => op === "file.write")).toHaveLength(1);

    await act(async () => {
      saveDeferred.resolve({ newHash: "hash-a-2" });
    });
  });

  it("deduplicates overlapping save requests before saving state rerenders", async () => {
    const saveDeferred = createDeferred<{ newHash: string }>();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
      if (op === "file.write" && args?.path === "src/a.ts") {
        return saveDeferred.promise;
      }

      if (op === "file.read") {
        return {
          kind: "text",
          content: "hello world",
          baseHash: "abc123",
          encoding: "utf-8",
        };
      }

      return null;
    });
    const { store } = setupStore({
      activePath: "src/a.ts",
      sendCommand,
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "changed a",
          savedContent: "saved a",
          baseHash: "hash-a",
          isDirty: true,
        },
      },
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: wrapperFor(store),
    });

    void result.current.handleSave();
    void result.current.handleSave();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.write",
        {
          workspaceId: "ws-1",
          path: "src/a.ts",
          content: "changed a",
          baseHash: "hash-a",
        },
        undefined
      );
    });
    expect(sendCommand.mock.calls.filter(([op]) => op === "file.write")).toHaveLength(1);

    await act(async () => {
      saveDeferred.resolve({ newHash: "hash-a-2" });
    });
  });

  it("ignores a stale save success after close all preserves commit preview and the file is reopened", async () => {
    const staleSave = createDeferred<{ newHash: string }>();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
      if (op === "file.write" && args?.path === "src/a.ts") {
        return staleSave.promise;
      }

      if (op === "file.read" && args?.path === "src/a.ts") {
        return {
          kind: "text",
          content: "reopened content",
          baseHash: "reopen-hash",
          encoding: "utf-8",
        };
      }

      return null;
    });
    const { store } = setupStore({
      activePath: "src/a.ts",
      sendCommand,
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "changed a",
          savedContent: "saved a",
          baseHash: "hash-a",
          isDirty: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
        <OpenEditorsSection workspaceId="ws-1" />
      </Provider>
    );

    const { result } = renderHook(() => useOpenLocation("ws-1"), {
      wrapper: wrapperFor(store),
    });

    pressSaveShortcut();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.write",
        {
          workspaceId: "ws-1",
          path: "src/a.ts",
          content: "changed a",
          baseHash: "hash-a",
        },
        undefined
      );
    });

    act(() => {
      store.set(gitDiffPreviewAtomFamily("ws-1"), {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.tsx",
            status: "modified",
            renderAs: "text",
          },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("commit-file-list-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close all" }));
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard and Close" }));

    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    expect(store.get(openFilesAtomFamily("ws-1"))).toEqual({});
    expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toEqual({
      kind: "commit-file-list",
      path: "abc123",
      title: "abc123 · commit subject",
      commit: {
        sha: "abc123",
        shortSha: "abc123",
        subject: "commit subject",
        authorName: "Spencer",
        authoredAt: 1,
      },
      files: [
        {
          path: "src/app.tsx",
          status: "modified",
          renderAs: "text",
        },
      ],
    });

    await act(async () => {
      await result.current.openLocation({
        workspaceId: "ws-1",
        path: "src/a.ts",
        source: "manual",
      });
    });

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/a.ts");
      expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toBeNull();
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("reopened content");
    });

    expect(screen.queryByRole("button", { name: /Saving/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      staleSave.resolve({ newHash: "stale-hash" });
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["src/a.ts"]).toMatchObject({
        content: "reopened content",
        savedContent: "reopened content",
        baseHash: "reopen-hash",
        isDirty: false,
      });
    });

    expect(screen.queryByRole("button", { name: /Saving/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores a stale save failure after close all preserves commit preview and the file is reopened", async () => {
    const staleSave = createDeferred<{ newHash: string }>();
    const sendCommand = vi.fn().mockImplementation(async (op: string, args?: { path?: string }) => {
      if (op === "file.write" && args?.path === "src/a.ts") {
        return staleSave.promise;
      }

      if (op === "file.read" && args?.path === "src/a.ts") {
        return {
          kind: "text",
          content: "reopened content",
          baseHash: "reopen-hash",
          encoding: "utf-8",
        };
      }

      return null;
    });
    const { store } = setupStore({
      activePath: "src/a.ts",
      sendCommand,
      openFiles: {
        "src/a.ts": {
          kind: "text",
          path: "src/a.ts",
          content: "changed a",
          savedContent: "saved a",
          baseHash: "hash-a",
          isDirty: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
        <OpenEditorsSection workspaceId="ws-1" />
      </Provider>
    );

    const { result } = renderHook(() => useOpenLocation("ws-1"), {
      wrapper: wrapperFor(store),
    });

    pressSaveShortcut();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.write",
        {
          workspaceId: "ws-1",
          path: "src/a.ts",
          content: "changed a",
          baseHash: "hash-a",
        },
        undefined
      );
    });

    act(() => {
      store.set(gitDiffPreviewAtomFamily("ws-1"), {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.tsx",
            status: "modified",
            renderAs: "text",
          },
        ],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("commit-file-list-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close all" }));
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard and Close" }));

    await act(async () => {
      await result.current.openLocation({
        workspaceId: "ws-1",
        path: "src/a.ts",
        source: "manual",
      });
    });

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/a.ts");
      expect(store.get(gitDiffPreviewAtomFamily("ws-1"))).toBeNull();
      expect(screen.getByTestId("monaco-host")).toHaveTextContent("reopened content");
    });

    expect(screen.queryByRole("button", { name: /Saving/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      staleSave.reject(new Error("Stale save failed"));
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["src/a.ts"]).toMatchObject({
        content: "reopened content",
        savedContent: "reopened content",
        baseHash: "reopen-hash",
        isDirty: false,
      });
    });

    expect(screen.queryByRole("button", { name: /Saving/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("marks a dirty text buffer as externally modified without overwriting local edits", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      kind: "text",
      content: "from disk",
      baseHash: "hash-2",
      encoding: "utf-8",
    });

    const { store } = setupStore({
      activePath: "src/dirty.ts",
      sendCommand,
      openFiles: {
        "src/dirty.ts": {
          kind: "text",
          path: "src/dirty.ts",
          content: "local edits",
          savedContent: "from disk",
          baseHash: "hash-1",
          isDirty: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("local edits");

    act(() => {
      store.set(editorRefreshTokenAtomFamily("ws-1"), 1);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("changed on disk");
    });

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("local edits");
    expect(store.get(openFilesAtomFamily("ws-1"))["src/dirty.ts"]).toMatchObject({
      externalState: "modified",
      content: "local edits",
      baseHash: "hash-1",
    });
    expect(mockRegistryUpdateFromDisk).not.toHaveBeenCalled();
  });

  it("marks an open file as deleted when an external refresh can no longer read it", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "file.read") {
        throw new CommandResultError({
          code: "not_found",
          message: "Target not found",
        });
      }
      return null;
    });

    const { store } = setupStore({
      activePath: "src/deleted.ts",
      sendCommand,
      openFiles: {
        "src/deleted.ts": {
          kind: "text",
          path: "src/deleted.ts",
          content: "stale buffer",
          savedContent: "stale buffer",
          baseHash: "hash-1",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    act(() => {
      store.set(editorRefreshTokenAtomFamily("ws-1"), 1);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("deleted on disk");
    });
    expect(store.get(openFilesAtomFamily("ws-1"))["src/deleted.ts"]).toMatchObject({
      externalState: "deleted",
    });
  });

  it("clears deleted-on-disk editor state after closing the final editor before reopening the path", async () => {
    const pendingReopenRead = createDeferred<{
      kind: "text";
      content: string;
      baseHash: string;
      encoding: "utf-8";
    }>();
    let readCount = 0;
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op !== "file.read") {
        return null;
      }

      readCount += 1;

      if (readCount === 1) {
        throw new CommandResultError({
          code: "not_found",
          message: "Target not found",
        });
      }

      return pendingReopenRead.promise;
    });

    const { store } = setupStore({
      activePath: "src/deleted.ts",
      sendCommand,
      openFiles: {
        "src/deleted.ts": {
          kind: "text",
          path: "src/deleted.ts",
          content: "stale buffer",
          savedContent: "stale buffer",
          baseHash: "hash-1",
          isDirty: false,
        },
      },
    });

    const { result } = renderHook(() => useCodeEditorActions(), {
      wrapper: wrapperFor(store),
    });

    act(() => {
      store.set(editorRefreshTokenAtomFamily("ws-1"), 1);
    });

    await waitFor(() => {
      expect(result.current.activeExternalStatus).toBe("deleted");
    });

    act(() => {
      result.current.handleClose();
    });

    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    expect(store.get(openFilesAtomFamily("ws-1"))).toEqual({});
    expect(result.current.activeExternalStatus).toBeNull();

    act(() => {
      store.set(activeFilePathAtomFamily("ws-1"), "src/deleted.ts");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.read",
        {
          workspaceId: "ws-1",
          path: "src/deleted.ts",
        },
        undefined
      );
    });

    expect(result.current.activeExternalStatus).toBeNull();

    await act(async () => {
      pendingReopenRead.resolve({
        kind: "text",
        content: "fresh content",
        baseHash: "hash-2",
        encoding: "utf-8",
      });
    });

    await waitFor(() => {
      expect(result.current.currentFile).toMatchObject({
        kind: "text",
        path: "src/deleted.ts",
        content: "fresh content",
      });
      expect(result.current.activeExternalStatus).toBeNull();
    });
  });

  it("refreshes an open image when version changes but url and size stay the same", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      kind: "image",
      mime: "image/png",
      url: "/api/file?workspaceId=ws-1&path=logo.png",
      size: 128,
      isTextBacked: false,
      version: "2",
    });

    const { store } = setupStore({
      activePath: "logo.png",
      sendCommand,
      openFiles: {
        "logo.png": {
          kind: "image",
          path: "logo.png",
          mime: "image/png",
          url: "/api/file?workspaceId=ws-1&path=logo.png",
          size: 128,
          isTextBacked: false,
          version: "1",
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    act(() => {
      store.set(editorRefreshTokenAtomFamily("ws-1"), 1);
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["logo.png"]).toMatchObject({ version: "2" });
      expect(screen.getByTestId("image-preview")).toHaveAttribute("data-version", "2");
    });
  });

  it("keeps dirty SVG text edits when a refresh rereads the file as an image descriptor", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      kind: "image",
      mime: "image/svg+xml",
      url: "/api/file?workspaceId=ws-1&path=icon.svg",
      size: 256,
      isTextBacked: true,
      version: "2",
    });

    const { store } = setupStore({
      activePath: "icon.svg",
      sendCommand,
      openFiles: {
        "icon.svg": {
          kind: "text",
          path: "icon.svg",
          content: "<svg>local edits</svg>",
          savedContent: "<svg>saved</svg>",
          baseHash: "hash-1",
          isDirty: true,
          viewingTextBackedImageAsText: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("<svg>local edits</svg>");

    act(() => {
      store.set(editorRefreshTokenAtomFamily("ws-1"), 1);
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["icon.svg"]).toMatchObject({
        kind: "text",
        content: "<svg>local edits</svg>",
        isDirty: true,
        viewingTextBackedImageAsText: true,
        externalState: "modified",
      });
    });

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("<svg>local edits</svg>");
    expect(screen.queryByTestId("image-preview")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("changed on disk");
  });

  it("keeps clean SVG text mode open and refreshes its text bytes on external refresh", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => "<svg>fresh from disk</svg>",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const sendCommand = vi.fn().mockResolvedValue({
      kind: "image",
      mime: "image/svg+xml",
      url: "/api/file?workspaceId=ws-1&path=icon.svg",
      size: 256,
      isTextBacked: true,
      version: "2",
    });

    const { store } = setupStore({
      activePath: "icon.svg",
      sendCommand,
      openFiles: {
        "icon.svg": {
          kind: "text",
          path: "icon.svg",
          content: "<svg>stale</svg>",
          savedContent: "<svg>stale</svg>",
          baseHash: "hash-1",
          isDirty: false,
          viewingTextBackedImageAsText: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    act(() => {
      store.set(editorRefreshTokenAtomFamily("ws-1"), 1);
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["icon.svg"]).toMatchObject({
        kind: "text",
        content: "<svg>fresh from disk</svg>",
        isDirty: false,
        viewingTextBackedImageAsText: true,
        externalState: undefined,
      });
    });

    expect(screen.getByTestId("monaco-host")).toHaveTextContent("<svg>fresh from disk</svg>");
    expect(screen.queryByTestId("image-preview")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("treats refreshed clean SVG text bytes as the new saved baseline", async () => {
    const fetchMock = vi
      .fn(async () => ({
        ok: true,
        text: async () => "<svg>fresh from disk</svg>",
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        text: async () => "<svg>fresh from disk</svg>",
      }));
    vi.stubGlobal("fetch", fetchMock);

    const sendCommand = vi.fn().mockResolvedValue({
      kind: "image",
      mime: "image/svg+xml",
      url: "/api/file?workspaceId=ws-1&path=icon.svg",
      size: 256,
      isTextBacked: true,
      version: "2",
    });

    const { store } = setupStore({
      activePath: "icon.svg",
      sendCommand,
      openFiles: {
        "icon.svg": {
          kind: "text",
          path: "icon.svg",
          content: "<svg>stale</svg>",
          savedContent: "<svg>stale</svg>",
          baseHash: "hash-1",
          isDirty: false,
          viewingTextBackedImageAsText: true,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    act(() => {
      store.set(editorRefreshTokenAtomFamily("ws-1"), 1);
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["icon.svg"]).toMatchObject({
        content: "<svg>fresh from disk</svg>",
        savedContent: "<svg>fresh from disk</svg>",
        isDirty: false,
      });
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Editor content" }), {
      target: { value: "<svg>fresh from disk</svg>" },
    });

    await waitFor(() => {
      expect(store.get(openFilesAtomFamily("ws-1"))["icon.svg"]).toMatchObject({
        isDirty: false,
      });
    });

    vi.unstubAllGlobals();
  });

  describe("SVG edit-as-text toggle", () => {
    beforeEach(() => {
      // The toggle fetches the file bytes over HTTP to reuse them as text.
      // Stub global fetch so jsdom doesn't try to hit the network.
      const fetchMock = vi.fn(async () => ({
        ok: true,
        text: async () => '<svg xmlns="http://www.w3.org/2000/svg"/>',
      }));
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("switches a text-backed image into text mode when edit is clicked", async () => {
      // Server still routes SVG through the image branch on every read; the
      // force-text escape hatch is what the client uses to then pull the
      // bytes as text.
      const sendCommand = vi.fn().mockImplementation(async (op: string) => {
        if (op === "file.read") {
          return {
            kind: "image",
            mime: "image/svg+xml",
            url: "/api/file?workspaceId=ws-1&path=icon.svg",
            size: 200,
            isTextBacked: true,
            version: "1",
          };
        }
        return null;
      });

      const { store } = setupStore({
        activePath: "icon.svg",
        sendCommand,
        openFiles: {
          "icon.svg": {
            kind: "image",
            path: "icon.svg",
            mime: "image/svg+xml",
            url: "/api/file?workspaceId=ws-1&path=icon.svg",
            size: 200,
            isTextBacked: true,
            version: "1",
          },
        },
      });

      render(
        <Provider store={store}>
          <CodeEditorHost />
        </Provider>
      );

      // Initially renders as image preview.
      expect(screen.getByTestId("image-preview")).toBeInTheDocument();

      const editButton = screen.getByRole("button", { name: "Edit" });
      fireEvent.click(editButton);

      // After the fetch resolves we should be viewing it in Monaco with the
      // raw SVG source, and preview becomes the way back to the rendered asset.
      await waitFor(() => {
        expect(screen.getByTestId("monaco-host")).toHaveTextContent("<svg");
      });
      expect(screen.queryByTestId("image-preview")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    });

    it("switches a text-backed image back to rendered preview when preview is clicked", async () => {
      const sendCommand = vi.fn().mockImplementation(async (op: string) => {
        if (op === "file.read") {
          return {
            kind: "image",
            mime: "image/svg+xml",
            url: "/api/file?workspaceId=ws-1&path=icon.svg",
            size: 200,
            isTextBacked: true,
            version: "1",
          };
        }
        return null;
      });

      const { store } = setupStore({
        activePath: "icon.svg",
        sendCommand,
        openFiles: {
          "icon.svg": {
            kind: "image",
            path: "icon.svg",
            mime: "image/svg+xml",
            url: "/api/file?workspaceId=ws-1&path=icon.svg",
            size: 200,
            isTextBacked: true,
            version: "1",
          },
        },
      });

      render(
        <Provider store={store}>
          <CodeEditorHost />
        </Provider>
      );

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));

      await waitFor(() => {
        expect(screen.getByTestId("monaco-host")).toHaveTextContent("<svg");
      });

      fireEvent.click(screen.getByRole("button", { name: "Preview" }));

      await waitFor(() => {
        expect(screen.getByTestId("image-preview")).toBeInTheDocument();
      });
    });

    it("keeps unified preview and edit actions for non-text-backed images like PNG", async () => {
      const { store } = setupStore({
        activePath: "logo.png",
        openFiles: {
          "logo.png": {
            kind: "image",
            path: "logo.png",
            mime: "image/png",
            url: "/api/file?workspaceId=ws-1&path=logo.png",
            size: 4096,
            isTextBacked: false,
            version: "1",
          },
        },
      });

      render(
        <Provider store={store}>
          <CodeEditorHost />
        </Provider>
      );

      expect(screen.getByTestId("image-preview")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    });

    it("does not reopen a text-backed image as text when hidden during the fetch stage", async () => {
      const fetchDeferred = createDeferred<{
        ok: true;
        text: () => Promise<string>;
      }>();
      const fetchMock = vi.fn(() => fetchDeferred.promise);
      vi.stubGlobal("fetch", fetchMock);

      const sendCommand = vi.fn().mockImplementation(async (op: string) => {
        if (op === "file.read") {
          return {
            kind: "image",
            mime: "image/svg+xml",
            url: "/api/file?workspaceId=ws-1&path=icon.svg",
            size: 200,
            isTextBacked: true,
            version: "1",
          };
        }
        return null;
      });

      const { store } = setupStore({
        activePath: "icon.svg",
        sendCommand,
        openFiles: {
          "icon.svg": {
            kind: "image",
            path: "icon.svg",
            mime: "image/svg+xml",
            url: "/api/file?workspaceId=ws-1&path=icon.svg",
            size: 200,
            isTextBacked: true,
            version: "1",
          },
        },
      });

      render(
        <Provider store={store}>
          <CodeEditorHost />
        </Provider>
      );

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith("/api/file?workspaceId=ws-1&path=icon.svg", {
          credentials: "include",
        });
      });

      fireEvent.click(screen.getByRole("button", { name: "Close editor view" }));

      await waitFor(() => {
        expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
      });
      expect(store.get(openEditorPathsAtomFamily("ws-1"))).toContain("icon.svg");

      await act(async () => {
        fetchDeferred.resolve({
          ok: true,
          text: async () => '<svg xmlns="http://www.w3.org/2000/svg"/>',
        });
      });

      await waitFor(() => {
        expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
        expect(store.get(openEditorPathsAtomFamily("ws-1"))).toContain("icon.svg");
      });
    });
  });
});
