import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "..";

const viewportMock = vi.hoisted(() => ({
  value: "desktop" as "desktop" | "mobile",
}));

vi.mock("../_internal/use-viewport", () => ({
  useViewport: () => viewportMock.value,
}));

describe("Tooltip", () => {
  afterEach(() => {
    viewportMock.value = "desktop";
    vi.restoreAllMocks();
  });

  it("shows tooltip content on hover and focus, then removes it on leave and blur", () => {
    render(
      <Tooltip content="Quick Actions">
        <button type="button">Trigger</button>
      </Tooltip>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(trigger);
    const hoverTooltip = screen.getByRole("tooltip");
    expect(hoverTooltip).toHaveTextContent("Quick Actions");
    expect(document.body).toContainElement(hoverTooltip);
    expect(trigger).toHaveAttribute("aria-describedby", hoverTooltip.getAttribute("id") ?? "");

    fireEvent.focus(trigger);
    const focusTooltip = screen.getByRole("tooltip");
    expect(focusTooltip).toHaveTextContent("Quick Actions");
    expect(trigger).toHaveAttribute("aria-describedby", focusTooltip.getAttribute("id") ?? "");

    fireEvent.mouseLeave(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("preserves existing trigger handlers while adding tooltip behavior", () => {
    const onFocus = vi.fn();
    const onMouseEnter = vi.fn();

    render(
      <Tooltip content="Quick Actions">
        <button type="button" onFocus={onFocus} onMouseEnter={onMouseEnter}>
          Trigger
        </button>
      </Tooltip>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });
    fireEvent.mouseEnter(trigger);
    fireEvent.focus(trigger);

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Quick Actions");
  });

  it("preserves an existing aria-describedby value while the tooltip is open", () => {
    render(
      <>
        <div id="existing-description">Existing description</div>
        <Tooltip content="Quick Actions">
          <button type="button" aria-describedby="existing-description">
            Trigger
          </button>
        </Tooltip>
      </>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });
    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole("tooltip");
    expect(trigger).toHaveAttribute(
      "aria-describedby",
      `existing-description ${tooltip.getAttribute("id")}`
    );

    fireEvent.mouseLeave(trigger);
    expect(trigger).toHaveAttribute("aria-describedby", "existing-description");
  });

  it("suppresses tooltip rendering when disabled", () => {
    render(
      <Tooltip content="Quick Actions" disabled>
        <button type="button">Trigger</button>
      </Tooltip>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });
    fireEvent.mouseEnter(trigger);
    fireEvent.focus(trigger);

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("shows tooltip content for disabled button triggers on hover", () => {
    render(
      <Tooltip content="Quick Actions">
        <button type="button" disabled>
          Trigger
        </button>
      </Tooltip>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });
    const wrapper = trigger.parentElement;

    expect(wrapper?.tagName).toBe("SPAN");

    fireEvent.mouseEnter(wrapper!);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Quick Actions");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.getAttribute("id") ?? "");

    fireEvent.mouseLeave(wrapper!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps the tooltip within the viewport when the trigger is near the right edge", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute("role") === "tooltip") {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 120,
          bottom: 24,
          width: 120,
          height: 24,
          toJSON: () => ({}),
        } as DOMRect;
      }

      return {
        x: 980,
        y: 40,
        top: 40,
        left: 980,
        right: 1020,
        bottom: 60,
        width: 40,
        height: 20,
        toJSON: () => ({}),
      } as DOMRect;
    });
    vi.stubGlobal("innerWidth", 1024);

    render(
      <Tooltip content="Quick Actions">
        <button type="button">Trigger</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Trigger" }));

    expect(screen.getByRole("tooltip")).toHaveStyle({
      left: "896px",
      top: "8px",
    });
  });

  it("becomes a no-op wrapper on mobile/coarse viewports", () => {
    viewportMock.value = "mobile";

    render(
      <Tooltip content="Quick Actions">
        <button type="button">Trigger</button>
      </Tooltip>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });
    fireEvent.mouseEnter(trigger);
    fireEvent.focus(trigger);

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });
});
