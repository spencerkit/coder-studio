import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle } from ".";

const activeElementState = {
  current: null as HTMLElement | null,
};

const originalFocus = HTMLElement.prototype.focus;

function ModalFixture(props: {
  className?: string;
  dismissible?: boolean;
  initialFocus?: HTMLElement | null | (() => HTMLElement | null);
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  size?: "sm" | "md" | "lg" | "full";
}) {
  const { className, dismissible, initialFocus, onOpenChange = vi.fn(), open = true, size } = props;

  return (
    <Modal
      className={className}
      dismissible={dismissible}
      initialFocus={initialFocus}
      onOpenChange={onOpenChange}
      open={open}
      size={size}
    >
      <ModalHeader>
        <ModalTitle>Workspace details</ModalTitle>
      </ModalHeader>
      <ModalBody>Body</ModalBody>
      <ModalFooter>
        <button type="button">Cancel</button>
        <button type="button">Continue</button>
      </ModalFooter>
    </Modal>
  );
}

describe("Modal", () => {
  beforeEach(() => {
    activeElementState.current = document.body;

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
  });

  it("renders a modal dialog with aria-modal through document.body", () => {
    const { container } = render(<ModalFixture />);

    const dialog = screen.getByRole("dialog", { name: "Workspace details" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
  });

  it("applies the large card variant for size='lg'", () => {
    render(<ModalFixture size="lg" />);

    expect(screen.getByRole("dialog")).toHaveClass("modal-card", "modal-card-lg");
  });

  it("closes on overlay click and Escape when dismissible", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<ModalFixture onOpenChange={onOpenChange} />);

    const overlay = document.body.querySelector(".modal-overlay");
    expect(overlay).toBeTruthy();

    await user.click(overlay as HTMLElement);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not close on overlay click or Escape when dismissible is false", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<ModalFixture dismissible={false} onOpenChange={onOpenChange} />);

    await user.click(document.body.querySelector(".modal-overlay") as HTMLElement);
    await user.keyboard("{Escape}");

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog, traps tab navigation, and restores focus on close", async () => {
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.textContent = "Open modal";
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(<ModalFixture />);

    const cancelButton = await screen.findByRole("button", { name: "Cancel" });
    const continueButton = screen.getByRole("button", { name: "Continue" });

    await waitFor(() => {
      expect(cancelButton).toHaveFocus();
    });

    await user.tab();
    expect(continueButton).toHaveFocus();

    await user.tab();
    expect(cancelButton).toHaveFocus();

    rerender(<ModalFixture open={false} />);

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it("supports initialFocus targets", async () => {
    const initialFocusTarget = createRef<HTMLButtonElement>();

    render(
      <Modal
        open
        dismissible={false}
        initialFocus={() => initialFocusTarget.current}
        onOpenChange={vi.fn()}
      >
        <ModalHeader>
          <ModalTitle>Workspace details</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <button ref={initialFocusTarget} type="button">
            Preferred action
          </button>
          <button type="button">Focusable body action</button>
        </ModalBody>
      </Modal>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preferred action" })).toHaveFocus();
    });
  });
});
