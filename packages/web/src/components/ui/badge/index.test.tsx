import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from ".";

describe("Badge", () => {
  it("renders a positive count", () => {
    render(<Badge count={3} />);

    expect(screen.getByText("3")).toHaveClass("topbar-unread");
  });

  it("does not render for zero or negative counts", () => {
    const { rerender } = render(<Badge count={0} />);

    expect(screen.queryByText("0")).not.toBeInTheDocument();

    rerender(<Badge count={-1} />);
    expect(screen.queryByText("-1")).not.toBeInTheDocument();
  });

  it("truncates to the provided max", () => {
    render(<Badge count={12} max={9} />);

    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("preserves caller classes for migrated usage", () => {
    render(<Badge count={4} className="workspace-unread" />);

    expect(screen.getByText("4")).toHaveClass("topbar-unread", "workspace-unread");
  });
});
