// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { workspacesAtom } from "../../../atoms/workspaces";
import { pendingEditorNavigationAtomFamily } from "../../code-editor/atoms";
import { toSkillEditorPath } from "../../code-editor/skill-editor-path";
import { activeFilePathAtomFamily, openEditorPathsAtomFamily, openFilesAtomFamily } from "../atoms";
import { useSkillFileActions } from "./use-skill-file-actions";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

function seedWorkspace(store: ReturnType<typeof createStore>) {
  store.set(workspacesAtom, {
    "ws-test": {
      id: "ws-test",
      path: "/workspace",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  } as never);
}

function createSendCommand(store: ReturnType<typeof createStore>) {
  return vi.fn(
    async (op: string, args?: { workspaceId?: string; uiState?: Record<string, unknown> }) => {
      if (op === "skills.files.readTree") {
        const path = (args as { path?: string } | undefined)?.path;
        if (path === "refs") {
          return {
            path: "refs",
            children: [
              {
                name: "guide.md",
                path: "refs/guide.md",
                kind: "file",
                size: 12,
                mtime: 2,
              },
            ],
          };
        }

        return {
          path: ".",
          children: [
            {
              name: "refs",
              path: "refs",
              kind: "dir",
            },
            {
              name: "SKILL.md",
              path: "SKILL.md",
              kind: "file",
              size: 10,
              mtime: 1,
            },
          ],
        };
      }

      if (
        op === "skills.files.create" ||
        op === "skills.files.rename" ||
        op === "skills.files.delete"
      ) {
        return { ok: true };
      }

      if (op === "workspace.uiState.set") {
        const workspaceId = args?.workspaceId ?? "ws-test";
        const workspace = store.get(workspacesAtom)[workspaceId];
        return {
          id: workspaceId,
          path: workspace?.path ?? "/workspace",
          targetRuntime: workspace?.targetRuntime ?? "native",
          openedAt: workspace?.openedAt ?? 1,
          lastActiveAt: workspace?.lastActiveAt ?? 1,
          uiState: args?.uiState,
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    }
  );
}

describe("useSkillFileActions", () => {
  it("loads the root tree and opens a skill file in the existing editor flow", async () => {
    const store = createStore();
    const sendCommand = createSendCommand(store);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);

    const { result } = renderHook(
      () => useSkillFileActions({ workspaceId: "ws-test", skillSlug: "my-review-skill" }),
      {
        wrapper: wrapperFor(store),
      }
    );

    await act(async () => {
      await result.current.loadFileTree();
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "skills.files.readTree",
      {
        skillSlug: "my-review-skill",
      },
      undefined
    );
    expect(result.current.fileTree?.get(".")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "refs", kind: "dir" }),
        expect.objectContaining({ path: "SKILL.md", kind: "file" }),
      ])
    );

    await act(async () => {
      await result.current.openSkillFile("SKILL.md");
    });

    const skillEditorPath = toSkillEditorPath("my-review-skill", "SKILL.md");
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe(skillEditorPath);
    expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual([skillEditorPath]);
    expect(store.get(pendingEditorNavigationAtomFamily("ws-test"))).toMatchObject({
      workspaceId: "ws-test",
      path: skillEditorPath,
      source: "manual",
      requestId: expect.any(Number),
    });
    expect(store.get(workspacesAtom)["ws-test"]?.uiState.openEditorPaths).toEqual([
      skillEditorPath,
    ]);
  });

  it("loads child directories on demand", async () => {
    const store = createStore();
    const sendCommand = createSendCommand(store);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);

    const { result } = renderHook(
      () => useSkillFileActions({ workspaceId: "ws-test", skillSlug: "my-review-skill" }),
      {
        wrapper: wrapperFor(store),
      }
    );

    await act(async () => {
      await result.current.loadFileTree();
      await result.current.loadChildren("refs");
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "skills.files.readTree",
      {
        skillSlug: "my-review-skill",
        path: "refs",
      },
      undefined
    );
    expect(result.current.fileTree?.get("refs")).toEqual([
      expect.objectContaining({
        path: "refs/guide.md",
        kind: "file",
      }),
    ]);
  });

  it("creates a skill file and opens it in the editor", async () => {
    const store = createStore();
    const sendCommand = createSendCommand(store);

    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);

    const { result } = renderHook(
      () => useSkillFileActions({ workspaceId: "ws-test", skillSlug: "my-review-skill" }),
      {
        wrapper: wrapperFor(store),
      }
    );

    await act(async () => {
      await result.current.loadFileTree();
    });

    act(() => {
      result.current.openCreateDialog("file", "refs");
      result.current.updateDraftPath("refs/checklist.md");
    });

    await act(async () => {
      await result.current.submitCreateDialog();
    });

    const skillEditorPath = toSkillEditorPath("my-review-skill", "refs/checklist.md");

    expect(sendCommand).toHaveBeenCalledWith(
      "skills.files.create",
      {
        skillSlug: "my-review-skill",
        path: "refs/checklist.md",
      },
      undefined
    );
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe(skillEditorPath);
    expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual([skillEditorPath]);
  });

  it("renames open skill editor paths when a skill file is renamed", async () => {
    const store = createStore();
    const sendCommand = createSendCommand(store);
    const oldEditorPath = toSkillEditorPath("my-review-skill", "refs/guide.md");
    const nextEditorPath = toSkillEditorPath("my-review-skill", "refs/checklist.md");

    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);
    store.set(activeFilePathAtomFamily("ws-test"), oldEditorPath);
    store.set(openEditorPathsAtomFamily("ws-test"), [oldEditorPath, "README.md"]);
    store.set(openFilesAtomFamily("ws-test"), {
      [oldEditorPath]: {
        kind: "text",
        path: oldEditorPath,
        content: "guide",
        savedContent: "guide",
        baseHash: "hash-1",
        isDirty: false,
      },
    });

    const { result } = renderHook(
      () => useSkillFileActions({ workspaceId: "ws-test", skillSlug: "my-review-skill" }),
      {
        wrapper: wrapperFor(store),
      }
    );

    act(() => {
      result.current.openRenameDialog({
        path: "refs/guide.md",
        name: "guide.md",
        kind: "file",
      });
      result.current.updateRenameDraft("checklist.md");
    });

    await act(async () => {
      await result.current.submitRenameDialog();
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "skills.files.rename",
      {
        skillSlug: "my-review-skill",
        fromPath: "refs/guide.md",
        toPath: "refs/checklist.md",
      },
      undefined
    );
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe(nextEditorPath);
    expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual([nextEditorPath, "README.md"]);
    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({
      [nextEditorPath]: expect.objectContaining({
        path: nextEditorPath,
      }),
    });
  });

  it("renames open descendant skill editor paths when a skill directory is renamed", async () => {
    const store = createStore();
    const sendCommand = createSendCommand(store);
    const oldEditorPath = toSkillEditorPath("my-review-skill", "refs/guide.md");
    const nextEditorPath = toSkillEditorPath("my-review-skill", "references/guide.md");

    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);
    store.set(activeFilePathAtomFamily("ws-test"), oldEditorPath);
    store.set(openEditorPathsAtomFamily("ws-test"), [oldEditorPath, "README.md"]);
    store.set(openFilesAtomFamily("ws-test"), {
      [oldEditorPath]: {
        kind: "text",
        path: oldEditorPath,
        content: "guide",
        savedContent: "guide",
        baseHash: "hash-1",
        isDirty: false,
      },
    });

    const { result } = renderHook(
      () => useSkillFileActions({ workspaceId: "ws-test", skillSlug: "my-review-skill" }),
      {
        wrapper: wrapperFor(store),
      }
    );

    act(() => {
      result.current.openRenameDialog({
        path: "refs",
        name: "refs",
        kind: "dir",
      });
      result.current.updateRenameDraft("references");
    });

    await act(async () => {
      await result.current.submitRenameDialog();
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "skills.files.rename",
      {
        skillSlug: "my-review-skill",
        fromPath: "refs",
        toPath: "references",
      },
      undefined
    );
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe(nextEditorPath);
    expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual([nextEditorPath, "README.md"]);
    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({
      [nextEditorPath]: expect.objectContaining({
        path: nextEditorPath,
      }),
    });
  });

  it("removes open skill editor paths when a skill file is deleted", async () => {
    const store = createStore();
    const sendCommand = createSendCommand(store);
    const editorPath = toSkillEditorPath("my-review-skill", "refs/guide.md");

    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);
    store.set(activeFilePathAtomFamily("ws-test"), editorPath);
    store.set(openEditorPathsAtomFamily("ws-test"), [editorPath, "README.md"]);
    store.set(openFilesAtomFamily("ws-test"), {
      [editorPath]: {
        kind: "text",
        path: editorPath,
        content: "guide",
        savedContent: "guide",
        baseHash: "hash-1",
        isDirty: false,
      },
    });

    const { result } = renderHook(
      () => useSkillFileActions({ workspaceId: "ws-test", skillSlug: "my-review-skill" }),
      {
        wrapper: wrapperFor(store),
      }
    );

    act(() => {
      result.current.requestDelete({
        path: "refs/guide.md",
        name: "guide.md",
        error: null,
      });
    });

    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "skills.files.delete",
      {
        skillSlug: "my-review-skill",
        path: "refs/guide.md",
      },
      {
        timeoutMs: 180000,
      }
    );
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
    expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual(["README.md"]);
    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({});
  });
});
