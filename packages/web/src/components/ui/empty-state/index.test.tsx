import { render, screen } from "@testing-library/react";
import { Terminal } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EmptyState } from ".";

describe("EmptyState", () => {
  it("renders the shared shell with title, description, icon, action, and pass-through props", () => {
    render(
      <EmptyState
        action={<button type="button">Create</button>}
        aria-live="polite"
        className="custom-empty-state"
        data-testid="empty-state-root"
        description="Launch a shell to inspect files."
        icon={<Terminal aria-hidden="true" size={32} />}
        title="No terminals"
      />
    );

    const root = screen.getByTestId("empty-state-root");

    expect(root).toHaveClass("custom-empty-state");
    expect(root).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("No terminals")).toBeInTheDocument();
    expect(screen.getByText("Launch a shell to inspect files.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("lets callers compose compatibility classes while omitting optional slots", () => {
    render(
      <EmptyState
        className="git-diff-empty"
        data-testid="empty-state-root"
        title="Git"
        role="alert"
      />
    );

    const root = screen.getByTestId("empty-state-root");

    expect(root).toHaveClass("git-diff-empty");
    expect(root).toHaveAttribute("role", "alert");
    expect(screen.getByText("Git")).toBeInTheDocument();
    expect(screen.queryByText(/launch a shell/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
