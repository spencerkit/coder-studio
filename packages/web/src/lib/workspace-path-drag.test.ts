import { describe, expect, it, vi } from "vitest";
import {
  getWorkspacePathDragPayload,
  hasWorkspacePathDragType,
  setWorkspacePathDragData,
  WORKSPACE_PATH_DRAG_MIME,
} from "./workspace-path-drag";

describe("workspace-path-drag", () => {
  it("writes the custom mime payload and plain text path", () => {
    const setData = vi.fn();
    const dataTransfer = {
      effectAllowed: "none",
      setData,
    } as unknown as DataTransfer;

    setWorkspacePathDragData(dataTransfer, {
      workspaceId: "ws-1",
      path: "src/app.tsx",
      kind: "file",
    });

    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(setData).toHaveBeenNthCalledWith(
      1,
      WORKSPACE_PATH_DRAG_MIME,
      JSON.stringify({
        workspaceId: "ws-1",
        path: "src/app.tsx",
        kind: "file",
      })
    );
    expect(setData).toHaveBeenNthCalledWith(2, "text/plain", "src/app.tsx");
  });

  it("reads a valid payload only when the custom mime type is present", () => {
    const dataTransfer = {
      types: [WORKSPACE_PATH_DRAG_MIME, "text/plain"],
      getData: vi.fn((type: string) =>
        type === WORKSPACE_PATH_DRAG_MIME
          ? JSON.stringify({
              workspaceId: "ws-1",
              path: "src/app.tsx",
              kind: "file",
            })
          : "src/app.tsx"
      ),
    } as unknown as DataTransfer;

    expect(hasWorkspacePathDragType(dataTransfer)).toBe(true);
    expect(getWorkspacePathDragPayload(dataTransfer)).toEqual({
      workspaceId: "ws-1",
      path: "src/app.tsx",
      kind: "file",
    });
  });

  it("returns null for invalid payloads", () => {
    expect(
      getWorkspacePathDragPayload({
        types: [WORKSPACE_PATH_DRAG_MIME],
        getData: () => "{bad json",
      } as unknown as DataTransfer)
    ).toBeNull();

    expect(
      getWorkspacePathDragPayload({
        types: [WORKSPACE_PATH_DRAG_MIME],
        getData: () => JSON.stringify({ workspaceId: "ws-1", path: "", kind: "file" }),
      } as unknown as DataTransfer)
    ).toBeNull();

    expect(
      getWorkspacePathDragPayload({
        types: ["text/plain"],
        getData: () => "src/app.tsx",
      } as unknown as DataTransfer)
    ).toBeNull();
  });
});
