import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Kbd } from ".";

describe("Kbd", () => {
  it("renders shortcut text inside a semantic kbd element", () => {
    render(<Kbd>Ctrl+K</Kbd>);

    expect(screen.getByText("Ctrl+K").tagName).toBe("KBD");
  });

  it("preserves the legacy shortcut class for migrated callers", () => {
    render(<Kbd className="binding-display">Cmd+P</Kbd>);

    expect(screen.getByText("Cmd+P")).toHaveClass("shortcuts-key", "binding-display");
  });

  it("supports the small size variant", () => {
    render(<Kbd size="sm">Esc</Kbd>);

    expect(screen.getByText("Esc")).toHaveClass("shortcuts-key");
  });

  it("supports interactive mode while preserving semantic kbd output", () => {
    render(
      <Kbd interactive onClick={() => undefined}>
        Enter
      </Kbd>
    );

    expect(screen.getByText("Enter").tagName).toBe("KBD");
    expect(screen.getByText("Enter")).toHaveAttribute("role", "button");
    expect(screen.getByText("Enter")).toHaveAttribute("tabindex", "0");
  });
});
