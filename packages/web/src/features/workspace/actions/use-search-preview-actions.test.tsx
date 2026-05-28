// @vitest-environment jsdom

import type { SearchSessionFilePreview } from "@coder-studio/core";
import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../atoms/connection";
import { activeFilePathAtomFamily, editorModeAtomFamily, gitDiffPreviewAtomFamily } from "../atoms";
import { useSearchPreviewActions } from "./use-search-preview-actions";

describe("useSearchPreviewActions", () => {
  it("opens a search replace diff preview in the shared editor surface", async () => {
    const preview: SearchSessionFilePreview = {
      kind: "search-replace-file-diff",
      path: "src/app.ts",
      title: "src/app.ts",
      sessionId: "session-1",
      baseHash: "hash-1",
      originalContent: "before\n",
      modifiedContent: "after\n",
    };
    const sendCommand = vi.fn().mockResolvedValue(preview);
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    const { result } = renderHook(() => useSearchPreviewActions("ws-test"), { wrapper });

    await expect(result.current.openSearchPreview("session-1", "src/app.ts")).resolves.toBe(true);

    expect(sendCommand).toHaveBeenCalledWith("file.searchSession.previewFile", {
      workspaceId: "ws-test",
      sessionId: "session-1",
      path: "src/app.ts",
    });
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.ts");
    expect(store.get(editorModeAtomFamily("ws-test"))).toBe("diff");
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual(preview);
  });
});
