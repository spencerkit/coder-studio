import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tag } from ".";

describe("Tag", () => {
  it("renders a neutral medium tag by default", () => {
    render(<Tag>Idle</Tag>);

    expect(screen.getByText("Idle")).toHaveClass("badge", "badge-gray");
  });

  it("supports semantic colors", () => {
    render(<Tag color="green">Running</Tag>);

    expect(screen.getByText("Running")).toHaveClass("badge", "badge-green");
  });

  it("supports the small size variant", () => {
    render(<Tag size="sm">Draft</Tag>);

    expect(screen.getByText("Draft")).toHaveClass("badge");
  });

  it("preserves the shared badge compatibility class for non-wrapping status chips", () => {
    render(<Tag color="blue">In progress</Tag>);

    expect(screen.getByText("In progress")).toHaveClass("badge");
  });

  it("can disable uppercase text transform", () => {
    render(
      <>
        <Tag>Remote default</Tag>
        <Tag caps={false}>Remote</Tag>
      </>
    );

    expect(screen.getByText("Remote").className).not.toBe(
      screen.getByText("Remote default").className
    );
  });

  it("preserves legacy compatibility classes for migrated callers", () => {
    render(
      <Tag color="blue" className="session-provider-badge">
        Codex
      </Tag>
    );

    expect(screen.getByText("Codex")).toHaveClass("badge", "badge-blue", "session-provider-badge");
  });
});
