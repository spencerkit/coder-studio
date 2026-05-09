import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Textarea } from "..";

describe("Textarea", () => {
  it("renders a textarea via the public UI barrel", () => {
    render(<Textarea aria-label="Objective" defaultValue="Ship it" />);

    expect(screen.getByLabelText("Objective")).toHaveValue("Ship it");
    expect(screen.getByLabelText("Objective")).toHaveClass("input", "textarea");
  });

  it("preserves caller className and supports size variants", () => {
    render(<Textarea aria-label="Args" className="settings-provider-args-input" size="lg" />);

    expect(screen.getByLabelText("Args")).toHaveClass(
      "input",
      "textarea",
      "textarea-lg",
      "settings-provider-args-input"
    );
  });

  it("supports invalid styling through aria-invalid", () => {
    render(<Textarea aria-label="Draft" invalid />);

    expect(screen.getByLabelText("Draft")).toHaveAttribute("aria-invalid", "true");
  });

  it("owns textarea sizing instead of inheriting single-line input height", () => {
    render(<Textarea aria-label="Notes" rows={4} />);

    expect(screen.getByLabelText("Notes")).toHaveClass("input", "textarea");
    expect(screen.getByLabelText("Notes")).not.toHaveClass("textarea-lg");
  });
});
