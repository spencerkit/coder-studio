import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchLayer } from ".";

const activeElementState = {
  current: null as HTMLElement | null,
};

const originalFocus = HTMLElement.prototype.focus;

function WorkbenchLayerFixture(props: {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children?: ReactNode;
  className?: string;
  dismissible?: boolean;
  initialFocus?: HTMLElement | null | (() => HTMLElement | null);
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  const {
    ariaLabel = "Command Palette",
    ariaLabelledBy,
    children = <button type="button">Palette action</button>,
    className,
    dismissible,
    initialFocus,
    onOpenChange = vi.fn(),
    open = true,
  } = props;

  return (
    <WorkbenchLayer
      ariaLabel={ariaLabelledBy ? undefined : ariaLabel}
      ariaLabelledBy={ariaLabelledBy}
      className={className}
      dismissible={dismissible}
      initialFocus={initialFocus}
      onOpenChange={onOpenChange}
      open={open}
    >
      {children}
    </WorkbenchLayer>
  );
}

describe("WorkbenchLayer", () => {
  beforeEach(() => {
    activeElementState.current = document.body;
    document.body.style.overflow = "";

    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => activeElementState.current,
    });

    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      writable: true,
      value: function focus() {
        activeElementState.current = this;
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      writable: true,
      value: originalFocus,
    });
    delete (document as Document & { activeElement?: Element }).activeElement;
    document.body.style.overflow = "";
  });

  it("renders a portaled workbench dialog with an accessible name", () => {
    const { container } = render(<WorkbenchLayerFixture />);

    const dialog = screen.getByRole("dialog", { name: "Command Palette" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("workbench-layer");
    expect(container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
    expect(document.body.querySelector(".workbench-layer-backdrop")).toBeTruthy();
  });

  it("supports ariaLabelledBy naming", () => {
    render(
      <WorkbenchLayerFixture
        ariaLabelledBy="workbench-title"
        children={
          <>
            <h2 id="workbench-title">Open Workspace</h2>
            <button type="button">Palette action</button>
          </>
        }
      />
    );

    expect(screen.getByRole("dialog", { name: "Open Workspace" })).toBeInTheDocument();
  });

  it("moves focus into the layer, locks body scroll, and restores both on close", async () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.textContent = "Open workbench";
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(<WorkbenchLayerFixture />);

    const actionButton = await screen.findByRole("button", { name: "Palette action" });

    await waitFor(() => {
      expect(actionButton).toHaveFocus();
    });
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<WorkbenchLayerFixture open={false} />);

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
    expect(document.body.style.overflow).toBe("");
  });

  it("supports initialFocus targets", async () => {
    const preferredButton = createRef<HTMLButtonElement>();

    render(
      <WorkbenchLayer
        ariaLabel="Command Palette"
        initialFocus={() => preferredButton.current}
        onOpenChange={vi.fn()}
        open
      >
        <button ref={preferredButton} type="button">
          Preferred action
        </button>
        <button type="button">Palette action</button>
      </WorkbenchLayer>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preferred action" })).toHaveFocus();
    });
  });

  it("closes on outside click and Escape when dismissible", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<WorkbenchLayerFixture onOpenChange={onOpenChange} />);

    await user.click(document.body.querySelector(".workbench-layer-backdrop") as HTMLElement);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("respects dismissible=false for outside click and Escape", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<WorkbenchLayerFixture dismissible={false} onOpenChange={onOpenChange} />);

    await user.click(document.body.querySelector(".workbench-layer-backdrop") as HTMLElement);
    await user.keyboard("{Escape}");

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
