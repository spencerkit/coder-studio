import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Switch } from ".";

describe("Switch", () => {
  it("renders a button-based switch with the default medium size", () => {
    render(<Switch checked={false} aria-label="Notifications" onCheckedChange={vi.fn()} />);

    const switchControl = screen.getByRole("switch", { name: "Notifications" });
    expect(switchControl.tagName).toBe("BUTTON");
    expect(switchControl).toHaveAttribute("type", "button");
    expect(switchControl).toHaveAttribute("aria-checked", "false");
    expect(switchControl.style.getPropertyValue("--switch-track-width")).toBe("36px");
  });

  it("reflects the checked state", () => {
    render(<Switch checked aria-label="Notifications" onCheckedChange={vi.fn()} />);

    expect(screen.getByRole("switch", { name: "Notifications" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("disables interaction when disabled", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <Switch
        checked={false}
        disabled
        aria-label="Notifications"
        onCheckedChange={onCheckedChange}
      />
    );

    const switchControl = screen.getByRole("switch", { name: "Notifications" });
    expect(switchControl).toBeDisabled();

    await user.click(switchControl);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("supports small size and preserves compatibility classes", () => {
    render(
      <Switch
        checked
        size="sm"
        className="settings-toggle"
        aria-label="Notifications"
        onCheckedChange={vi.fn()}
      />
    );

    const switchControl = screen.getByRole("switch", { name: "Notifications" });
    expect(switchControl).toHaveClass("settings-toggle");
    expect(switchControl.style.getPropertyValue("--switch-track-width")).toBe("32px");
  });

  it("calls onCheckedChange with the next checked state", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(<Switch checked={false} aria-label="Notifications" onCheckedChange={onCheckedChange} />);

    await user.click(screen.getByRole("switch", { name: "Notifications" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
