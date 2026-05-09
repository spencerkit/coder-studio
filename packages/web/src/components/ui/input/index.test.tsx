import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "..";

describe("Input", () => {
  it("renders a single-line text input via the public UI barrel", () => {
    render(<Input aria-label="Workspace name" defaultValue="demo" />);

    const input = screen.getByRole("textbox", { name: "Workspace name" });
    expect(input).toHaveValue("demo");
    expect(input).toHaveClass("input");
  });

  it("preserves legacy compatibility classes and caller className", () => {
    render(<Input aria-label="Password" className="auth-input" size="lg" type="password" />);

    expect(screen.getByLabelText("Password")).toHaveClass("input", "input-lg", "auth-input");
  });

  it("keeps visual sizing separate from the native input size attribute", () => {
    render(<Input aria-label="Branch name" htmlSize={24} size="sm" />);

    expect(screen.getByLabelText("Branch name")).toHaveAttribute("size", "24");
    expect(screen.getByLabelText("Branch name")).toHaveClass("input", "input-sm");
  });

  it("supports invalid styling through aria-invalid", () => {
    render(<Input aria-invalid="true" aria-label="Timeout" />);

    expect(screen.getByLabelText("Timeout")).toHaveAttribute("aria-invalid", "true");
  });
});
