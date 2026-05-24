import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePaneDragController } from "./use-pane-drag-controller";

function createPaneElement(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): HTMLElement {
  const element = document.createElement("div");
  const domRect = {
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => rect,
  } as DOMRect;

  element.getBoundingClientRect = vi.fn(() => domRect);
  return element;
}

describe("usePaneDragController", () => {
  afterEach(() => {
    document.body.classList.remove("is-dragging-pane");
  });

  it("marks a hovered session pane as left when the pointer is inside the left edge band", () => {
    const { result } = renderHook(() => usePaneDragController({ onDrop: vi.fn() }));

    act(() => {
      result.current.registerPane("target-pane", {
        type: "session",
        element: createPaneElement({ left: 100, top: 40, width: 400, height: 240 }),
      });
      result.current.startDrag({ paneId: "source-pane" });
      result.current.handlePointerMove({ clientX: 130, clientY: 180 } as PointerEvent);
    });

    expect(result.current.state.hoverTargetPaneId).toBe("target-pane");
    expect(result.current.state.hoverPlacement).toBe("left");
    expect(result.current.state.previewPosition).toEqual({ x: 130, y: 180 });
  });

  it("treats draft panes as center-only targets and dispatches a center drop intent", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => usePaneDragController({ onDrop }));

    act(() => {
      result.current.registerPane("draft-pane", {
        type: "draft",
        element: createPaneElement({ left: 300, top: 80, width: 320, height: 240 }),
      });
      result.current.startDrag({ paneId: "source-pane" });
      result.current.handlePointerMove({ clientX: 310, clientY: 140 } as PointerEvent);
    });

    expect(result.current.state.hoverPlacement).toBe("center");

    act(() => {
      result.current.handlePointerUp();
    });

    expect(onDrop).toHaveBeenCalledWith({
      sourcePaneId: "source-pane",
      targetPaneId: "draft-pane",
      placement: "center",
      targetType: "draft",
    });
    expect(result.current.state.isDragging).toBe(false);
  });

  it("does not hover or dispatch a drop when the pointer stays over the source pane", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => usePaneDragController({ onDrop }));

    act(() => {
      result.current.registerPane("pane-1", {
        type: "session",
        element: createPaneElement({ left: 40, top: 30, width: 360, height: 220 }),
      });
      result.current.startDrag({ paneId: "pane-1" });
      result.current.handlePointerMove({ clientX: 120, clientY: 120 } as PointerEvent);
    });

    expect(result.current.state.hoverTargetPaneId).toBeNull();
    expect(result.current.state.hoverPlacement).toBeNull();

    act(() => {
      result.current.handlePointerUp();
    });

    expect(onDrop).not.toHaveBeenCalled();
  });
});
