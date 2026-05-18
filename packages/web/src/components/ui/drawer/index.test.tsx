import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Drawer } from ".";

const activeElementState = {
  current: null as HTMLElement | null,
};

const originalFocus = HTMLElement.prototype.focus;

function DrawerFixture(props: {
  ariaLabel?: string;
  backdropDismiss?: boolean;
  className?: string;
  dismissible?: boolean;
  footer?: ReactNode;
  headerActions?: ReactNode;
  initialFocus?: HTMLElement | null | (() => HTMLElement | null);
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  title?: React.ReactNode;
}) {
  const {
    ariaLabel,
    backdropDismiss,
    className,
    dismissible,
    footer,
    headerActions,
    initialFocus,
    onOpenChange = vi.fn(),
    open = true,
  } = props;
  const title = Object.prototype.hasOwnProperty.call(props, "title")
    ? props.title
    : "Worktree details";

  return (
    <Drawer
      ariaLabel={ariaLabel}
      backdropDismiss={backdropDismiss}
      className={className}
      dismissible={dismissible}
      footer={footer}
      headerActions={headerActions}
      initialFocus={initialFocus}
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    >
      <button type="button">Body action</button>
    </Drawer>
  );
}

describe("Drawer", () => {
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

  it("renders a portaled modal drawer with an accessible name and right-side panel shell", () => {
    const { container } = render(<DrawerFixture />);

    const dialog = screen.getByRole("dialog", { name: "Worktree details" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("drawer-panel");
    expect(container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
    expect(document.body.querySelector(".drawer-backdrop")).toBeTruthy();
  });

  it("supports ariaLabel when title is omitted", () => {
    render(<DrawerFixture ariaLabel="Workspace launcher" title={undefined} />);

    expect(screen.getByRole("dialog", { name: "Workspace launcher" })).toBeInTheDocument();
  });

  it("renders header actions and footer content", () => {
    render(
      <DrawerFixture
        footer={<button type="button">Save</button>}
        headerActions={<button type="button">Close</button>}
      />
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("moves focus into the drawer, locks body scroll, and restores both on close", async () => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.textContent = "Open drawer";
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(<DrawerFixture footer={<button type="button">Save</button>} />);

    const bodyAction = await screen.findByRole("button", { name: "Body action" });

    await waitFor(() => {
      expect(bodyAction).toHaveFocus();
    });
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<DrawerFixture open={false} />);

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
    expect(document.body.style.overflow).toBe("");
  });

  it("supports initialFocus targets", async () => {
    const preferredButton = createRef<HTMLButtonElement>();

    render(
      <Drawer
        initialFocus={() => preferredButton.current}
        onOpenChange={vi.fn()}
        open
        title="Worktree details"
      >
        <button ref={preferredButton} type="button">
          Preferred action
        </button>
        <button type="button">Body action</button>
      </Drawer>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Preferred action" })).toHaveFocus();
    });
  });

  it("closes on Escape but not on backdrop click by default", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<DrawerFixture onOpenChange={onOpenChange} />);

    await user.click(document.body.querySelector(".drawer-backdrop") as HTMLElement);
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("supports opt-in backdrop dismissal", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<DrawerFixture backdropDismiss onOpenChange={onOpenChange} />);

    await user.click(document.body.querySelector(".drawer-backdrop") as HTMLElement);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("respects dismissible=false for Escape and backdrop click", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<DrawerFixture backdropDismiss dismissible={false} onOpenChange={onOpenChange} />);

    await user.click(document.body.querySelector(".drawer-backdrop") as HTMLElement);
    await user.keyboard("{Escape}");

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
