import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Input } from ".";

describe("Input", () => {
  it("renders a medium input by default", () => {
    render(<Input aria-label="Password" placeholder="Password" />);

    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("placeholder", "Password");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("supports the three size options", () => {
    render(
      <>
        <Input aria-label="Small input" size="sm" />
        <Input aria-label="Medium input" size="md" />
        <Input aria-label="Large input" size="lg" />
      </>
    );

    expect(screen.getByLabelText("Small input")).toBeInTheDocument();
    expect(screen.getByLabelText("Medium input")).toBeInTheDocument();
    expect(screen.getByLabelText("Large input")).toBeInTheDocument();
  });

  it("marks invalid fields with aria-invalid", () => {
    render(<Input aria-label="Objective" invalid />);

    expect(screen.getByLabelText("Objective")).toHaveAttribute("aria-invalid", "true");
  });

  it("preserves legacy compatibility classes for migrated callers", () => {
    render(<Input aria-label="Auth password" className="auth-input" type="password" />);

    expect(screen.getByLabelText("Auth password")).toHaveClass("input", "auth-input");
  });

  it("forwards refs to the native input element", () => {
    const ref = createRef<HTMLInputElement>();

    render(<Input aria-label="Ref target" ref={ref} />);

    expect(ref.current).toBe(screen.getByLabelText("Ref target"));
  });
});
