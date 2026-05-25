import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusDot } from ".";

describe("StatusDot", () => {
  it("renders a neutral medium dot by default", () => {
    render(<StatusDot data-testid="dot" />);

    const dot = screen.getByTestId("dot");
    expect(dot.style.getPropertyValue("--status-dot-tone-color")).toBe("var(--status-dot-idle)");
    expect(dot.style.getPropertyValue("--status-dot-tone-ring")).toBe(
      "var(--status-dot-idle-ring)"
    );
    expect(dot.style.getPropertyValue("--status-dot-current-color")).toBe("");
    expect(dot.style.getPropertyValue("--status-dot-current-size")).toBe("8px");
    expect(dot).toHaveAttribute("aria-hidden", "true");
  });

  it("supports tone, size, and pulse variants", () => {
    render(<StatusDot tone="warning" size="lg" pulse data-testid="dot" />);

    const dot = screen.getByTestId("dot");
    expect(dot.style.getPropertyValue("--status-dot-tone-color")).toBe(
      "var(--status-dot-starting)"
    );
    expect(dot.style.getPropertyValue("--status-dot-tone-ring")).toBe(
      "var(--status-dot-starting-ring)"
    );
    expect(dot.style.getPropertyValue("--status-dot-current-size")).toBe("10px");
    expect(dot.className).toContain("pulse");
  });

  it("preserves legacy session compatibility classes for migrated callers", () => {
    render(
      <StatusDot
        tone="error"
        className="session-dot session-dot-running session-header-indicator"
        data-testid="dot"
      />
    );

    const dot = screen.getByTestId("dot");
    expect(dot).toHaveClass("session-dot", "session-dot-running", "session-header-indicator");
    expect(dot.style.getPropertyValue("--status-dot-tone-color")).toBe("var(--status-dot-error)");
    expect(dot.style.getPropertyValue("--status-dot-tone-ring")).toBe(
      "var(--status-dot-error-ring)"
    );
  });

  it("preserves legacy connection compatibility classes for migrated callers", () => {
    render(
      <StatusDot
        tone="success"
        size="sm"
        className="connection-status-dot connection-status-dot-disconnected"
        data-testid="dot"
      />
    );

    const dot = screen.getByTestId("dot");
    expect(dot).toHaveClass("connection-status-dot", "connection-status-dot-disconnected");
    expect(dot.style.getPropertyValue("--status-dot-current-size")).toBe("6px");
    expect(dot.style.getPropertyValue("--status-dot-tone-color")).toBe(
      "var(--status-dot-complete)"
    );
    expect(dot.style.getPropertyValue("--status-dot-tone-ring")).toBe(
      "var(--status-dot-complete-ring)"
    );
  });

  it("allows running session dots to combine legacy classes with the shared pulse variant", () => {
    render(<StatusDot pulse className="session-dot session-dot-running" data-testid="dot" />);

    const dot = screen.getByTestId("dot");

    expect(dot).toHaveClass("session-dot", "session-dot-running");
    expect(dot.className).toContain("pulse");
    expect(dot.style.getPropertyValue("--status-dot-tone-color")).toBe("var(--status-dot-idle)");
    expect(dot.style.getPropertyValue("--status-dot-tone-ring")).toBe(
      "var(--status-dot-idle-ring)"
    );
  });
});
