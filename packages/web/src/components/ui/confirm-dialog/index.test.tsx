import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from ".";

const activeElementState = {
  current: null as HTMLElement | null,
};

const originalFocus = HTMLElement.prototype.focus;

describe("ConfirmDialog", () => {
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

  it("renders through the shared modal with default primary confirm styling", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Archive workspace"
        description="This will archive the current workspace."
        confirmText="Archive"
        cancelText="Cancel"
        onConfirm={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Archive workspace" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Archive" })).toHaveClass("btn", "btn-primary");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("btn", "btn-secondary");
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("btn", "btn-ghost", "btn-sm");
  });

  it("renders a destructive confirm button and warning icon by default for tone='danger'", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Delete file"
        description="This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        tone="danger"
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("btn", "btn-danger");
    const header = screen.getByText("Delete file").closest(".modal-header");
    expect(header?.querySelector(".confirmDialogHeaderLeading")).toBeTruthy();
    expect(header?.querySelector(".confirmDialogHeaderIcon")).toBeTruthy();
    expect(header?.querySelector(".confirmDialogHeaderCopy")).toBeTruthy();
    expect(
      header?.querySelector(".confirmDialogHeaderIcon [data-icon-semantic='state.warning']")
    ).toBeTruthy();
    expect(
      screen
        .getByText("Delete file")
        .closest(".modal-title")
        ?.querySelector('[data-icon-semantic="state.warning"]')
    ).toBeNull();
  });

  it("accepts rich ReactNode descriptions", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Discard changes"
        description={
          <>
            <p>Discard changes to `src/app.tsx`?</p>
            <p>This action cannot be undone.</p>
          </>
        }
        confirmText="Discard"
        cancelText="Cancel"
        tone="danger"
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("Discard changes to `src/app.tsx`?")).toBeInTheDocument();
    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
  });

  it("supports confirmButtonProps and confirmDisabled", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Delete file"
        description="This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        tone="danger"
        confirmDisabled
        confirmButtonProps={{ className: "danger-action", "data-testid": "confirm-button" }}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByTestId("confirm-button")).toBeDisabled();
    expect(screen.getByTestId("confirm-button")).toHaveClass("btn", "btn-danger", "danger-action");
  });

  it("routes close interactions through onOpenChange(false)", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete file"
        description="This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        tone="danger"
        onConfirm={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(document.body.querySelector(".modal-overlay") as HTMLElement);
    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledTimes(4);
    expect(onOpenChange).toHaveBeenNthCalledWith(1, false);
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false);
    expect(onOpenChange).toHaveBeenNthCalledWith(3, false);
    expect(onOpenChange).toHaveBeenNthCalledWith(4, false);
  });

  it("respects dismissible=false for overlay, escape, and close affordances", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <ConfirmDialog
        open
        dismissible={false}
        onOpenChange={onOpenChange}
        title="Delete file"
        description="This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        tone="danger"
        onConfirm={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();

    await user.click(document.body.querySelector(".modal-overlay") as HTMLElement);
    await user.keyboard("{Escape}");

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("can keep a visible but disabled close button while dismiss interactions stay locked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <ConfirmDialog
        open
        dismissible={false}
        cancelDisabled
        closeDisabled
        onOpenChange={onOpenChange}
        title="Sync in progress"
        description="Please wait for the current action to finish."
        confirmText="Push"
        cancelText="Cancel"
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await user.click(document.body.querySelector(".modal-overlay") as HTMLElement);
    await user.keyboard("{Escape}");

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("invokes onConfirm without auto-closing and supports className and closeLabel", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ConfirmDialog
        open
        className="confirm-shell"
        closeLabel="Dismiss"
        onOpenChange={onOpenChange}
        title="Delete file"
        description="This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        tone="danger"
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("dialog")).toHaveClass("confirm-shell");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
