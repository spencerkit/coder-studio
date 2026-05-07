import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from ".";

describe("Spinner", () => {
  it("renders an accessible spinner with the default size", () => {
    render(<Spinner label="Loading" data-testid="spinner" />);

    const spinner = screen.getByRole("status", { name: "Loading" });
    expect(spinner.tagName).toBe("SPAN");
    expect(spinner).toHaveClass("animate-spin");
    expect(spinner.style.getPropertyValue("--spinner-size")).toBe("16px");
  });

  it("supports all size variants", () => {
    render(
      <>
        <Spinner label="Loading small" size="sm" data-testid="spinner-sm" />
        <Spinner label="Loading medium" size="md" data-testid="spinner-md" />
        <Spinner label="Loading large" size="lg" data-testid="spinner-lg" />
      </>
    );

    expect(screen.getByTestId("spinner-sm").style.getPropertyValue("--spinner-size")).toBe("12px");
    expect(screen.getByTestId("spinner-md").style.getPropertyValue("--spinner-size")).toBe("16px");
    expect(screen.getByTestId("spinner-lg").style.getPropertyValue("--spinner-size")).toBe("20px");
  });

  it("preserves animate-spin and custom compatibility classes", () => {
    render(<Spinner label="Syncing" className="directory-spinner" data-testid="spinner" />);

    expect(screen.getByTestId("spinner")).toHaveClass("animate-spin", "directory-spinner");
  });
});
