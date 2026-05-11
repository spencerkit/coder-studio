import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTimePicker } from "..";

function setMatchMediaMock(predicate: (query: string) => boolean) {
  const matchMedia = vi.fn((query: string) => ({
    matches: predicate(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
}

describe("DateTimePicker", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.localStorage.removeItem("ui.locale");
  });

  it("renders the trigger button with label and placeholder", () => {
    setMatchMediaMock(() => false);

    render(
      <DateTimePicker
        value=""
        onValueChange={vi.fn()}
        label="Scheduled At"
        placeholder="Select date and time"
      />
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Select date and time");
  });

  it("renders the current value formatted according to locale", () => {
    setMatchMediaMock(() => false);

    render(
      <DateTimePicker value="2026-05-11T14:30" onValueChange={vi.fn()} label="Scheduled At" />
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    expect(trigger).toHaveTextContent("May");
  });

  it("opens desktop popover on trigger click", () => {
    setMatchMediaMock(() => false);

    render(<DateTimePicker value="" onValueChange={vi.fn()} label="Scheduled At" />);

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Scheduled At" });
    expect(dialog).toBeInTheDocument();
  });

  it("calls onValueChange when confirm button is clicked", () => {
    setMatchMediaMock(() => false);

    const onValueChange = vi.fn();

    render(
      <DateTimePicker value="2026-05-11T14:30" onValueChange={onValueChange} label="Scheduled At" />
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    fireEvent.click(trigger);

    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    fireEvent.click(confirmButton);

    expect(onValueChange).toHaveBeenCalledWith("2026-05-11T14:30");
  });

  it("calls onValueChange with empty string when clear button is clicked", () => {
    setMatchMediaMock(() => false);

    const onValueChange = vi.fn();

    render(
      <DateTimePicker
        value="2026-05-11T14:30"
        onValueChange={onValueChange}
        label="Scheduled At"
        clearable
      />
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    fireEvent.click(trigger);

    const clearButton = screen.getByRole("button", { name: "Clear" });
    fireEvent.click(clearButton);

    expect(onValueChange).toHaveBeenCalledWith("");
  });

  it("applies invalid styling when invalid prop is true", () => {
    setMatchMediaMock(() => false);

    render(<DateTimePicker value="" onValueChange={vi.fn()} label="Scheduled At" invalid />);

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    expect(trigger).toHaveClass("input-invalid");
  });

  it("supports disabled state", () => {
    setMatchMediaMock(() => false);

    render(<DateTimePicker value="" onValueChange={vi.fn()} label="Scheduled At" disabled />);

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    expect(trigger).toBeDisabled();
  });

  it("opens mobile sheet on trigger click", () => {
    setMatchMediaMock(
      (query) => query.includes("max-width: 899px") || query.includes("pointer: coarse")
    );

    render(<DateTimePicker value="" onValueChange={vi.fn()} label="Scheduled At" />);

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    fireEvent.click(trigger);

    const region = screen.getByRole("region", { name: /Scheduled At/ });
    expect(region).toBeInTheDocument();
  });

  it("links aria-describedby when provided", () => {
    setMatchMediaMock(() => false);

    render(
      <>
        <DateTimePicker
          value=""
          onValueChange={vi.fn()}
          label="Scheduled At"
          aria-describedby="helper"
        />
        <span id="helper">Select execution time</span>
      </>
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    expect(trigger).toHaveAttribute("aria-describedby", "helper");
  });
});

describe("DateTimePicker popover rendering", () => {
  it("renders desktop popover content when viewport is desktop", () => {
    setMatchMediaMock(() => false);

    render(
      <DateTimePicker value="2026-05-11T14:30" onValueChange={vi.fn()} label="Scheduled At" />
    );

    const trigger = screen.getByRole("button", { name: "Scheduled At" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Scheduled At" });
    expect(dialog).toBeInTheDocument();

    // Verify popover content is rendered
    expect(dialog.className).toContain("content");
  });
});
