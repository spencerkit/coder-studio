import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaneLayout } from "./pane-layout";

function mockContainerRect(width: number, height = 600) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: height,
        right: width,
        width,
        height,
        toJSON: () => ({}),
      }) as DOMRect
  );
}

describe("PaneLayout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.classList.remove("is-resizing-panels");
  });

  it("renders direction-specific divider classes", () => {
    const { container, rerender } = render(
      <PaneLayout splitId="split-a" direction="horizontal" ratio={0.5}>
        <div>left</div>
        <div>right</div>
      </PaneLayout>
    );

    const horizontalDivider = container.querySelector('[role="separator"]');

    expect(horizontalDivider).toHaveClass("pane-layout-divider", "pane-layout-horizontal-divider");
    expect(horizontalDivider).toHaveAttribute("aria-orientation", "vertical");

    rerender(
      <PaneLayout splitId="split-b" direction="vertical" ratio={0.5}>
        <div>top</div>
        <div>bottom</div>
      </PaneLayout>
    );

    const verticalDivider = container.querySelector('[role="separator"]');

    expect(verticalDivider).toHaveClass("pane-layout-divider", "pane-layout-vertical-divider");
    expect(verticalDivider).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("resets the local ratio when the split identity changes", () => {
    mockContainerRect(1000);

    const { container, rerender } = render(
      <PaneLayout splitId="split-a" direction="horizontal" ratio={0.5}>
        <div>left</div>
        <div>right</div>
      </PaneLayout>
    );

    const layout = container.firstElementChild as HTMLDivElement;
    const divider = container.querySelector(".pane-layout-divider");

    expect(layout.style.gridTemplateColumns).toBe("50% 0px 50%");

    fireEvent.mouseDown(divider!);
    fireEvent.mouseMove(document, { clientX: 250 });
    fireEvent.mouseUp(document);

    expect(layout.style.gridTemplateColumns).toBe("25% 0px 75%");

    rerender(
      <PaneLayout splitId="split-b" direction="horizontal" ratio={0.5}>
        <div>next-left</div>
        <div>next-right</div>
      </PaneLayout>
    );

    expect((container.firstElementChild as HTMLDivElement).style.gridTemplateColumns).toBe(
      "50% 0px 50%"
    );
  });

  it("commits the ratio on mouseup instead of every mousemove", () => {
    mockContainerRect(1000);
    const onRatioCommit = vi.fn();

    const { container } = render(
      <PaneLayout splitId="root" direction="horizontal" ratio={0.5} onRatioCommit={onRatioCommit}>
        <div>left</div>
        <div>right</div>
      </PaneLayout>
    );

    const layout = container.firstElementChild as HTMLDivElement;
    const divider = container.querySelector(".pane-layout-divider");

    fireEvent.mouseDown(divider!);
    fireEvent.mouseMove(document, { clientX: 300 });

    expect(layout.style.gridTemplateColumns).toBe("30% 0px 70%");
    expect(onRatioCommit).not.toHaveBeenCalled();

    fireEvent.mouseMove(document, { clientX: 350 });

    expect(onRatioCommit).not.toHaveBeenCalled();

    fireEvent.mouseUp(document);

    expect(onRatioCommit).toHaveBeenCalledTimes(1);
    expect(onRatioCommit).toHaveBeenCalledWith(0.35);
  });
});
