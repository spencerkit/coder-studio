import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { CommandResultError } from "../../../../ws/client";
import { toastsAtom } from "../../../notifications/atoms";
import { gitDiffPreviewAtomFamily } from "../../atoms";
import { GitDiffViewer } from "./git-diff-viewer";

const viewportMocks = vi.hoisted(() => ({
  value: "desktop" as "desktop" | "mobile",
}));

vi.mock("../../../../components/ui/_internal/use-viewport", () => ({
  useViewport: () => viewportMocks.value,
}));

describe("GitDiffViewer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    viewportMocks.value = "desktop";
  });

  it("shows raw patch content only and does not request file preview content", async () => {
    const sendCommand = vi.fn();

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
      kind: "worktree-file-diff",
      path: "packages/core/src/domain/types.ts",
      staged: false,
      diff: [
        "diff --git a/packages/core/src/domain/types.ts b/packages/core/src/domain/types.ts",
        "index 1234567..89abcde 100644",
        "@@ -1,2 +1,3 @@",
        " export interface Workspace {",
        "+  previewMode: true;",
        " }",
      ].join("\n"),
    });

    render(
      <Provider store={store}>
        <GitDiffViewer workspaceId="ws-test" />
      </Provider>
    );

    expect(
      await screen.findByText(/diff --git a\/packages\/core\/src\/domain\/types\.ts/)
    ).toBeInTheDocument();
    expect(screen.getByText("@@ -1,2 +1,3 @@")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Diff" })).not.toBeInTheDocument();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("clears the preview when the header close button is clicked", async () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
      kind: "worktree-file-diff",
      path: "packages/core/src/domain/types.ts",
      staged: false,
      diff: [
        "diff --git a/packages/core/src/domain/types.ts b/packages/core/src/domain/types.ts",
        "@@ -1,2 +1,3 @@",
        "+  previewMode: true;",
      ].join("\n"),
    });

    render(
      <Provider store={store}>
        <GitDiffViewer workspaceId="ws-test" />
      </Provider>
    );

    const closeButton = screen.getByRole("button", { name: /close|关闭/i });
    expect(closeButton).toHaveClass("btn", "btn-ghost", "btn-sm", "code-mode-btn");
    expect(closeButton).not.toHaveAttribute("title");

    fireEvent.mouseEnter(closeButton);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/close|关闭/i);

    fireEvent.click(closeButton);

    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toBeNull();
    expect(screen.getByText("Git")).toBeInTheDocument();
    expect(document.querySelector(".git-diff-empty")).toBeTruthy();
    expect(
      screen.getByText("Select a staged or modified file on the left to inspect its diff.")
    ).toHaveClass("git-diff-empty-body");
  });

  it("hides the internal close button when showCloseButton is false", async () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
      kind: "worktree-file-diff",
      path: "packages/core/src/domain/types.ts",
      staged: false,
      diff: [
        "diff --git a/packages/core/src/domain/types.ts b/packages/core/src/domain/types.ts",
        "@@ -1,2 +1,3 @@",
        "+  previewMode: true;",
      ].join("\n"),
    });

    render(
      <Provider store={store}>
        <GitDiffViewer workspaceId="ws-test" showCloseButton={false} />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: /close|关闭/i })).not.toBeInTheDocument();
  });

  it("renders file and hunk actions for unstaged worktree diffs", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
          renderAs: "text",
          status: "modified",
          hunks: [
            {
              id: "hunk_abc",
              header: "@@ -1 +1 @@",
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              patch: "@@ -1 +1 @@\n-old\n+new",
              lines: ["-old", "+new"],
            },
          ],
        };
      }
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [{ path: "src/app.ts", status: "modified" }],
          untracked: [],
          deleted: [],
          conflicted: [],
        };
      }
      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
      kind: "worktree-file-diff",
      path: "src/app.ts",
      staged: false,
      diff: "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
      renderAs: "text",
      status: "modified",
      hunks: [
        {
          id: "hunk_abc",
          header: "@@ -1 +1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          patch: "@@ -1 +1 @@\n-old\n+new",
          lines: ["-old", "+new"],
        },
      ],
    });

    render(
      <Provider store={store}>
        <GitDiffViewer workspaceId="ws-test" />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Stage hunk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard hunk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage file" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stage hunk" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.hunk",
        {
          workspaceId: "ws-test",
          path: "src/app.ts",
          staged: false,
          hunkId: "hunk_abc",
          operation: "stage",
        },
        undefined
      );
    });
  });

  it("shows a stale hunk error toast without clearing the selected preview", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.hunk") {
        throw new CommandResultError({
          code: "git_hunk_stale",
          message: "Diff changed. Refresh and try again.",
        });
      }
      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
      kind: "worktree-file-diff",
      path: "src/app.ts",
      staged: false,
      diff: "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
      renderAs: "text",
      status: "modified",
      hunks: [
        {
          id: "hunk_abc",
          header: "@@ -1 +1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          patch: "@@ -1 +1 @@\n-old\n+new",
          lines: ["-old", "+new"],
        },
      ],
    });

    render(
      <Provider store={store}>
        <GitDiffViewer workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Stage hunk" }));

    await waitFor(() => {
      expect(store.get(toastsAtom)[0]).toMatchObject({
        kind: "error",
        title: "Hunk operation failed",
        body: "Diff changed. Refresh and try again.",
      });
    });
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toMatchObject({
      kind: "worktree-file-diff",
      path: "src/app.ts",
      staged: false,
    });
  });

  it("renders staged hunk actions for staged worktree diffs", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.diff") {
        return {
          diff: "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
          renderAs: "text",
          status: "modified",
          hunks: [],
        };
      }
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [{ path: "src/app.ts", status: "modified" }],
          modified: [],
          untracked: [],
          deleted: [],
          conflicted: [],
        };
      }
      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
      kind: "worktree-file-diff",
      path: "src/app.ts",
      staged: true,
      diff: "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
      renderAs: "text",
      status: "modified",
      hunks: [
        {
          id: "hunk_staged",
          header: "@@ -1 +1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          patch: "@@ -1 +1 @@\n-old\n+new",
          lines: ["-old", "+new"],
        },
      ],
    });

    render(
      <Provider store={store}>
        <GitDiffViewer workspaceId="ws-test" />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Unstage hunk" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard hunk" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unstage file" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unstage hunk" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "git.hunk",
        {
          workspaceId: "ws-test",
          path: "src/app.ts",
          staged: true,
          hunkId: "hunk_staged",
          operation: "unstage",
        },
        undefined
      );
    });
  });
});
