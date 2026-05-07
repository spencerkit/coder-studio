import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Textarea } from "..";

describe("Textarea", () => {
  afterEach(() => {
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
  });

  it("renders a textarea via the public UI barrel", () => {
    render(<Textarea aria-label="Objective" defaultValue="Ship it" rows={5} />);

    const textarea = screen.getByRole("textbox", { name: "Objective" });
    expect(textarea).toHaveValue("Ship it");
    expect(textarea).toHaveAttribute("rows", "5");
    expect(textarea).not.toHaveAttribute("aria-invalid");
    expect(textarea).toHaveClass("input", "textarea");
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

  it("resizes to match content when autoResize is enabled", () => {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      value: 144,
    });

    function ControlledTextarea() {
      const [value, setValue] = useState("");
      return (
        <Textarea
          aria-label="Resizable objective"
          autoResize
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }

    render(<ControlledTextarea />);

    const textarea = screen.getByRole("textbox", { name: "Resizable objective" });
    fireEvent.change(textarea, { target: { value: "Ship the slice." } });

    expect(textarea).toHaveStyle({ height: "144px" });
  });

  it("forwards refs to the native textarea element", () => {
    const ref = createRef<HTMLTextAreaElement>();

    render(<Textarea aria-label="Ref objective" ref={ref} />);

    expect(ref.current).toBe(screen.getByRole("textbox", { name: "Ref objective" }));
  });
});
