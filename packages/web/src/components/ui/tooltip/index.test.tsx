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

  it("removes the tooltip after clicking the trigger and leaving with the pointer", () => {
    render(
      <Tooltip content="Quick Actions">
        <button type="button">Trigger</button>
      </Tooltip>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });

    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Quick Actions");

    fireEvent.pointerDown(trigger);
    fireEvent.focus(trigger);
    fireEvent.mouseLeave(trigger);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("removes the tooltip on outside pointerdown even when focus stays on the trigger", () => {
    render(
      <div>
        <Tooltip content="Quick Actions">
          <button type="button">Trigger</button>
        </Tooltip>
        <div data-testid="outside">Outside</div>
      </div>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });
    const outside = screen.getByTestId("outside");

    fireEvent.mouseEnter(trigger);
    fireEvent.pointerDown(trigger);
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Quick Actions");

    fireEvent.pointerDown(outside);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps keyboard-focused tooltips visible after pointer leave", () => {
    render(
      <Tooltip content="Quick Actions">
        <button type="button">Trigger</button>
      </Tooltip>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });

    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Quick Actions");

    fireEvent.mouseLeave(trigger);

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
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

  it("renders structured ReactNode tooltip content", () => {
    render(
      <Tooltip
        content={
          <>
            <div>OpenAI</div>
            <div>Summary: Active</div>
            <div>Reason: Provider matched requested model</div>
          </>
        }
      >
        <button type="button">Trigger</button>
      </Tooltip>
    );

    const trigger = screen.getByRole("button", { name: "Trigger" });
    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("OpenAI");
    expect(tooltip).toHaveTextContent("Summary: Active");
    expect(tooltip).toHaveTextContent("Reason: Provider matched requested model");
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

  it("places the tooltip below the trigger when there is not enough room above", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute("role") === "tooltip") {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 96,
          bottom: 24,
          width: 96,
          height: 24,
          toJSON: () => ({}),
        } as DOMRect;
      }

      return {
        x: 120,
        y: 12,
        top: 12,
        left: 120,
        right: 160,
        bottom: 44,
        width: 40,
        height: 32,
        toJSON: () => ({}),
      } as DOMRect;
    });
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 768);

    render(
      <Tooltip content="Settings">
        <button type="button">Trigger</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Trigger" }));

    expect(screen.getByRole("tooltip")).toHaveStyle({
      top: "52px",
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
