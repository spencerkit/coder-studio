import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Textarea } from ".";

describe("Textarea", () => {
  afterEach(() => {
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
  });

  it("renders a textarea by default", () => {
    render(<Textarea aria-label="Objective" rows={5} />);

    const textarea = screen.getByRole("textbox", { name: "Objective" });
    expect(textarea).toHaveAttribute("rows", "5");
    expect(textarea).not.toHaveAttribute("aria-invalid");
  });

  it("supports the size options", () => {
    render(
      <>
        <Textarea aria-label="Default objective" />
        <Textarea aria-label="Large objective" size="lg" />
      </>
    );

    expect(screen.getByRole("textbox", { name: "Default objective" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Large objective" })).toBeInTheDocument();
  });

  it("marks invalid fields with aria-invalid", () => {
    render(<Textarea aria-label="Error objective" invalid />);

    expect(screen.getByRole("textbox", { name: "Error objective" })).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("preserves legacy compatibility classes for migrated callers", () => {
    render(<Textarea aria-label="Dialog objective" className="supervisor-objective" />);

    expect(screen.getByRole("textbox", { name: "Dialog objective" })).toHaveClass(
      "input",
      "textarea",
      "supervisor-objective"
    );
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
