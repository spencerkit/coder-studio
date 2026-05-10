import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from ".";

describe("SegmentedControl", () => {
  it("renders controlled tablist and tab semantics with caller classes", () => {
    const onChange = vi.fn();

    render(
      <SegmentedControl
        aria-label="Providers"
        className="settings-provider-tabs"
        onChange={onChange}
        optionClassName="settings-provider-tab"
        options={[
          { label: "Claude", value: "claude" },
          { label: "Codex", value: "codex" },
        ]}
        value="claude"
      />
    );

    expect(screen.getByRole("tablist", { name: "Providers" })).toHaveClass(
      "settings-provider-tabs"
    );
    expect(screen.getByRole("tab", { name: "Claude" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Claude" })).toHaveClass("settings-provider-tab");
    expect(screen.getByRole("tab", { name: "Codex" })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange on click and keyboard navigation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SegmentedControl
        aria-label="Providers"
        onChange={onChange}
        options={[
          { label: "Claude", value: "claude" },
          { label: "Codex", value: "codex" },
        ]}
        value="claude"
      />
    );

    await user.click(screen.getByRole("tab", { name: "Codex" }));
    expect(onChange).toHaveBeenCalledWith("codex");

    const claudeTab = screen.getByRole("tab", { name: "Claude" });
    claudeTab.focus();
    fireEvent.keyDown(claudeTab, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith("codex");
  });

  it("supports size variants without caller padding classes", () => {
    render(
      <SegmentedControl
        aria-label="Shortcut categories"
        optionClassName="shortcuts-category-tab"
        options={[
          { label: "Global", value: "global" },
          { label: "Workspace", value: "workspace" },
        ]}
        size="sm"
        value="global"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole("tab", { name: "Global" }).dataset.size).toBe("sm");
  });

  it("keeps explicit aria-label on the rendered tablist", () => {
    render(
      <SegmentedControl
        aria-label="Provider details"
        onChange={vi.fn()}
        options={[
          { label: "Base", value: "base" },
          { label: "Config", value: "config" },
        ]}
        value="base"
      />
    );

    expect(screen.getByRole("tablist", { name: "Provider details" })).toBeInTheDocument();
  });

  it("works as a controlled wrapper", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState("claude");

      return (
        <SegmentedControl
          aria-label="Providers"
          onChange={setValue}
          options={[
            { label: "Claude", value: "claude" },
            { label: "Codex", value: "codex" },
          ]}
          value={value}
        />
      );
    }

    render(<Harness />);

    await user.click(screen.getByRole("tab", { name: "Codex" }));

    expect(screen.getByRole("tab", { name: "Codex" })).toHaveAttribute("aria-selected", "true");
  });

  it("falls back to the first enabled option when the controlled value is missing", () => {
    render(
      <SegmentedControl
        aria-label="Providers"
        onChange={vi.fn()}
        options={[
          { label: "Claude", value: "claude" },
          { disabled: true, label: "Codex", value: "codex" },
        ]}
        value="missing"
      />
    );

    expect(screen.getByRole("tab", { name: "Claude" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Claude" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Codex" })).toHaveAttribute("aria-selected", "false");
  });
});
