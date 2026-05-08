import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from ".";

describe("ProgressBar", () => {
  it("renders determinate progress semantics, compatibility classes, and composed class names", () => {
    render(
      <ProgressBar
        aria-label="Session progress"
        className="custom-progress"
        data-testid="progress-root"
        fillClassName="custom-fill"
        max={100}
        tone="info"
        value={42}
      />
    );

    const progress = screen.getByTestId("progress-root");
    const fill = progress.firstElementChild;

    expect(progress).toHaveAttribute("role", "progressbar");
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "100");
    expect(progress).toHaveAttribute("aria-valuenow", "42");
    expect(progress).toHaveClass("custom-progress");
    expect(fill).toHaveClass("custom-fill");
    expect(fill).toHaveStyle({ "--progress-bar-width": "42%" });
  });

  it("clamps determinate progress width into the valid range", () => {
    const { rerender } = render(<ProgressBar max={100} tone="warning" value={140} />);

    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({
      "--progress-bar-width": "100%",
    });

    rerender(<ProgressBar max={100} tone="neutral" value={-5} />);

    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({
      "--progress-bar-width": "0%",
    });
  });

  it("omits aria-valuenow and width styles in indeterminate mode", () => {
    render(
      <ProgressBar
        aria-label="Loading session progress"
        data-testid="progress-root"
        indeterminate
        max={100}
        tone="success"
        value={25}
      />
    );

    const progress = screen.getByTestId("progress-root");
    const fill = progress.firstElementChild;

    expect(progress).toHaveAttribute("role", "progressbar");
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "100");
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(fill?.style.getPropertyValue("--progress-bar-width") ?? "").toBe("");
  });

  it("supports decorative usage via pass-through props without progressbar semantics", () => {
    render(
      <ProgressBar
        aria-hidden="true"
        data-testid="progress-root"
        max={100}
        tone="neutral"
        value={8}
      />
    );

    const progress = screen.getByTestId("progress-root");

    expect(progress).toHaveAttribute("aria-hidden", "true");
    expect(progress).not.toHaveAttribute("role");
    expect(progress).not.toHaveAttribute("aria-valuemin");
    expect(progress).not.toHaveAttribute("aria-valuemax");
    expect(progress).not.toHaveAttribute("aria-valuenow");
  });
});
