import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from ".";

describe("IconButton", () => {
  it("renders a ghost icon button by default", () => {
    render(<IconButton aria-label="Close" icon={<span data-testid="icon">X</span>} />);

    const button = screen.getByRole("button", { name: "Close" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toBeEnabled();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("supports the two visual variants and three sizes", () => {
    render(
      <>
        <IconButton aria-label="Close small" icon={<span>X</span>} size="sm" />
        <IconButton aria-label="Close medium" icon={<span>X</span>} size="md" />
        <IconButton aria-label="Close large" icon={<span>X</span>} size="lg" />
        <IconButton aria-label="Close filled" icon={<span>X</span>} variant="filled" />
      </>
    );

    expect(screen.getByRole("button", { name: "Close small" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close medium" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close large" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close small" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm"
    );
    expect(screen.getByRole("button", { name: "Close large" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-lg"
    );
    expect(screen.getByRole("button", { name: "Close filled" })).toHaveClass(
      "btn",
      "btn-secondary"
    );
  });

  it("preserves legacy compatibility classes for migrated callers", () => {
    render(
      <IconButton
        aria-label="Dismiss"
        icon={<span>X</span>}
        variant="ghost"
        size="sm"
        className="modal-close"
      />
    );

    expect(screen.getByRole("button", { name: "Dismiss" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm",
      "modal-close"
    );
  });

  it("calls onClick when enabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<IconButton aria-label="Refresh" icon={<span>R</span>} onClick={onClick} />);

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
