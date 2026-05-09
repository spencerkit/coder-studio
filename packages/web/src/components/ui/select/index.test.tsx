import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "..";

const options = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
] as const;

describe("Select", () => {
  it("renders a native select via the public UI barrel", () => {
    render(
      <Select aria-label="Evaluator" options={options} value="claude" onValueChange={vi.fn()} />
    );

    const select = screen.getByRole("combobox", { name: "Evaluator" });
    expect(select).toHaveValue("claude");
    expect(select).toHaveClass("input");
  });

  it("preserves legacy compatibility classes and reports value changes", () => {
    const onValueChange = vi.fn();

    render(
      <Select
        aria-label="Provider"
        className="settings-input-compact"
        options={options}
        size="lg"
        value="claude"
        onValueChange={onValueChange}
      />
    );

    const select = screen.getByRole("combobox", { name: "Provider" });
    expect(select).toHaveClass("input", "input-lg", "settings-input-compact");

    fireEvent.change(select, { target: { value: "codex" } });
    expect(onValueChange).toHaveBeenCalledWith("codex");
  });

  it("keeps visual sizing separate from the native select size attribute", () => {
    render(
      <Select aria-label="Provider" htmlSize={4} options={options} size="sm" value="claude" />
    );

    const select = screen.getByLabelText("Provider");
    expect(select).toHaveAttribute("size", "4");
    expect(select).toHaveClass("input", "input-sm");
  });

  it("preserves helper text linkage and invalid semantics in native mode", () => {
    render(
      <>
        <label htmlFor="provider-select">Provider</label>
        <Select
          id="provider-select"
          aria-describedby="provider-helper"
          invalid
          options={options}
          value="claude"
          onValueChange={vi.fn()}
        />
        <span id="provider-helper">Choose a provider</span>
      </>
    );

    const select = screen.getByRole("combobox", { name: "Provider" });
    expect(select).toHaveAttribute("aria-describedby", "provider-helper");
    expect(select).toHaveAttribute("aria-invalid", "true");
  });

  it("renders the mobile trigger mode with dialog semantics and current value naming", () => {
    const onOpen = vi.fn();

    render(
      <>
        <label id="evaluator-label" htmlFor="evaluator-provider-trigger">
          Evaluator
        </label>
        <Select
          mobile
          id="evaluator-provider-trigger"
          aria-labelledby="evaluator-label"
          aria-describedby="evaluator-helper"
          options={options}
          value="codex"
          onOpen={onOpen}
        />
        <span id="evaluator-helper">Choose a provider</span>
      </>
    );

    const trigger = screen.getByRole("button", { name: "Evaluator Codex" });
    expect(trigger).toHaveClass("input", "mobile-select-trigger");
    expect(trigger).toHaveAttribute("aria-describedby", "evaluator-helper");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");

    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps aria-label context in mobile mode and generates unique value ids", () => {
    render(
      <>
        <Select
          mobile
          aria-label="Primary evaluator"
          options={options}
          value="claude"
          onOpen={vi.fn()}
        />
        <Select
          mobile
          aria-label="Secondary evaluator"
          options={options}
          value="codex"
          onOpen={vi.fn()}
        />
      </>
    );

    const primaryTrigger = screen.getByRole("button", { name: "Primary evaluator Claude" });
    const secondaryTrigger = screen.getByRole("button", { name: "Secondary evaluator Codex" });
    const primaryValueId = primaryTrigger.querySelector("span")?.id;
    const secondaryValueId = secondaryTrigger.querySelector("span")?.id;

    expect(primaryValueId).toBeTruthy();
    expect(secondaryValueId).toBeTruthy();
    expect(primaryValueId).not.toBe(secondaryValueId);
  });

  it("does not open the mobile trigger when disabled", () => {
    const onOpen = vi.fn();

    render(
      <Select
        mobile
        aria-label="Evaluator"
        disabled
        options={options}
        value="codex"
        onOpen={onOpen}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Evaluator Codex" }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
