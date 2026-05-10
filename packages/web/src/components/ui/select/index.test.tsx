import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "..";

const options = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
] as const;

const originalMatchMedia = window.matchMedia;

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

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

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

  it("renders the bounded desktop listbox mode and reports value changes", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <>
        <label id="evaluator-label" htmlFor="evaluator-trigger">
          Evaluator
        </label>
        <Select
          desktopMode="listbox"
          id="evaluator-trigger"
          mobileSheetTitle="Evaluator"
          aria-labelledby="evaluator-label"
          options={options}
          value="claude"
          onValueChange={onValueChange}
        />
      </>
    );

    await user.click(screen.getByRole("button", { name: "Evaluator Claude" }));

    const listbox = screen.getByRole("listbox", { name: "Evaluator" });
    expect(within(listbox).getByRole("option", { name: "Claude" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await user.click(within(listbox).getByRole("option", { name: "Codex" }));
    expect(onValueChange).toHaveBeenCalledWith("codex");
    expect(screen.queryByRole("listbox", { name: "Evaluator" })).toBeNull();
  });

  it("supports keyboard-driven open and selection in the bounded desktop listbox mode", () => {
    const onValueChange = vi.fn();

    render(
      <Select
        desktopMode="listbox"
        aria-label="Evaluator"
        mobileSheetTitle="Evaluator"
        options={options}
        value="claude"
        onValueChange={onValueChange}
      />
    );

    const trigger = screen.getByRole("button", { name: "Evaluator Claude" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const codexOption = screen.getByRole("option", { name: "Codex" });
    fireEvent.keyDown(codexOption, { key: "Enter" });

    expect(onValueChange).toHaveBeenCalledWith("codex");
    expect(screen.queryByRole("listbox", { name: "Evaluator" })).toBeNull();
  });

  it("closes the bounded desktop listbox mode on outside pointer dismissal", async () => {
    const user = userEvent.setup();

    render(
      <div>
        <Select
          desktopMode="listbox"
          aria-label="Evaluator"
          mobileSheetTitle="Evaluator"
          options={options}
          value="claude"
          onValueChange={vi.fn()}
        />
        <button type="button">Outside</button>
      </div>
    );

    await user.click(screen.getByRole("button", { name: "Evaluator Claude" }));
    expect(screen.getByRole("listbox", { name: "Evaluator" })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("listbox", { name: "Evaluator" })).toBeNull();
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

  it("can keep a fixed aria-label in mobile mode without appending the current value", () => {
    render(
      <Select
        mobile
        aria-label="Switch terminal"
        includeValueInAriaLabel={false}
        options={options}
        value="claude"
        onOpen={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: "Switch terminal" });
    expect(trigger).toHaveAccessibleName("Switch terminal");
  });

  it("renders the internal mobile-sheet mode and closes inline sheets via the default back action", async () => {
    const user = userEvent.setup();
    setMatchMediaMock(
      (query) => query.includes("max-width: 899px") || query.includes("pointer: coarse")
    );

    function TestHarness() {
      const [value, setValue] = useState<(typeof options)[number]["value"]>("claude");

      return (
        <Select
          desktopMode="listbox"
          mobileSheetTitle="Evaluator"
          mobileSheetPresentation="inline"
          aria-label="Evaluator"
          options={options}
          value={value}
          onValueChange={setValue}
        />
      );
    }

    render(<TestHarness />);

    await user.click(screen.getByRole("button", { name: "Evaluator Claude" }));
    expect(document.querySelector(".mobile-inline-sheet")).toBeTruthy();
    expect(document.querySelector(".mobile-inline-sheet .page-header__title")).toHaveTextContent(
      "Evaluator"
    );

    const backButton = document.querySelector(".page-header__back");
    expect(backButton).not.toBeNull();
    await user.click(backButton as HTMLElement);
    expect(document.querySelector(".mobile-inline-sheet")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Evaluator Claude" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));

    expect(screen.getByRole("button", { name: "Evaluator Codex" })).toBeInTheDocument();
    expect(document.querySelector(".mobile-inline-sheet")).toBeNull();
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
