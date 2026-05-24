import { beforeEach, describe, expect, it } from "vitest";
import {
  __getPendingEditorLoadWorkspaceCountForTests,
  __resetPendingEditorLoadsForTests,
  beginPendingEditorLoad,
  cancelPendingEditorLoad,
  finishPendingEditorLoad,
  hasAnyPendingEditorLoads,
  shouldIgnorePendingEditorLoadResult,
} from "./pending-editor-loads";

describe("pending editor loads tracker", () => {
  beforeEach(() => {
    __resetPendingEditorLoadsForTests();
  });

  it("cleans up workspace state after a finished load settles", () => {
    const requestId = beginPendingEditorLoad("ws-1", "src/app.ts");

    expect(__getPendingEditorLoadWorkspaceCountForTests()).toBe(1);

    finishPendingEditorLoad("ws-1", "src/app.ts", requestId);

    expect(__getPendingEditorLoadWorkspaceCountForTests()).toBe(0);
    expect(shouldIgnorePendingEditorLoadResult("ws-1", "src/app.ts", requestId)).toBe(true);
  });

  it("cleans up workspace state after a cancelled load is ignored", () => {
    const requestId = beginPendingEditorLoad("ws-1", "src/app.ts");

    cancelPendingEditorLoad("ws-1", "src/app.ts");

    expect(__getPendingEditorLoadWorkspaceCountForTests()).toBe(1);
    expect(shouldIgnorePendingEditorLoadResult("ws-1", "src/app.ts", requestId)).toBe(true);
    expect(__getPendingEditorLoadWorkspaceCountForTests()).toBe(0);
  });

  it("keeps request ids safe across cleanup cycles so old late results stay ignored", () => {
    const firstRequestId = beginPendingEditorLoad("ws-1", "src/app.ts");
    finishPendingEditorLoad("ws-1", "src/app.ts", firstRequestId);

    expect(__getPendingEditorLoadWorkspaceCountForTests()).toBe(0);

    const secondRequestId = beginPendingEditorLoad("ws-1", "src/app.ts");

    expect(secondRequestId).toBeGreaterThan(firstRequestId);
    expect(shouldIgnorePendingEditorLoadResult("ws-1", "src/app.ts", firstRequestId)).toBe(true);
    expect(shouldIgnorePendingEditorLoadResult("ws-1", "src/app.ts", secondRequestId)).toBe(false);
  });

  it("tracks whether a workspace still has any pending editor loads", () => {
    const firstRequestId = beginPendingEditorLoad("ws-1", "src/a.ts");
    const secondRequestId = beginPendingEditorLoad("ws-1", "src/b.ts");

    expect(hasAnyPendingEditorLoads("ws-1")).toBe(true);

    finishPendingEditorLoad("ws-1", "src/a.ts", firstRequestId);
    expect(hasAnyPendingEditorLoads("ws-1")).toBe(true);

    finishPendingEditorLoad("ws-1", "src/b.ts", secondRequestId);
    expect(hasAnyPendingEditorLoads("ws-1")).toBe(false);
  });

  it("cleans up a cancelled tombstone when the same path is reopened and later finishes", () => {
    const firstRequestId = beginPendingEditorLoad("ws-1", "src/app.ts");

    cancelPendingEditorLoad("ws-1", "src/app.ts");
    expect(__getPendingEditorLoadWorkspaceCountForTests()).toBe(1);

    const secondRequestId = beginPendingEditorLoad("ws-1", "src/app.ts");
    finishPendingEditorLoad("ws-1", "src/app.ts", secondRequestId);

    expect(__getPendingEditorLoadWorkspaceCountForTests()).toBe(0);
    expect(shouldIgnorePendingEditorLoadResult("ws-1", "src/app.ts", firstRequestId)).toBe(true);
  });
});
