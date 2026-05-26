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

  it("does not start dragging when disabled", () => {
    const { result } = renderHook(() => usePaneDragController({ onDrop: vi.fn(), enabled: false }));

    act(() => {
      result.current.startDrag({ paneId: "source-pane" });
    });

    expect(document.body).not.toHaveClass("is-dragging-pane");
    expect(result.current.state.isDragging).toBe(false);
    expect(result.current.state.source).toBeNull();
  });

  it("attaches pointer listeners while dragging and removes listeners and body class on unmount", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => usePaneDragController({ onDrop: vi.fn() }));

    act(() => {
      result.current.startDrag({ paneId: "source-pane" });
    });

    expect(document.body).toHaveClass("is-dragging-pane");
    expect(addEventListenerSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith("pointerup", expect.any(Function));

    act(() => {
      unmount();
    });

    expect(document.body).not.toHaveClass("is-dragging-pane");
    expect(removeEventListenerSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("pointerup", expect.any(Function));
  });

  it("cleans up drag state, body class, and listeners when pointercancel interrupts a drag", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const { result } = renderHook(() => usePaneDragController({ onDrop: vi.fn() }));

    act(() => {
      result.current.startDrag({ paneId: "source-pane" });
      result.current.handlePointerMove({ clientX: 180, clientY: 220 } as PointerEvent);
    });

    expect(document.body).toHaveClass("is-dragging-pane");
    expect(result.current.state.isDragging).toBe(true);
    expect(result.current.state.previewPosition).toEqual({ x: 180, y: 220 });
    expect(addEventListenerSpy).toHaveBeenCalledWith("pointercancel", expect.any(Function));

    act(() => {
      window.dispatchEvent(new Event("pointercancel"));
    });

    expect(document.body).not.toHaveClass("is-dragging-pane");
    expect(result.current.state.isDragging).toBe(false);
    expect(result.current.state.hoverTargetPaneId).toBeNull();
    expect(result.current.state.hoverPlacement).toBeNull();
    expect(result.current.state.previewPosition).toEqual({ x: 0, y: 0 });
    expect(removeEventListenerSpy).toHaveBeenCalledWith("pointercancel", expect.any(Function));
  });

  it("immediately clears an active drag when enabled changes to false", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const { result, rerender } = renderHook(
      ({ enabled }) => usePaneDragController({ onDrop: vi.fn(), enabled }),
      {
        initialProps: { enabled: true },
      }
    );

    act(() => {
      result.current.startDrag({ paneId: "source-pane" });
      result.current.handlePointerMove({ clientX: 220, clientY: 260 } as PointerEvent);
    });

    expect(document.body).toHaveClass("is-dragging-pane");
    expect(result.current.state.isDragging).toBe(true);
    expect(result.current.state.previewPosition).toEqual({ x: 220, y: 260 });

    act(() => {
      rerender({ enabled: false });
    });

    expect(document.body).not.toHaveClass("is-dragging-pane");
    expect(result.current.state.isDragging).toBe(false);
    expect(result.current.state.source).toBeNull();
    expect(result.current.state.previewPosition).toEqual({ x: 0, y: 0 });
    expect(removeEventListenerSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("pointerup", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("pointercancel", expect.any(Function));
  });
});
