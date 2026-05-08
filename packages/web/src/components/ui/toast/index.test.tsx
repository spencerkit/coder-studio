import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckCircle } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Toast, ToastViewport } from ".";

describe("ToastViewport", () => {
  it("renders desktop and mobile compatibility classes", () => {
    const { rerender } = render(<ToastViewport>Desktop toast</ToastViewport>);

    expect(document.querySelector(".toast-container")).toBeTruthy();
    expect(document.querySelector(".toast-container--mobile")).toBeFalsy();

    rerender(<ToastViewport mobile>Mobile toast</ToastViewport>);

    expect(document.querySelector(".toast-container")).toBeTruthy();
    expect(document.querySelector(".toast-container--mobile")).toBeTruthy();
  });
});

describe("Toast", () => {
  it("renders compatibility classes, title, description, and icon content", () => {
    render(
      <Toast
        description={"Claude · demo · 1m\nSummary"}
        icon={<CheckCircle aria-hidden="true" data-testid="toast-icon" size={16} />}
        onDismiss={vi.fn()}
        title="Session done"
        tone="success"
      />
    );

    const toast = screen.getByText("Session done").closest(".toast");
    expect(toast).toHaveClass("toast", "toast--success");
    expect(screen.getByTestId("toast-icon").closest(".toast__icon")).toBeTruthy();
    expect(screen.getByText("Session done")).toHaveClass("toast__title");
    expect(document.querySelector(".toast__body")).toHaveClass("toast__body");
    expect(document.querySelector(".toast__body")).toHaveTextContent(
      /Claude · demo · 1m\s+Summary/
    );
  });

  it("invokes onDismiss from the close button and honors closeLabel", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <Toast closeLabel="Close notification" onDismiss={onDismiss} title="Saved" tone="info" />
    );

    const closeButton = screen.getByRole("button", { name: "Close notification" });
    expect(closeButton).toHaveClass("toast__close");

    await user.click(closeButton);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("supports optional click and action handlers", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onAction = vi.fn();

    render(
      <Toast
        actionLabel="Open"
        onAction={onAction}
        onClick={onClick}
        onDismiss={vi.fn()}
        title="Build complete"
        tone="warning"
      />
    );

    await user.click(screen.getByText("Build complete").closest(".toast") as HTMLElement);
    expect(onClick).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not make clickable alerts keyboard-focusable or route nested button key activation through the root click handler", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onAction = vi.fn();
    const onDismiss = vi.fn();

    render(
      <Toast
        actionLabel="Open"
        onAction={onAction}
        onClick={onClick}
        onDismiss={onDismiss}
        title="Build complete"
        tone="warning"
      />
    );

    const toast = screen.getByRole("alert");
    const actionButton = screen.getByRole("button", { name: "Open" });
    const closeButton = screen.getByRole("button", { name: "Dismiss" });

    expect(toast).not.toHaveAttribute("tabindex");

    fireEvent.keyDown(actionButton, { key: "Enter" });
    fireEvent.keyDown(actionButton, { key: " " });

    expect(onClick).not.toHaveBeenCalled();

    await user.click(actionButton);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.keyDown(closeButton, { key: "Enter" });
    fireEvent.keyDown(closeButton, { key: " " });

    expect(onClick).not.toHaveBeenCalled();

    await user.click(closeButton);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
