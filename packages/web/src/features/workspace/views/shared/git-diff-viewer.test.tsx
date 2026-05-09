import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
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
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
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
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
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
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(gitDiffPreviewAtomFamily("ws-test"), {
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
});
