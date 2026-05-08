import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { Select } from ".";

const viewportMocks = vi.hoisted(() => ({
  viewport: "desktop" as "desktop" | "mobile",
}));

vi.mock("../_internal/use-viewport", () => ({
  useViewport: () => viewportMocks.viewport,
}));

function renderWithEnglishLocale(node: ReactNode) {
  const store = createStore();
  store.set(localeAtom, "en");

  return render(<Provider store={store}>{node}</Provider>);
}

afterEach(() => {
  viewportMocks.viewport = "desktop";
});

describe("Select", () => {
  it("renders a desktop trigger button and selects an option from the listbox", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderWithEnglishLocale(
      <Select
        aria-label="Evaluator"
        options={[
          { label: "Claude", value: "claude" },
          { label: "Codex", value: "codex" },
        ]}
        value="claude"
        onChange={onChange}
      />
    );

    const trigger = screen.getByRole("button", { name: "Evaluator Claude" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "Evaluator" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(listbox).getByRole("option", { name: "Claude" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await user.click(within(listbox).getByRole("option", { name: "Codex" }));

    expect(onChange).toHaveBeenCalledWith("codex");
  });

  it("supports desktop keyboard open, navigation, selection, and escape close", () => {
    const onChange = vi.fn();

    renderWithEnglishLocale(
      <Select
        aria-label="Evaluator"
        options={[
          { label: "Claude", value: "claude" },
          { label: "Codex", value: "codex" },
          { label: "Disabled", value: "disabled", disabled: true },
        ]}
        value="claude"
        onChange={onChange}
      />
    );

    const trigger = screen.getByRole("button", { name: "Evaluator Claude" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    expect(screen.getByRole("listbox", { name: "Evaluator" })).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("codex");

    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(screen.queryByRole("listbox", { name: "Evaluator" })).toBeNull();
  });

  it("renders a mobile trigger with legacy compatibility classes and opens a sheet", async () => {
    viewportMocks.viewport = "mobile";
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderWithEnglishLocale(
      <Select
        aria-label="Evaluator"
        className="mobile-select-trigger"
        iconClassName="mobile-select-trigger__icon"
        options={[
          { label: "Claude", value: "claude" },
          { label: "Codex", value: "codex" },
        ]}
        value="claude"
        valueClassName="mobile-select-trigger__value"
        onChange={onChange}
      />
    );

    const trigger = screen.getByRole("button", { name: "Evaluator Claude" });
    expect(trigger).toHaveClass("input", "mobile-select-trigger");
    expect(trigger.querySelector(".mobile-select-trigger__value")).not.toBeNull();
    expect(trigger.querySelector(".mobile-select-trigger__icon")).not.toBeNull();

    await user.click(trigger);

    expect(screen.getByRole("region", { name: "Evaluator sheet" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Codex" }));

    expect(onChange).toHaveBeenCalledWith("codex");
  });

  it("falls back to the first enabled option when the controlled value is missing", async () => {
    viewportMocks.viewport = "mobile";
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderWithEnglishLocale(
      <Select
        aria-label="Evaluator"
        options={[
          { label: "Disabled", value: "disabled", disabled: true },
          { label: "Claude", value: "claude" },
          { label: "Codex", value: "codex" },
        ]}
        value="missing"
        onChange={onChange}
      />
    );

    expect(screen.getByRole("button", { name: "Evaluator Claude" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Evaluator Claude" }));

    expect(screen.getByRole("button", { name: "Claude" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Disabled" })).toBeDisabled();
  });

  it("does not allow disabled options to be selected", async () => {
    viewportMocks.viewport = "mobile";
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderWithEnglishLocale(
      <Select
        aria-label="Evaluator"
        options={[
          { label: "Claude", value: "claude" },
          { label: "Codex", value: "codex", disabled: true },
        ]}
        value="claude"
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "Evaluator Claude" }));
    await user.click(screen.getByRole("button", { name: "Codex" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
