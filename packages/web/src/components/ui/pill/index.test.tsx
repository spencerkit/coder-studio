import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Pill } from ".";

describe("Pill", () => {
  it("renders as a button with type button", () => {
    render(<Pill>Dark</Pill>);

    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("type", "button");
  });

  it("reflects active state via aria-pressed", () => {
    render(<Pill active>Light</Pill>);

    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });

  it("preserves legacy settings pill classes for migrated callers", () => {
    render(
      <Pill className="appearance-option" active>
        Standard
      </Pill>
    );

    expect(screen.getByRole("button", { name: "Standard" })).toHaveClass(
      "settings-pill",
      "settings-pill-active",
      "appearance-option"
    );
  });

  it("renders a leading icon when provided", () => {
    render(<Pill leadingIcon={<span data-testid="pill-icon">*</span>}>English</Pill>);

    expect(screen.getByTestId("pill-icon")).toBeInTheDocument();
    expect(screen.getByTestId("pill-icon").parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("respects disabled state and legacy disabled class", () => {
    render(<Pill disabled>Disabled</Pill>);

    expect(screen.getByRole("button", { name: "Disabled" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disabled" })).toHaveClass(
      "settings-pill",
      "settings-pill-disabled"
    );
    expect(screen.getByRole("button", { name: "Disabled" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("keeps selected as a compatibility alias for active", () => {
    render(<Pill selected>Legacy</Pill>);

    expect(screen.getByRole("button", { name: "Legacy" })).toHaveClass("settings-pill-active");
    expect(screen.getByRole("button", { name: "Legacy" })).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onClick when enabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<Pill onClick={onClick}>Chinese</Pill>);

    await user.click(screen.getByRole("button", { name: "Chinese" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
